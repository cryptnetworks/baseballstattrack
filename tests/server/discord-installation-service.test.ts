import { describe, expect, it, vi } from "vitest";

import { DISCORD_INSTALLATION_PERMISSIONS } from "@/domain/discord-installation";
import { DiscordInstallationService } from "@/server/app/discord-installation-service";
import { issueDiscordOAuthState } from "@/server/auth/discord-oauth-state";
import {
  createTrustedActorContext,
  type Capability,
} from "@/server/auth/types";
import type { DiscordInstallationConfiguration } from "@/server/config/discord-installation";

const ACCOUNT = "account-a";
const INSTALLATION = "00000000-0000-4000-8000-000000000110";
const GUILD = "123456789012345678";
const configuration: DiscordInstallationConfiguration = {
  clientId: GUILD,
  clientSecret: "c".repeat(40),
  botToken: "b".repeat(40),
  credentialReference: "discord/bot/production",
  stateSecret: "s".repeat(40),
  redirectUri:
    "https://app.example.test/api/admin/discord-installations/callback",
  apiBaseUrl: "https://discord.com/api/v10/",
  timeoutMs: 8_000,
};

function actor(
  capability: Capability,
  accountId = ACCOUNT,
  appUserId = "user-a",
) {
  return createTrustedActorContext({
    accountId,
    appUserId,
    membershipId: "membership-a",
    actorKind: "USER",
    actorId: appUserId,
    actorUserId: appUserId,
    capability,
    authorityReferenceIds: ["role-a"],
    target: {
      kind: "ACCOUNT",
      accountId,
      teamIds: [],
      seasonId: null,
      gameId: null,
    },
    authorizedAt: "2026-07-31T20:00:00.000Z",
  });
}

function dependencies() {
  const installation = {
    id: INSTALLATION,
    displayName: "Verified guild",
    status: "ACTIVE" as const,
  };
  const repository = {
    list: vi.fn().mockResolvedValue([installation]),
    providerIdentity: vi
      .fn()
      .mockResolvedValue({ id: "internal", guildId: GUILD, status: "ACTIVE" }),
    connect: vi.fn().mockResolvedValue({ outcome: "connected", installation }),
    disconnect: vi
      .fn()
      .mockResolvedValue({ outcome: "disconnected", installation }),
  };
  const provider = {
    authorizationUrl: vi.fn((state: string) => `https://discord.test/${state}`),
    verifyAuthorization: vi.fn().mockResolvedValue({
      guildId: GUILD,
      guildDisplayName: "Verified guild",
      installerUserId: "223456789012345678",
    }),
    leaveGuild: vi.fn().mockResolvedValue(undefined),
  };
  const rates = { enforce: vi.fn().mockResolvedValue(undefined) };
  const service = new DiscordInstallationService(
    repository as never,
    () => configuration,
    () => provider,
    rates,
  );
  return { service, repository, provider, rates };
}

describe("Discord installation administration", () => {
  it("starts only for the exact Account and rate limits administration", async () => {
    const { service, provider, rates } = dependencies();
    const result = await service.begin(
      { action: "start", accountId: ACCOUNT },
      actor("discord.settings.configure"),
    );
    expect(result.authorizationUrl).toMatch(/^https:\/\/discord\.test\//u);
    expect(result.stateCookie).not.toContain(ACCOUNT);
    expect(provider.authorizationUrl).toHaveBeenCalledOnce();
    expect(rates.enforce).toHaveBeenCalledWith(
      { accountId: ACCOUNT, endpointClass: "ADMINISTRATION" },
      expect.objectContaining({ accountId: ACCOUNT }),
    );
    await expect(
      service.begin(
        { action: "start", accountId: "account-b" },
        actor("discord.settings.configure"),
      ),
    ).rejects.toThrow();
  });

  it("binds callback completion to the same AppUser and Account", async () => {
    const { service, repository } = dependencies();
    const issued = issueDiscordOAuthState({
      accountId: ACCOUNT,
      actorUserId: "user-a",
      secret: configuration.stateSecret,
    });
    const callback = {
      code: "authorization-code",
      state: issued.nonce,
      guildId: GUILD,
      permissions: DISCORD_INSTALLATION_PERMISSIONS.toString(),
    };
    await expect(
      service.complete(
        callback,
        issued.cookieValue,
        actor("discord.settings.configure"),
        "correlation-a",
      ),
    ).resolves.toMatchObject({ id: INSTALLATION });
    expect(repository.connect).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: ACCOUNT,
        guildId: GUILD,
        credentialReference: configuration.credentialReference,
        installerFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
        correlationId: "correlation-a",
      }),
    );
    await expect(
      service.complete(
        callback,
        issued.cookieValue,
        actor("discord.settings.configure", ACCOUNT, "user-b"),
      ),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_INVALID" });
  });

  it("leaves the exact provider guild before persisted cleanup", async () => {
    const { service, repository, provider } = dependencies();
    await service.disconnect(
      {
        action: "disconnect",
        accountId: ACCOUNT,
        installationId: INSTALLATION,
      },
      actor("discord.settings.operate"),
      "correlation-a",
    );
    expect(provider.leaveGuild).toHaveBeenCalledWith(GUILD);
    expect(repository.disconnect).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: ACCOUNT,
        installationExternalId: INSTALLATION,
        correlationId: "correlation-a",
      }),
    );
    expect(provider.leaveGuild.mock.invocationCallOrder[0]).toBeLessThan(
      repository.disconnect.mock.invocationCallOrder[0]!,
    );
  });

  it("does not mutate when provider disconnect fails", async () => {
    const { service, repository, provider } = dependencies();
    provider.leaveGuild.mockRejectedValue(new Error("provider unavailable"));
    await expect(
      service.disconnect(
        {
          action: "disconnect",
          accountId: ACCOUNT,
          installationId: INSTALLATION,
        },
        actor("discord.settings.operate"),
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE", status: 503 });
    expect(repository.disconnect).not.toHaveBeenCalled();
  });
});
