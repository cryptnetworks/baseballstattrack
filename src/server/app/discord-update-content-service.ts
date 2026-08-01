import { discordUpdateContentSchema } from "@/domain/discord-update-content";
import {
  getRateLimitService,
  noRateLimit,
  type RateLimitEnforcer,
} from "@/server/app/rate-limit-service";
import { DiscordSettingsService } from "@/server/app/discord-settings-service";
import { AuthorizationError } from "@/server/auth/errors";
import {
  requireTrustedActor,
  type Capability,
  type TrustedActorContext,
} from "@/server/auth/types";
import { PrismaDiscordSettingsRepository } from "@/server/data/discord-settings-repository";
import { getPrismaClient } from "@/server/data/prisma";

type Repository = Pick<
  PrismaDiscordSettingsRepository,
  "getConfiguration" | "writeConfiguration"
>;

export class DiscordUpdateContentError extends Error {
  constructor(
    readonly code: "RESOURCE_UNAVAILABLE" | "INSTALLATION_INACTIVE",
    readonly status: 404 | 409,
  ) {
    super(code);
    this.name = "DiscordUpdateContentError";
  }
}

function accountActor(
  actorInput: TrustedActorContext,
  accountId: string,
  capability: Capability,
) {
  const actor = requireTrustedActor(actorInput, accountId, capability);
  if (actor.target.kind !== "ACCOUNT") {
    throw new AuthorizationError("AUTHORIZATION_REQUIRED");
  }
  return actor;
}

export class DiscordUpdateContentService {
  private readonly settings: DiscordSettingsService;

  constructor(
    private readonly repository: Repository,
    private readonly rateLimits: RateLimitEnforcer = noRateLimit,
  ) {
    this.settings = new DiscordSettingsService(repository, noRateLimit);
  }

  async get(
    accountId: string,
    installationId: string,
    actorInput: TrustedActorContext,
  ) {
    accountActor(actorInput, accountId, "discord.settings.view");
    const current = await this.repository.getConfiguration(
      accountId,
      installationId,
    );
    if (!current) this.unavailable();
    return current;
  }

  async update(input: unknown, actorInput: TrustedActorContext) {
    const parsed = discordUpdateContentSchema.parse(input);
    const actor = accountActor(
      actorInput,
      parsed.accountId,
      "discord.settings.configure",
    );
    await this.rateLimits.enforce(
      { accountId: parsed.accountId, endpointClass: "ADMINISTRATION" },
      actor,
    );
    const current = await this.repository.getConfiguration(
      parsed.accountId,
      parsed.installationId,
    );
    if (!current) this.unavailable();
    if (current.installation.status !== "ACTIVE") {
      throw new DiscordUpdateContentError("INSTALLATION_INACTIVE", 409);
    }
    return this.settings.update(
      {
        accountId: parsed.accountId,
        installationId: parsed.installationId,
        expectedRevision: parsed.expectedRevision,
        enabled: current.settings.enabled,
        trackedScopes: current.settings.trackedScopes,
        destinations: current.settings.destinations.map(
          ({ destinationId, purposes }) => ({ destinationId, purposes }),
        ),
        cadenceMode: current.settings.cadenceMode,
        cadenceSeconds: current.settings.cadenceSeconds,
        gameDayWindow: current.settings.gameDayWindow,
        digest: current.settings.digest,
        catchUpPolicy: current.settings.catchUpPolicy,
        triggers: parsed.triggers,
        messageStrategy: parsed.messageStrategy,
        messageFormat: parsed.messageFormat,
        quietHours: current.settings.quietHours,
        reasonCode: "UPDATE_CONTENT_CHANGED",
      },
      actor,
    );
  }

  private unavailable(): never {
    throw new DiscordUpdateContentError("RESOURCE_UNAVAILABLE", 404);
  }
}

export function getDiscordUpdateContentService() {
  return new DiscordUpdateContentService(
    new PrismaDiscordSettingsRepository(getPrismaClient()),
    getRateLimitService(),
  );
}
