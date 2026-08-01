import {
  discordChannelRefreshSchema,
  discordChannelRoutingSchema,
  discordChannelTestSchema,
  discordChannelToggleSchema,
  groupDiscordRoutes,
} from "@/domain/discord-channel-routing";
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
  loadDiscordInstallationConfiguration,
  type DiscordInstallationConfiguration,
} from "@/server/config/discord-installation";
import { PrismaDiscordChannelRoutingRepository } from "@/server/data/discord-channel-routing-repository";
import { PrismaDiscordSettingsRepository } from "@/server/data/discord-settings-repository";
import { getPrismaClient } from "@/server/data/prisma";
import {
  ConfiguredDiscordChannelProvider,
  DiscordChannelProviderError,
  type DiscordChannelProvider,
} from "@/server/providers/discord-channels";

type RoutingRepository = Pick<
  PrismaDiscordChannelRoutingRepository,
  | "getWorkspace"
  | "providerIdentity"
  | "syncChannels"
  | "setChannelEnabled"
  | "resolveTestDestination"
  | "recordTestDelivery"
>;
type SettingsRepository = Pick<
  PrismaDiscordSettingsRepository,
  "getConfiguration" | "writeConfiguration"
>;

export class DiscordChannelRoutingError extends Error {
  constructor(
    readonly code:
      | "RESOURCE_UNAVAILABLE"
      | "INSTALLATION_INACTIVE"
      | "PERMISSION_REQUIRED"
      | "PROVIDER_RATE_LIMITED"
      | "PROVIDER_UNAVAILABLE",
    readonly status: 404 | 409 | 429 | 503,
  ) {
    super(code);
    this.name = "DiscordChannelRoutingError";
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

export class DiscordChannelRoutingService {
  private readonly settings: DiscordSettingsService;

  constructor(
    private readonly repository: RoutingRepository,
    private readonly settingsRepository: SettingsRepository,
    private readonly configuration: () => DiscordInstallationConfiguration,
    private readonly provider: (
      configuration: DiscordInstallationConfiguration,
    ) => DiscordChannelProvider,
    private readonly rateLimits: RateLimitEnforcer = noRateLimit,
  ) {
    this.settings = new DiscordSettingsService(settingsRepository, rateLimits);
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
    return {
      ...workspace,
      configuration,
      permissionEvidenceStale:
        !workspace.lastVerifiedAt ||
        Date.now() - workspace.lastVerifiedAt.getTime() > 5 * 60 * 1_000,
    };
  }

  async refresh(input: unknown, actorInput: TrustedActorContext) {
    const parsed = discordChannelRefreshSchema.parse(input);
    const actor = accountActor(
      actorInput,
      parsed.accountId,
      "discord.settings.configure",
    );
    await this.enforce(parsed.accountId, actor);
    return this.sync(parsed.accountId, parsed.installationId, actor);
  }

  async updateRouting(input: unknown, actorInput: TrustedActorContext) {
    const parsed = discordChannelRoutingSchema.parse(input);
    const actor = accountActor(
      actorInput,
      parsed.accountId,
      "discord.settings.configure",
    );
    await this.enforce(parsed.accountId, actor);
    const workspace = await this.sync(
      parsed.accountId,
      parsed.installationId,
      actor,
    );
    const routable = new Set(
      workspace.channels.filter(({ enabled }) => enabled).map(({ id }) => id),
    );
    const destinations = groupDiscordRoutes(parsed.routes);
    if (
      destinations.some(({ destinationId }) => !routable.has(destinationId))
    ) {
      throw new DiscordChannelRoutingError("PERMISSION_REQUIRED", 409);
    }
    const current = await this.settingsRepository.getConfiguration(
      parsed.accountId,
      parsed.installationId,
    );
    if (!current) this.unavailable();
    return this.settings.update(
      {
        accountId: parsed.accountId,
        installationId: parsed.installationId,
        expectedRevision: parsed.expectedRevision,
        enabled: current.settings.enabled && destinations.length > 0,
        trackedScopes: current.settings.trackedScopes,
        destinations,
        cadenceMode: current.settings.cadenceMode,
        cadenceSeconds: current.settings.cadenceSeconds,
        gameDayWindow: current.settings.gameDayWindow,
        digest: current.settings.digest,
        catchUpPolicy: current.settings.catchUpPolicy,
        triggers: current.settings.triggers,
        messageStrategy: current.settings.messageStrategy,
        messageFormat: current.settings.messageFormat,
        quietHours: current.settings.quietHours,
        reasonCode: "CHANNEL_ROUTING_UPDATED",
      },
      actor,
    );
  }

  async toggle(input: unknown, actorInput: TrustedActorContext) {
    const parsed = discordChannelToggleSchema.parse(input);
    const actor = accountActor(
      actorInput,
      parsed.accountId,
      "discord.settings.configure",
    );
    await this.enforce(parsed.accountId, actor);
    const result = await this.repository.setChannelEnabled({
      accountId: parsed.accountId,
      installationExternalId: parsed.installationId,
      destinationExternalId: parsed.destinationId,
      enabled: parsed.enabled,
      actor,
    });
    if (result.outcome === "unavailable") this.unavailable();
    return result;
  }

  async testDelivery(input: unknown, actorInput: TrustedActorContext) {
    const parsed = discordChannelTestSchema.parse(input);
    const actor = accountActor(
      actorInput,
      parsed.accountId,
      "discord.settings.preview",
    );
    await this.enforce(parsed.accountId, actor);
    const destination = await this.repository.resolveTestDestination(
      parsed.accountId,
      parsed.installationId,
      parsed.destinationId,
    );
    if (!destination) this.unavailable();
    try {
      await this.loadProvider().sendTestDelivery(
        destination.guildId,
        destination.channelId,
        parsed.messageFormat,
      );
      await this.repository.recordTestDelivery({
        accountId: parsed.accountId,
        destinationInternalId: destination.internalId,
        messageFormat: parsed.messageFormat,
        actor,
        succeeded: true,
      });
    } catch (error) {
      const mapped = this.providerError(error);
      await this.repository.recordTestDelivery({
        accountId: parsed.accountId,
        destinationInternalId: destination.internalId,
        messageFormat: parsed.messageFormat,
        actor,
        succeeded: false,
        failureCode: mapped.code,
      });
      throw mapped;
    }
  }

  private async sync(
    accountId: string,
    installationId: string,
    actor: TrustedActorContext,
  ) {
    const identity = await this.repository.providerIdentity(
      accountId,
      installationId,
    );
    if (!identity) this.unavailable();
    if (identity.status !== "ACTIVE") {
      throw new DiscordChannelRoutingError("INSTALLATION_INACTIVE", 409);
    }
    let channels;
    try {
      channels = await this.loadProvider().listTextChannels(identity.guildId);
    } catch (error) {
      throw this.providerError(error);
    }
    const workspace = await this.repository.syncChannels({
      accountId,
      installationExternalId: installationId,
      channels,
      actor,
    });
    if (!workspace) this.unavailable();
    return workspace;
  }

  private async enforce(accountId: string, actor: TrustedActorContext) {
    await this.rateLimits.enforce(
      { accountId, endpointClass: "ADMINISTRATION" },
      actor,
    );
  }

  private loadProvider() {
    try {
      return this.provider(this.configuration());
    } catch {
      throw new DiscordChannelRoutingError("PROVIDER_UNAVAILABLE", 503);
    }
  }

  private providerError(error: unknown) {
    if (error instanceof DiscordChannelProviderError) {
      if (error.code === "PERMISSION_REQUIRED") {
        return new DiscordChannelRoutingError("PERMISSION_REQUIRED", 409);
      }
      if (error.code === "RATE_LIMITED") {
        return new DiscordChannelRoutingError("PROVIDER_RATE_LIMITED", 429);
      }
    }
    return new DiscordChannelRoutingError("PROVIDER_UNAVAILABLE", 503);
  }

  private unavailable(): never {
    throw new DiscordChannelRoutingError("RESOURCE_UNAVAILABLE", 404);
  }
}

export function getDiscordChannelRoutingService() {
  const prisma = getPrismaClient();
  return new DiscordChannelRoutingService(
    new PrismaDiscordChannelRoutingRepository(prisma),
    new PrismaDiscordSettingsRepository(prisma),
    loadDiscordInstallationConfiguration,
    (configuration) => new ConfiguredDiscordChannelProvider(configuration),
    getRateLimitService(),
  );
}
