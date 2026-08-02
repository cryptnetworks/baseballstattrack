import { z } from "zod";

import {
  DISCORD_INSTALLATION_PERMISSION_FLAGS,
  discordSnowflakeSchema,
} from "@/domain/discord-installation";
import type { DiscordMessageFormat } from "@/domain/discord-settings";
import type { DiscordInstallationConfiguration } from "@/server/config/discord-installation";

type Fetcher = typeof fetch;

const administrator = 1n << 3n;
const channelSchema = z
  .object({
    id: discordSnowflakeSchema,
    name: z.string().trim().min(1).max(100),
    type: z.number().int(),
    permission_overwrites: z
      .array(
        z
          .object({
            id: discordSnowflakeSchema,
            type: z.union([z.literal(0), z.literal(1)]),
            allow: z.string().regex(/^\d{1,32}$/u),
            deny: z.string().regex(/^\d{1,32}$/u),
          })
          .loose(),
      )
      .max(500),
  })
  .loose();
const roleSchema = z
  .object({
    id: discordSnowflakeSchema,
    permissions: z.string().regex(/^\d{1,32}$/u),
  })
  .loose();
const memberSchema = z
  .object({ roles: z.array(discordSnowflakeSchema).max(250) })
  .loose();
const userSchema = z.object({ id: discordSnowflakeSchema }).loose();

export class DiscordChannelProviderError extends Error {
  constructor(
    readonly code:
      | "AUTHENTICATION_FAILED"
      | "PERMISSION_REQUIRED"
      | "RATE_LIMITED"
      | "PROVIDER_UNAVAILABLE",
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = "DiscordChannelProviderError";
  }
}

export type VerifiedDiscordChannel = Readonly<{
  channelId: string;
  displayName: string;
  canView: boolean;
  canSend: boolean;
}>;

export interface DiscordChannelProvider {
  listTextChannels(guildId: string): Promise<readonly VerifiedDiscordChannel[]>;
  sendTestDelivery(
    guildId: string,
    channelId: string,
    messageFormat: DiscordMessageFormat,
  ): Promise<void>;
}

export function effectiveDiscordChannelPermissions(input: {
  guildId: string;
  botUserId: string;
  memberRoleIds: readonly string[];
  roles: readonly Readonly<{ id: string; permissions: string }>[];
  overwrites: readonly Readonly<{
    id: string;
    type: 0 | 1;
    allow: string;
    deny: string;
  }>[];
}) {
  const memberRoles = new Set(input.memberRoleIds);
  let permissions = 0n;
  for (const role of input.roles) {
    if (role.id === input.guildId || memberRoles.has(role.id)) {
      permissions |= BigInt(role.permissions);
    }
  }
  if ((permissions & administrator) === administrator) return ~0n;

  const apply = (deny: bigint, allow: bigint) => {
    permissions &= ~deny;
    permissions |= allow;
  };
  const everyone = input.overwrites.find(
    ({ id, type }) => type === 0 && id === input.guildId,
  );
  if (everyone) apply(BigInt(everyone.deny), BigInt(everyone.allow));

  let roleDeny = 0n;
  let roleAllow = 0n;
  for (const overwrite of input.overwrites) {
    if (overwrite.type === 0 && memberRoles.has(overwrite.id)) {
      roleDeny |= BigInt(overwrite.deny);
      roleAllow |= BigInt(overwrite.allow);
    }
  }
  apply(roleDeny, roleAllow);
  const member = input.overwrites.find(
    ({ id, type }) => type === 1 && id === input.botUserId,
  );
  if (member) apply(BigInt(member.deny), BigInt(member.allow));
  return permissions;
}

function testMessage(format: DiscordMessageFormat) {
  const marker = "[TEST ONLY — SYNTHETIC — NOT A LIVE UPDATE]";
  if (format === "COMPACT") {
    return `${marker}\nBaseball Stat Track test • Compact • No game data`;
  }
  if (format === "DETAILED") {
    return [
      marker,
      "Baseball Stat Track configuration test delivery",
      "Format: Detailed",
      "• Channel permissions verified",
      "• No game or player data included",
    ].join("\n");
  }
  return [
    marker,
    "Baseball Stat Track configuration test delivery",
    "Format: Standard",
    "This is synthetic. No game or player data is included.",
  ].join("\n");
}

