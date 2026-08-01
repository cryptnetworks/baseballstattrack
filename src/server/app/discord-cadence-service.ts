import {
  discordCadenceStateSchema,
  discordCadenceUpdateSchema,
  discordManualRefreshSchema,
} from "@/domain/discord-cadence";
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
import {
  DiscordSettingsConflictError,
  PrismaDiscordSettingsRepository,
} from "@/server/data/discord-settings-repository";
import { getPrismaClient } from "@/server/data/prisma";

type Repository = Pick<
  PrismaDiscordSettingsRepository,
  "getConfiguration" | "writeConfiguration" | "requestManualRefresh"
>;

export class DiscordCadenceError extends Error {
  constructor(
    readonly code:
      | "RESOURCE_UNAVAILABLE"
      | "INSTALLATION_INACTIVE"
      | "CONFIGURATION_INCOMPLETE"
      | "REVISION_CONFLICT",
    readonly status: 404 | 409,
  ) {
    super(code);
    this.name = "DiscordCadenceError";
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

export class DiscordCadenceService {
  private readonly settings: DiscordSettingsService;

  constructor(
    private readonly repository: Repository,
    private readonly rateLimits: RateLimitEnforcer = noRateLimit,
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.settings = new DiscordSettingsService(repository, noRateLimit);
  }

  async get(
    accountId: string,
    installationId: string,
    actorInput: TrustedActorContext,
  ) {
    accountActor(actorInput, accountId, "discord.settings.view");
    const configuration = await this.repository.getConfiguration(
      accountId,
      installationId,
    );
    if (!configuration) this.unavailable();
    return configuration;
  }

  async update(input: unknown, actorInput: TrustedActorContext) {
    const parsed = discordCadenceUpdateSchema.parse(input);
    const actor = accountActor(
      actorInput,
      parsed.accountId,
      "discord.settings.configure",
    );
    await this.enforce(parsed.accountId, actor);
    const current = await this.current(parsed.accountId, parsed.installationId);
    this.activeInstallation(current);
    return this.write(
      current,
      {
        ...parsed,
        enabled: current.settings.enabled,
        reasonCode: "UPDATE_SCHEDULE_CHANGED",
      },
      actor,
    );
  }

  async changeState(input: unknown, actorInput: TrustedActorContext) {
    const parsed = discordCadenceStateSchema.parse(input);
    const actor = accountActor(
      actorInput,
      parsed.accountId,
      "discord.settings.configure",
    );
    await this.enforce(parsed.accountId, actor);
    const current = await this.current(parsed.accountId, parsed.installationId);
    this.activeInstallation(current);
    if (current.settings.revision !== parsed.expectedRevision) {
      throw new DiscordCadenceError("REVISION_CONFLICT", 409);
    }
    const enabled = parsed.operation === "RESUME";
    if (current.settings.enabled === enabled) return current;
    if (
      enabled &&
      (!current.settings.trackedScopes.length ||
        !current.settings.destinations.length)
    ) {
      throw new DiscordCadenceError("CONFIGURATION_INCOMPLETE", 409);
    }
    return this.write(
      current,
      {
        accountId: parsed.accountId,
        installationId: parsed.installationId,
        expectedRevision: parsed.expectedRevision,
        enabled,
        cadenceMode: current.settings.cadenceMode,
        cadenceSeconds: current.settings.cadenceSeconds,
        gameDayWindow: current.settings.gameDayWindow,
        digest: current.settings.digest,
        catchUpPolicy: current.settings.catchUpPolicy,
        quietHours: current.settings.quietHours,
        reasonCode:
          parsed.operation === "PAUSE"
            ? "UPDATE_DELIVERY_PAUSED"
            : "UPDATE_DELIVERY_RESUMED",
      },
      actor,
    );
  }

  async requestManualRefresh(input: unknown, actorInput: TrustedActorContext) {
    const parsed = discordManualRefreshSchema.parse(input);
    const actor = accountActor(
      actorInput,
      parsed.accountId,
      "discord.settings.operate",
    );
    await this.enforce(parsed.accountId, actor);
    try {
      const result = await this.repository.requestManualRefresh({
        ...parsed,
        actor,
        now: this.clock(),
      });
      if (result.outcome === "unavailable") this.unavailable();
      if (result.outcome === "inactive") {
        throw new DiscordCadenceError("INSTALLATION_INACTIVE", 409);
      }
      return result;
    } catch (error) {
      if (error instanceof DiscordSettingsConflictError) {
        throw new DiscordCadenceError("REVISION_CONFLICT", 409);
      }
      throw error;
    }
  }

  private async current(accountId: string, installationId: string) {
    const current = await this.repository.getConfiguration(
      accountId,
      installationId,
    );
    if (!current) this.unavailable();
    return current;
  }

  private activeInstallation(
    current: Awaited<ReturnType<Repository["getConfiguration"]>>,
  ) {
    if (current!.installation.status !== "ACTIVE") {
      throw new DiscordCadenceError("INSTALLATION_INACTIVE", 409);
    }
  }

  private write(
    current: NonNullable<Awaited<ReturnType<Repository["getConfiguration"]>>>,
    policy: {
      accountId: string;
      installationId: string;
      expectedRevision: number;
      enabled: boolean;
      cadenceMode: "EVENT_DRIVEN" | "FIXED_INTERVAL" | "MANUAL_ONLY";
      cadenceSeconds: number;
      gameDayWindow: {
        enabled: boolean;
        startMinute: number;
        endMinute: number;
      };
      digest: { enabled: boolean; minute: number };
      catchUpPolicy: "SKIP" | "LATEST_ONLY";
      quietHours: {
        enabled: boolean;
        startMinute: number;
        endMinute: number;
        timeZone: string;
      };
      reasonCode: string;
    },
    actor: TrustedActorContext,
  ) {
    return this.settings.update(
      {
        ...policy,
        trackedScopes: current.settings.trackedScopes,
        destinations: current.settings.destinations.map(
          ({ destinationId, purposes }) => ({ destinationId, purposes }),
        ),
        triggers: current.settings.triggers,
        messageFormat: current.settings.messageFormat,
      },
      actor,
    );
  }

  private async enforce(accountId: string, actor: TrustedActorContext) {
    await this.rateLimits.enforce(
      { accountId, endpointClass: "ADMINISTRATION" },
      actor,
    );
  }

  private unavailable(): never {
    throw new DiscordCadenceError("RESOURCE_UNAVAILABLE", 404);
  }
}

export function getDiscordCadenceService() {
  return new DiscordCadenceService(
    new PrismaDiscordSettingsRepository(getPrismaClient()),
    getRateLimitService(),
  );
}
