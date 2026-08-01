import { describe, expect, it, vi } from "vitest";

import { DiscordChannelRoutingService } from "@/server/app/discord-channel-routing-service";
import {
  createTrustedActorContext,
  type Capability,
} from "@/server/auth/types";
import { DiscordChannelProviderError } from "@/server/providers/discord-channels";

const account = "account-a";
const installation = "00000000-0000-4000-8000-000000000901";
const destination = "00000000-0000-4000-8000-000000000902";

function actor(capability: Capability, accountId = account) {
  return createTrustedActorContext({
    accountId,
    appUserId: "user-a",
    membershipId: "membership-a",
    actorKind: "USER",
    actorId: "user-a",
    actorUserId: "user-a",
    capability,
    authorityReferenceIds: ["role-a"],
    target: {
      kind: "ACCOUNT",
      accountId,
      teamIds: [],
      seasonId: null,
      gameId: null,
    },
    authorizedAt: "2026-08-01T04:00:00.000Z",
  });
}

const configuration = {
  installation: {
    id: installation,
    guildId: "123456789012345601",
    guildDisplayName: "League server",
    status: "ACTIVE",
  },
  settings: {
    id: "00000000-0000-4000-8000-000000000903",
    schemaVersion: 1,
    revision: 4,
    enabled: true,
    trackedScopes: [
      {
        teamId: "00000000-0000-4000-8000-000000000904",
        seasonId: "00000000-0000-4000-8000-000000000905",
      },
    ],
    destinations: [],
    cadenceMode: "FIXED_INTERVAL" as const,
    cadenceSeconds: 60,
    gameDayWindow: { enabled: false, startMinute: 480, endMinute: 1_380 },
    digest: { enabled: false, minute: 540 },
    catchUpPolicy: "LATEST_ONLY" as const,
    triggers: ["SCORE_CHANGED"],
    messageFormat: "STANDARD",
    quietHours: {
      enabled: false,
      startMinute: 1_320,
      endMinute: 420,
      timeZone: "UTC",
    },
    pausedAt: null,
    manualRefreshRequestedAt: null,
    nextScheduledEvaluationAt: new Date(),
    lastSuccessfulUpdateAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
};

const workspace = {
  installation: { id: installation, status: "ACTIVE" },
  channels: [
    {
      id: destination,
      displayName: "scores",
      enabled: true,
      lastVerifiedAt: new Date(),
      updatedAt: new Date(),
    },
  ],
  missingPermissions: { viewChannel: 0, sendMessages: 0 },
  lastVerifiedAt: new Date(),
};

function harness(overrides: Record<string, unknown> = {}) {
  const repository = {
    getWorkspace: vi.fn().mockResolvedValue(workspace),
    providerIdentity: vi.fn().mockResolvedValue({
      id: "installation-internal",
      guildId: "123456789012345601",
      status: "ACTIVE",
    }),
    syncChannels: vi.fn().mockResolvedValue(workspace),
    setChannelEnabled: vi.fn().mockResolvedValue({ outcome: "updated" }),
    resolveTestDestination: vi.fn().mockResolvedValue({
      internalId: "destination-internal",
      guildId: "123456789012345601",
      channelId: "223456789012345601",
    }),
    recordTestDelivery: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  const settings = {
    getConfiguration: vi.fn().mockResolvedValue(configuration),
    writeConfiguration: vi.fn().mockImplementation(async (input) => ({
      outcome: "updated",
      configuration: {
        ...configuration,
        settings: { ...configuration.settings, revision: 5, ...input },
      },
    })),
  };
  const provider = {
    listTextChannels: vi.fn().mockResolvedValue([
      {
        channelId: "223456789012345601",
        displayName: "scores",
        canView: true,
        canSend: true,
      },
    ]),
    sendTestDelivery: vi.fn().mockResolvedValue(undefined),
  };
  const service = new DiscordChannelRoutingService(
    repository as never,
    settings as never,
    () =>
      ({
        botToken: "b".repeat(40),
        apiBaseUrl: "https://discord.example.test/api/v10/",
      }) as never,
    () => provider,
  );
  return { service, repository, settings, provider };
}

describe("Discord channel routing administration", () => {
  it("reads only through exact Account view authority", async () => {
    const { service, repository } = harness();
    await expect(
      service.get(account, installation, actor("discord.settings.view")),
    ).resolves.toMatchObject({ channels: [{ id: destination }] });
    await expect(
      service.get("account-b", installation, actor("discord.settings.view")),
    ).rejects.toThrow();
    expect(repository.getWorkspace).toHaveBeenCalledTimes(1);
  });

  it("revalidates provider permissions and writes all six routes immediately", async () => {
    const { service, repository, settings, provider } = harness();
    await service.updateRouting(
      {
        accountId: account,
        installationId: installation,
        expectedRevision: 4,
        routes: {
          LIVE_UPDATES: destination,
          FINAL_SCORES: destination,
          CORRECTIONS: null,
          SUMMARIES: null,
          ERRORS: null,
          DIGESTS: null,
        },
      },
      actor("discord.settings.configure"),
    );
    expect(provider.listTextChannels).toHaveBeenCalledTimes(1);
    expect(repository.syncChannels).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: account }),
    );
    expect(settings.writeConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedRevision: 4,
        destinations: [
          {
            destinationId: destination,
            purposes: ["LIVE_UPDATES", "FINAL_SCORES"],
          },
        ],
        auditAction: "update",
      }),
    );
  });

  it("fails closed when a selected destination is no longer routable", async () => {
    const { service, settings } = harness({
      syncChannels: vi.fn().mockResolvedValue({
        ...workspace,
        channels: [{ ...workspace.channels[0], enabled: false }],
      }),
    });
    await expect(
      service.updateRouting(
        {
          accountId: account,
          installationId: installation,
          expectedRevision: 4,
          routes: {
            LIVE_UPDATES: destination,
            FINAL_SCORES: null,
            CORRECTIONS: null,
            SUMMARIES: null,
            ERRORS: null,
            DIGESTS: null,
          },
        },
        actor("discord.settings.configure"),
      ),
    ).rejects.toMatchObject({ code: "PERMISSION_REQUIRED", status: 409 });
    expect(settings.writeConfiguration).not.toHaveBeenCalled();
  });

  it("audits successful and failed test deliveries without retrying", async () => {
    const success = harness();
    await success.service.testDelivery(
      {
        accountId: account,
        installationId: installation,
        destinationId: destination,
        messageFormat: "DETAILED",
      },
      actor("discord.settings.preview"),
    );
    expect(success.repository.recordTestDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ succeeded: true, messageFormat: "DETAILED" }),
    );

    const failed = harness();
    failed.provider.sendTestDelivery.mockRejectedValueOnce(
      new DiscordChannelProviderError("PERMISSION_REQUIRED", false),
    );
    await expect(
      failed.service.testDelivery(
        {
          accountId: account,
          installationId: installation,
          destinationId: destination,
          messageFormat: "COMPACT",
        },
        actor("discord.settings.preview"),
      ),
    ).rejects.toMatchObject({ code: "PERMISSION_REQUIRED" });
    expect(failed.provider.sendTestDelivery).toHaveBeenCalledTimes(1);
    expect(failed.repository.recordTestDelivery).toHaveBeenLastCalledWith(
      expect.objectContaining({
        succeeded: false,
        failureCode: "PERMISSION_REQUIRED",
      }),
    );
  });
});
