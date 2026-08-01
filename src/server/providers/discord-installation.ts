import { z } from "zod";

import {
  DISCORD_INSTALLATION_PERMISSIONS,
  DISCORD_INSTALLATION_SCOPES,
  discordSnowflakeSchema,
  type DiscordInstallationCallback,
} from "@/domain/discord-installation";
import type { DiscordInstallationConfiguration } from "@/server/config/discord-installation";

type Fetcher = typeof fetch;

const tokenSchema = z
  .object({
    access_token: z.string().min(8).max(2_048),
    token_type: z.literal("Bearer"),
    scope: z.string(),
  })
  .loose();
const userSchema = z.object({ id: discordSnowflakeSchema }).loose();
const guildSchema = z
  .object({
    id: discordSnowflakeSchema,
    name: z.string().trim().min(1).max(100),
    owner: z.boolean().optional(),
    permissions: z
      .string()
      .regex(/^\d{1,32}$/u)
      .optional(),
  })
  .loose();

export class DiscordInstallationProviderError extends Error {
  constructor(
    readonly code:
      | "AUTHORIZATION_INVALID"
      | "AUTHENTICATION_FAILED"
      | "PROVIDER_UNAVAILABLE"
      | "RATE_LIMITED",
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = "DiscordInstallationProviderError";
  }
}

export type VerifiedDiscordInstallation = Readonly<{
  guildId: string;
  guildDisplayName: string;
  installerUserId: string;
}>;

export interface DiscordInstallationProvider {
  authorizationUrl(state: string): string;
  verifyAuthorization(
    callback: DiscordInstallationCallback,
  ): Promise<VerifiedDiscordInstallation>;
  leaveGuild(guildId: string): Promise<void>;
}

export class ConfiguredDiscordInstallationProvider implements DiscordInstallationProvider {
  private readonly apiBase: string;

  constructor(
    private readonly configuration: DiscordInstallationConfiguration,
    private readonly fetcher: Fetcher = fetch,
  ) {
    this.apiBase = configuration.apiBaseUrl;
  }

  authorizationUrl(state: string) {
    const url = new URL("https://discord.com/oauth2/authorize");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.configuration.clientId);
    url.searchParams.set("scope", DISCORD_INSTALLATION_SCOPES.join(" "));
    url.searchParams.set(
      "permissions",
      DISCORD_INSTALLATION_PERMISSIONS.toString(),
    );
    url.searchParams.set("redirect_uri", this.configuration.redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("integration_type", "0");
    url.searchParams.set("prompt", "consent");
    return url.toString();
  }

  async verifyAuthorization(callback: DiscordInstallationCallback) {
    let grantedPermissions: bigint;
    try {
      grantedPermissions = BigInt(callback.permissions);
    } catch {
      throw new DiscordInstallationProviderError(
        "AUTHORIZATION_INVALID",
        false,
      );
    }
    if (
      (grantedPermissions & DISCORD_INSTALLATION_PERMISSIONS) !==
      DISCORD_INSTALLATION_PERMISSIONS
    ) {
      throw new DiscordInstallationProviderError(
        "AUTHORIZATION_INVALID",
        false,
      );
    }

    const token = await this.exchange(callback.code);
    const scopes = new Set(token.scope.split(/\s+/u).filter(Boolean));
    if (!DISCORD_INSTALLATION_SCOPES.every((scope) => scopes.has(scope))) {
      throw new DiscordInstallationProviderError(
        "AUTHORIZATION_INVALID",
        false,
      );
    }
    const [user, userGuilds, botGuild] = await Promise.all([
      this.getJson("users/@me", `Bearer ${token.access_token}`, userSchema),
      this.getJson(
        "users/@me/guilds",
        `Bearer ${token.access_token}`,
        z.array(guildSchema).max(200),
      ),
      this.getJson(
        `guilds/${encodeURIComponent(callback.guildId)}`,
        `Bot ${this.configuration.botToken}`,
        guildSchema,
      ),
    ]);
    const installerGuild = userGuilds.find(({ id }) => id === callback.guildId);
    const installerPermissions = BigInt(installerGuild?.permissions ?? "0");
    const canManageGuild =
      installerGuild?.owner === true ||
      (installerPermissions & (1n << 5n)) === 1n << 5n ||
      (installerPermissions & (1n << 3n)) === 1n << 3n;
    if (
      !installerGuild ||
      !canManageGuild ||
      botGuild.id !== callback.guildId
    ) {
      throw new DiscordInstallationProviderError(
        "AUTHORIZATION_INVALID",
        false,
      );
    }
    return {
      guildId: botGuild.id,
      guildDisplayName: botGuild.name,
      installerUserId: user.id,
    };
  }

  async leaveGuild(guildId: string) {
    const response = await this.request(
      `users/@me/guilds/${encodeURIComponent(guildId)}`,
      {
        method: "DELETE",
        headers: this.headers(`Bot ${this.configuration.botToken}`),
      },
    );
    if (response.ok || response.status === 404) return;
    throw this.responseError(response.status);
  }

  private async exchange(code: string) {
    const response = await this.request("oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "BaseballStatTrack-Discord-Onboarding/1",
      },
      body: new URLSearchParams({
        client_id: this.configuration.clientId,
        client_secret: this.configuration.clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: this.configuration.redirectUri,
      }),
    });
    if (!response.ok) throw this.responseError(response.status);
    try {
      return tokenSchema.parse(await response.json());
    } catch {
      throw new DiscordInstallationProviderError("PROVIDER_UNAVAILABLE", true);
    }
  }

  private async getJson<Schema extends z.ZodType>(
    path: string,
    authorization: string,
    schema: Schema,
  ): Promise<z.output<Schema>> {
    const response = await this.request(path, {
      headers: this.headers(authorization),
    });
    if (!response.ok) throw this.responseError(response.status);
    try {
      return schema.parse(await response.json());
    } catch {
      throw new DiscordInstallationProviderError("PROVIDER_UNAVAILABLE", true);
    }
  }

  private headers(authorization: string) {
    return {
      Authorization: authorization,
      Accept: "application/json",
      "User-Agent": "BaseballStatTrack-Discord-Onboarding/1",
    };
  }

  private async request(path: string, init: RequestInit) {
    try {
      return await this.fetcher(new URL(path, this.apiBase), {
        ...init,
        signal: AbortSignal.timeout(this.configuration.timeoutMs),
      });
    } catch {
      throw new DiscordInstallationProviderError("PROVIDER_UNAVAILABLE", true);
    }
  }

  private responseError(status: number) {
    if (status === 401 || status === 403) {
      return new DiscordInstallationProviderError(
        "AUTHENTICATION_FAILED",
        false,
      );
    }
    if (status === 429) {
      return new DiscordInstallationProviderError("RATE_LIMITED", true);
    }
    if (status >= 500 || status === 408) {
      return new DiscordInstallationProviderError("PROVIDER_UNAVAILABLE", true);
    }
    return new DiscordInstallationProviderError("AUTHORIZATION_INVALID", false);
  }
}
