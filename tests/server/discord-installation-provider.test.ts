import { describe, expect, it, vi } from "vitest";

import { DISCORD_INSTALLATION_PERMISSIONS } from "@/domain/discord-installation";
import type { DiscordInstallationConfiguration } from "@/server/config/discord-installation";
import {
  ConfiguredDiscordInstallationProvider,
  DiscordInstallationProviderError,
} from "@/server/providers/discord-installation";

const configuration: DiscordInstallationConfiguration = {
  clientId: "123456789012345678",
  clientSecret: "c".repeat(40),
  botToken: "b".repeat(40),
  credentialReference: "discord/bot/production",
  stateSecret: "s".repeat(40),
  redirectUri:
    "https://app.example.test/api/admin/discord-installations/callback",
  apiBaseUrl: "https://discord.com/api/v10/",
  timeoutMs: 8_000,
};
const callback = {
  code: "authorization-code",
  state: "x".repeat(43),
  guildId: "123456789012345678",
  permissions: DISCORD_INSTALLATION_PERMISSIONS.toString(),
};

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Discord installation provider", () => {
  it("builds a state-bound least-privilege authorization URL", () => {
    const provider = new ConfiguredDiscordInstallationProvider(configuration);
    const url = new URL(provider.authorizationUrl("x".repeat(43)));
    expect(url.origin + url.pathname).toBe(
      "https://discord.com/oauth2/authorize",
    );
    expect(url.searchParams.get("scope")?.split(" ")).toEqual([
      "identify",
      "guilds",
      "bot",
      "applications.commands",
    ]);
    expect(url.searchParams.get("permissions")).toBe(
      DISCORD_INSTALLATION_PERMISSIONS.toString(),
    );
    expect(BigInt(url.searchParams.get("permissions")!) & (1n << 3n)).toBe(0n);
    expect(url.searchParams.get("state")).toBe("x".repeat(43));
  });

  it("freshly verifies user, manager membership, bot presence, and scopes", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        json({
          access_token: "transient-user-access-token",
          token_type: "Bearer",
          scope: "identify guilds bot applications.commands",
        }),
      )
      .mockResolvedValueOnce(json({ id: "223456789012345678" }))
      .mockResolvedValueOnce(
        json([
          {
            id: callback.guildId,
            name: "Managed guild",
            owner: false,
            permissions: (1n << 5n).toString(),
          },
        ]),
      )
      .mockResolvedValueOnce(
        json({ id: callback.guildId, name: "Verified guild" }),
      );
    const provider = new ConfiguredDiscordInstallationProvider(
      configuration,
      fetcher as typeof fetch,
    );
    await expect(provider.verifyAuthorization(callback)).resolves.toEqual({
      guildId: callback.guildId,
      guildDisplayName: "Verified guild",
      installerUserId: "223456789012345678",
    });
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain("oauth2/token");
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain(
      configuration.credentialReference,
    );
  });

  it("rejects missing permission grants before exchanging a code", async () => {
    const fetcher = vi.fn();
    const provider = new ConfiguredDiscordInstallationProvider(
      configuration,
      fetcher as typeof fetch,
    );
    await expect(
      provider.verifyAuthorization({ ...callback, permissions: "0" }),
    ).rejects.toBeInstanceOf(DiscordInstallationProviderError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("fails when the installer cannot manage the selected guild", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        json({
          access_token: "transient-user-access-token",
          token_type: "Bearer",
          scope: "identify guilds bot applications.commands",
        }),
      )
      .mockResolvedValueOnce(json({ id: "223456789012345678" }))
      .mockResolvedValueOnce(
        json([
          {
            id: callback.guildId,
            name: "Guild",
            owner: false,
            permissions: "0",
          },
        ]),
      )
      .mockResolvedValueOnce(json({ id: callback.guildId, name: "Guild" }));
    const provider = new ConfiguredDiscordInstallationProvider(
      configuration,
      fetcher as typeof fetch,
    );
    await expect(provider.verifyAuthorization(callback)).rejects.toMatchObject({
      code: "AUTHORIZATION_INVALID",
      retryable: false,
    });
  });

  it("treats an already-absent bot as an idempotent disconnect", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 404 }));
    const provider = new ConfiguredDiscordInstallationProvider(
      configuration,
      fetcher as typeof fetch,
    );
    await expect(
      provider.leaveGuild(callback.guildId),
    ).resolves.toBeUndefined();
  });
});
