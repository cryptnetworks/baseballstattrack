import { createHmac } from "node:crypto";

import {
  discordInstallationCallbackSchema,
  discordInstallationDisconnectSchema,
  discordInstallationStartSchema,
} from "@/domain/discord-installation";
import {
  getRateLimitService,
  noRateLimit,
  type RateLimitEnforcer,
} from "@/server/app/rate-limit-service";
import {
  issueDiscordOAuthState,
  verifyDiscordOAuthState,
} from "@/server/auth/discord-oauth-state";
import { AuthorizationError } from "@/server/auth/errors";
import {
  requireTrustedActor,
  type TrustedActorContext,
} from "@/server/auth/types";
import {
  loadDiscordInstallationConfiguration,
  type DiscordInstallationConfiguration,
} from "@/server/config/discord-installation";
import { PrismaDiscordInstallationRepository } from "@/server/data/discord-installation-repository";
import { getPrismaClient } from "@/server/data/prisma";
import {
  ConfiguredDiscordInstallationProvider,
  DiscordInstallationProviderError,
  type DiscordInstallationProvider,
} from "@/server/providers/discord-installation";

type Repository = Pick<
  PrismaDiscordInstallationRepository,
  "list" | "providerIdentity" | "connect" | "disconnect"
>;

export class DiscordInstallationError extends Error {
  constructor(
    readonly code:
      | "RESOURCE_UNAVAILABLE"
      | "AUTHORIZATION_INVALID"
      | "PROVIDER_UNAVAILABLE"
      | "CONFIGURATION_INVALID",
    readonly status: 400 | 404 | 409 | 503,
  ) {
    super(code);
    this.name = "DiscordInstallationError";
  }
}

function administrator(
  actorInput: TrustedActorContext,
  accountId: string,
  capability:
    | "discord.settings.view"
    | "discord.settings.configure"
    | "discord.settings.operate",
) {
  const actor = requireTrustedActor(actorInput, accountId, capability);
  if (actor.target.kind !== "ACCOUNT") {
    throw new AuthorizationError("AUTHORIZATION_REQUIRED");
  }
  return actor;
}

export class DiscordInstallationService {
  constructor(
    private readonly repository: Repository,
    private readonly configuration: () => DiscordInstallationConfiguration,
    private readonly provider: (
      configuration: DiscordInstallationConfiguration,
    ) => DiscordInstallationProvider,
    private readonly rateLimits: RateLimitEnforcer = noRateLimit,
  ) {}

  async list(accountId: string, actorInput: TrustedActorContext) {
    administrator(actorInput, accountId, "discord.settings.view");
    return this.repository.list(accountId);
  }

  async begin(input: unknown, actorInput: TrustedActorContext) {
    const parsed = discordInstallationStartSchema.parse(input);
    const actor = administrator(
      actorInput,
      parsed.accountId,
      "discord.settings.configure",
    );
    await this.rateLimits.enforce(
      { accountId: parsed.accountId, endpointClass: "ADMINISTRATION" },
      actor,
    );
    const configuration = this.loadConfiguration();
    const state = issueDiscordOAuthState({
      accountId: parsed.accountId,
      actorUserId: actor.appUserId,
      secret: configuration.stateSecret,
    });
    return {
      authorizationUrl: this.provider(configuration).authorizationUrl(
        state.nonce,
      ),
      stateCookie: state.cookieValue,
      expiresAt: state.expiresAt,
    };
  }

  async complete(
    input: unknown,
    stateCookie: string | null | undefined,
    actorInput: TrustedActorContext,
    correlationId?: string,
  ) {
    const parsed = discordInstallationCallbackSchema.parse(input);
    const configuration = this.loadConfiguration();
    let state;
    try {
      state = verifyDiscordOAuthState({
        cookieValue: stateCookie,
        returnedState: parsed.state,
        secret: configuration.stateSecret,
      });
    } catch {
      throw new DiscordInstallationError("AUTHORIZATION_INVALID", 400);
    }
    const actor = administrator(
      actorInput,
      state.accountId,
      "discord.settings.configure",
    );
    if (state.actorUserId !== actor.appUserId) {
      throw new DiscordInstallationError("AUTHORIZATION_INVALID", 400);
    }
    let verified;
    try {
      verified = await this.provider(configuration).verifyAuthorization(parsed);
    } catch (error) {
      throw this.providerError(error);
    }
    const result = await this.repository.connect({
      accountId: state.accountId,
      guildId: verified.guildId,
      guildDisplayName: verified.guildDisplayName,
      credentialReference: configuration.credentialReference,
      installerFingerprint: createHmac("sha256", configuration.stateSecret)
        .update(verified.installerUserId)
        .digest("hex"),
      actor,
      ...(correlationId ? { correlationId } : {}),
    });
    if (result.outcome === "unavailable") {
      throw new DiscordInstallationError("RESOURCE_UNAVAILABLE", 409);
    }
    return result.installation;
  }

  async disconnect(
    input: unknown,
    actorInput: TrustedActorContext,
    correlationId?: string,
  ) {
    const parsed = discordInstallationDisconnectSchema.parse(input);
    const actor = administrator(
      actorInput,
      parsed.accountId,
      "discord.settings.operate",
    );
    await this.rateLimits.enforce(
      { accountId: parsed.accountId, endpointClass: "ADMINISTRATION" },
      actor,
    );
    const identity = await this.repository.providerIdentity(
      parsed.accountId,
      parsed.installationId,
    );
    if (!identity || identity.status === "REVOKED") {
      throw new DiscordInstallationError("RESOURCE_UNAVAILABLE", 404);
    }
    if (identity.status !== "DISCONNECTED") {
      try {
        await this.provider(this.loadConfiguration()).leaveGuild(
          identity.guildId,
        );
      } catch (error) {
        throw this.providerError(error);
      }
    }
    const result = await this.repository.disconnect({
      accountId: parsed.accountId,
      installationExternalId: parsed.installationId,
      actor,
      ...(correlationId ? { correlationId } : {}),
    });
    if (result.outcome === "unavailable") {
      throw new DiscordInstallationError("RESOURCE_UNAVAILABLE", 404);
    }
    return result.installation;
  }

  private loadConfiguration() {
    try {
      return this.configuration();
    } catch {
      throw new DiscordInstallationError("CONFIGURATION_INVALID", 503);
    }
  }

  private providerError(error: unknown) {
    if (error instanceof DiscordInstallationProviderError) {
      if (error.code === "AUTHORIZATION_INVALID") {
        return new DiscordInstallationError("AUTHORIZATION_INVALID", 400);
      }
      return new DiscordInstallationError("PROVIDER_UNAVAILABLE", 503);
    }
    return new DiscordInstallationError("PROVIDER_UNAVAILABLE", 503);
  }
}

export function getDiscordInstallationService() {
  return new DiscordInstallationService(
    new PrismaDiscordInstallationRepository(getPrismaClient()),
    loadDiscordInstallationConfiguration,
    (configuration) => new ConfiguredDiscordInstallationProvider(configuration),
    getRateLimitService(),
  );
}