export class ConfiguredDiscordChannelProvider implements DiscordChannelProvider {
  private readonly apiBase: string;

  constructor(
    private readonly configuration: DiscordInstallationConfiguration,
    private readonly fetcher: Fetcher = fetch,
  ) {
    this.apiBase = configuration.apiBaseUrl;
  }

  async listTextChannels(guildId: string) {
    const authorization = `Bot ${this.configuration.botToken}`;
    const user = await this.getJson("users/@me", userSchema, authorization);
    const [member, roles, channels] = await Promise.all([
      this.getJson(
        `guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(user.id)}`,
        memberSchema,
        authorization,
      ),
      this.getJson(
        `guilds/${encodeURIComponent(guildId)}/roles`,
        z.array(roleSchema).max(250),
        authorization,
      ),
      this.getJson(
        `guilds/${encodeURIComponent(guildId)}/channels`,
        z.array(channelSchema).max(500),
        authorization,
      ),
    ]);
    return channels
      .filter(({ type }) => type === 0 || type === 5)
      .map((channel) => {
        const permissions = effectiveDiscordChannelPermissions({
          guildId,
          botUserId: user.id,
          memberRoleIds: member.roles,
          roles,
          overwrites: channel.permission_overwrites,
        });
        return {
          channelId: channel.id,
          displayName: channel.name,
          canView:
            (permissions &
              DISCORD_INSTALLATION_PERMISSION_FLAGS.viewChannel) ===
            DISCORD_INSTALLATION_PERMISSION_FLAGS.viewChannel,
          canSend:
            (permissions &
              DISCORD_INSTALLATION_PERMISSION_FLAGS.sendMessages) ===
            DISCORD_INSTALLATION_PERMISSION_FLAGS.sendMessages,
        };
      });
  }

  async sendTestDelivery(
    guildId: string,
    channelId: string,
    messageFormat: DiscordMessageFormat,
  ) {
    void guildId;
    const response = await this.request(
      `channels/${encodeURIComponent(channelId)}/messages`,
      {
        method: "POST",
        headers: this.headers(`Bot ${this.configuration.botToken}`),
        body: JSON.stringify({
          content: testMessage(messageFormat),
          allowed_mentions: { parse: [] },
        }),
      },
    );
    if (!response.ok) throw this.responseError(response.status);
  }

  private async getJson<Schema extends z.ZodType>(
    path: string,
    schema: Schema,
    authorization: string,
  ): Promise<z.output<Schema>> {
    const response = await this.request(path, {
      headers: this.headers(authorization),
    });
    if (!response.ok) throw this.responseError(response.status);
    try {
      return schema.parse(await response.json());
    } catch {
      throw new DiscordChannelProviderError("PROVIDER_UNAVAILABLE", true);
    }
  }

  private headers(authorization: string) {
    return {
      Authorization: authorization,
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "BaseballStatTrack-Discord-Channels/1",
    };
  }

  private async request(path: string, init: RequestInit) {
    try {
      return await this.fetcher(new URL(path, this.apiBase), {
        ...init,
        signal: AbortSignal.timeout(this.configuration.timeoutMs),
      });
    } catch {
      throw new DiscordChannelProviderError("PROVIDER_UNAVAILABLE", true);
    }
  }

  private responseError(status: number) {
    if (status === 401) {
      return new DiscordChannelProviderError("AUTHENTICATION_FAILED", false);
    }
    if (status === 403 || status === 404) {
      return new DiscordChannelProviderError("PERMISSION_REQUIRED", false);
    }
    if (status === 429) {
      return new DiscordChannelProviderError("RATE_LIMITED", true);
    }
    return new DiscordChannelProviderError(
      "PROVIDER_UNAVAILABLE",
      status >= 500,
    );
  }
}
