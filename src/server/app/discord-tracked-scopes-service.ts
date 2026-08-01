import {
  discordTrackedScopeKey,
  discordTrackedScopesUpdateSchema,
} from "@/domain/discord-tracked-scopes";
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
import { PrismaDiscordTrackedScopesRepository } from "@/server/data/discord-tracked-scopes-repository";
import { getPrismaClient } from "@/server/data/prisma";

type ScopeRepository = Pick<
  PrismaDiscordTrackedScopesRepository,
  "getWorkspace"
>;
type SettingsRepository = Pick<
  PrismaDiscordSettingsRepository,
  "getConfiguration" | "writeConfiguration"
>;

export class DiscordTrackedScopesError extends Error {
  constructor(
    readonly code:
      "RESOURCE_UNAVAILABLE" | "INSTALLATION_INACTIVE" | "STALE_SCOPE",
    readonly status: 404 | 409,
  ) {
    super(code);
    this.name = "DiscordTrackedScopesError";
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

export class DiscordTrackedScopesService {
  private readonly settings: DiscordSettingsService;

  constructor(
    private readonly repository: ScopeRepository,
    private readonly settingsRepository: SettingsRepository,
    private readonly rateLimits: RateLimitEnforcer = noRateLimit,
  ) {
    this.settings = new DiscordSettingsService(settingsRepository);
  }

  async get(
    accountId: string,
    installationId: string,
    actorInput: TrustedActorContext,
  ) {
    accountActor(actorInput, accountId, "discord.settings.view");
    const [workspace, configuration] = await Promise.all([
      this.repository.getWorkspace(accountId, installationId),
      this.settingsRepository.getConfiguration(accountId, installationId),
    ]);
    if (!workspace || !configuration) this.unavailable();
    const selected = new Set(
      configuration.settings.trackedScopes.map(({ teamId, seasonId }) =>
        discordTrackedScopeKey(teamId, seasonId),
      ),
    );
    const scopes = workspace.scopes.map((scope) => ({
      ...scope,
      selected: selected.has(
        discordTrackedScopeKey(scope.teamId, scope.seasonId),
      ),
    }));
    return {
      installation: workspace.installation,
      scopes,
      selectedCount: scopes.filter(
        ({ selected, available }) => selected && available,
      ).length,
      staleSelectedCount: scopes.filter(
        ({ selected, available }) => selected && !available,
      ).length,
      configuration,
    };
  }

  async update(input: unknown, actorInput: TrustedActorContext) {
    const parsed = discordTrackedScopesUpdateSchema.parse(input);
    const actor = accountActor(
      actorInput,
      parsed.accountId,
      "discord.settings.configure",
    );
    await this.rateLimits.enforce(
      { accountId: parsed.accountId, endpointClass: "ADMINISTRATION" },
      actor,
    );
    const [workspace, current] = await Promise.all([
      this.repository.getWorkspace(parsed.accountId, parsed.installationId),
      this.settingsRepository.getConfiguration(
        parsed.accountId,
        parsed.installationId,
      ),
    ]);
    if (!workspace || !current) this.unavailable();
    if (workspace.installation.status !== "ACTIVE") {
      throw new DiscordTrackedScopesError("INSTALLATION_INACTIVE", 409);
    }
    const available = new Set(
      workspace.scopes
        .filter((scope) => scope.available)
        .map((scope) => discordTrackedScopeKey(scope.teamId, scope.seasonId)),
    );
    if (
      parsed.trackedScopes.some(
        ({ teamId, seasonId }) =>
          !available.has(discordTrackedScopeKey(teamId, seasonId)),
      )
    ) {
      throw new DiscordTrackedScopesError("STALE_SCOPE", 409);
    }
    return this.settings.update(
      {
        accountId: parsed.accountId,
        installationId: parsed.installationId,
        expectedRevision: parsed.expectedRevision,
        enabled:
          current.settings.enabled &&
          parsed.trackedScopes.length > 0 &&
          current.settings.destinations.length > 0,
        trackedScopes: parsed.trackedScopes,
        destinations: current.settings.destinations.map(
          ({ destinationId, purposes }) => ({ destinationId, purposes }),
        ),
        cadenceMode: current.settings.cadenceMode,
        cadenceSeconds: current.settings.cadenceSeconds,
        gameDayWindow: current.settings.gameDayWindow,
        digest: current.settings.digest,
        catchUpPolicy: current.settings.catchUpPolicy,
        triggers: current.settings.triggers,
        messageFormat: current.settings.messageFormat,
        quietHours: current.settings.quietHours,
        reasonCode: "TRACKED_SCOPES_UPDATED",
      },
      actor,
    );
  }

  private unavailable(): never {
    throw new DiscordTrackedScopesError("RESOURCE_UNAVAILABLE", 404);
  }
}

export function getDiscordTrackedScopesService() {
  const prisma = getPrismaClient();
  return new DiscordTrackedScopesService(
    new PrismaDiscordTrackedScopesRepository(prisma),
    new PrismaDiscordSettingsRepository(prisma),
    getRateLimitService(),
  );
}
