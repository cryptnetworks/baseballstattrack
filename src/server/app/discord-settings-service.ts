import {
  discordSettingsDefaults,
  discordSettingsResetSchema,
  discordSettingsUpdateSchema,
} from "@/domain/discord-settings";
import {
  getRateLimitService,
  noRateLimit,
  type RateLimitEnforcer,
} from "@/server/app/rate-limit-service";
import { AuthorizationError } from "@/server/auth/errors";
import {
  requireTrustedActor,
  type TrustedActorContext,
} from "@/server/auth/types";
import {
  DiscordSettingsConflictError,
  PrismaDiscordSettingsRepository,
} from "@/server/data/discord-settings-repository";
import { getPrismaClient } from "@/server/data/prisma";

type DiscordSettingsRepository = Pick<
  PrismaDiscordSettingsRepository,
  "getConfiguration" | "writeConfiguration"
>;

export class DiscordSettingsError extends Error {
  constructor(
    readonly code:
      "RESOURCE_UNAVAILABLE" | "REVISION_CONFLICT" | "INSTALLATION_INACTIVE",
    readonly status: 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "DiscordSettingsError";
  }
}

function administrator(
  actorInput: TrustedActorContext,
  accountId: string,
  capability: "discord.settings.view" | "discord.settings.configure",
): TrustedActorContext {
  const actor = requireTrustedActor(actorInput, accountId, capability);
  if (actor.target.kind !== "ACCOUNT") {
    throw new AuthorizationError("AUTHORIZATION_REQUIRED");
  }
  return actor;
}

export class DiscordSettingsService {
  constructor(
    private readonly repository: DiscordSettingsRepository,
    private readonly rateLimits: RateLimitEnforcer = noRateLimit,
  ) {}

  async get(
    accountId: string,
    installationId: string,
    actorInput: TrustedActorContext,
  ) {
    administrator(actorInput, accountId, "discord.settings.view");
    const configuration = await this.repository.getConfiguration(
      accountId,
      installationId,
    );
    if (!configuration) {
      throw new DiscordSettingsError(
        "RESOURCE_UNAVAILABLE",
        404,
        "The Discord installation is unavailable.",
      );
    }
    return configuration;
  }

  async update(input: unknown, actorInput: TrustedActorContext) {
    const parsed = discordSettingsUpdateSchema.parse(input);
    const actor = administrator(
      actorInput,
      parsed.accountId,
      "discord.settings.configure",
    );
    await this.rateLimits.enforce(
      { accountId: parsed.accountId, endpointClass: "ADMINISTRATION" },
      actor,
    );
    const { reasonCode, ...configuration } = parsed;
    return this.write({
      ...configuration,
      ...(reasonCode ? { reasonCode } : {}),
      actor,
      auditAction: "update",
    });
  }

  async reset(input: unknown, actorInput: TrustedActorContext) {
    const parsed = discordSettingsResetSchema.parse(input);
    const actor = administrator(
      actorInput,
      parsed.accountId,
      "discord.settings.configure",
    );
    await this.rateLimits.enforce(
      { accountId: parsed.accountId, endpointClass: "ADMINISTRATION" },
      actor,
    );
    return this.write({
      accountId: parsed.accountId,
      installationId: parsed.installationId,
      expectedRevision: parsed.expectedRevision,
      enabled: false,
      trackedScopes: [],
      destinations: [],
      cadenceSeconds: discordSettingsDefaults.cadenceSeconds,
      triggers: [...discordSettingsDefaults.triggers],
      messageFormat: discordSettingsDefaults.messageFormat,
      quietHours: { ...discordSettingsDefaults.quietHours },
      actor,
      auditAction: "reset",
      reasonCode: parsed.reasonCode,
    });
  }

  private async write(
    input: Parameters<DiscordSettingsRepository["writeConfiguration"]>[0],
  ) {
    let result: Awaited<
      ReturnType<DiscordSettingsRepository["writeConfiguration"]>
    >;
    try {
      result = await this.repository.writeConfiguration(input);
    } catch (error) {
      if (error instanceof DiscordSettingsConflictError) {
        throw new DiscordSettingsError(
          "REVISION_CONFLICT",
          409,
          "The Discord settings changed before this update was applied.",
        );
      }
      throw error;
    }
    if (result.outcome === "unavailable") {
      throw new DiscordSettingsError(
        "RESOURCE_UNAVAILABLE",
        404,
        "The Discord installation, scope, or destination is unavailable.",
      );
    }
    if (result.outcome === "installation_inactive") {
      throw new DiscordSettingsError(
        "INSTALLATION_INACTIVE",
        409,
        "The Discord installation is not active.",
      );
    }
    return result.configuration;
  }
}

export function getDiscordSettingsService() {
  return new DiscordSettingsService(
    new PrismaDiscordSettingsRepository(getPrismaClient()),
    getRateLimitService(),
  );
}
