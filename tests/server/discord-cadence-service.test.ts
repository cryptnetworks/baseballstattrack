import { describe, expect, it, vi } from "vitest";

import {
  DiscordCadenceError,
  DiscordCadenceService,
} from "@/server/app/discord-cadence-service";
import { createTrustedActorContext } from "@/server/auth/types";

const ACCOUNT = "account-a";
const INSTALLATION = "00000000-0000-4000-8000-000000001801";

function actor(
  capability:
    | "discord.settings.view"
    | "discord.settings.configure"
    | "discord.settings.operate",
  accountId = ACCOUNT,
) {
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
    authorizedAt: "2026-08-01T05:00:00.000Z",
  });
}

function configuration(enabled = true) {
  return {
    installation: {
      id: INSTALLATION,
      guildId: "123456789012345678",
      guildDisplayName: "Synthetic guild",
      status: "ACTIVE" as const,
    },
    settings: {
      id: "00000000-0000-4000-8000-000000001802",
      schemaVersion: 1,
      revision: 4,
      enabled,
      trackedScopes: [
        {
          teamId: "00000000-0000-4000-8000-000000001803",
          seasonId: "00000000-0000-4000-8000-000000001804",
        },
      ],
      destinations: [
        {
          destinationId: "00000000-0000-4000-8000-000000001805",
          channelReference: "managed/channel",
          displayName: "scores",
          available: true,
          purposes: ["LIVE_UPDATES" as const],
        },
      ],
      cadenceMode: "FIXED_INTERVAL" as const,
      cadenceSeconds: 300,
      gameDayWindow: { enabled: false, startMinute: 480, endMinute: 1_380 },
      digest: { enabled: false, minute: 540 },
      catchUpPolicy: "LATEST_ONLY" as const,
      triggers: ["SCORE_CHANGED" as const],
      messageFormat: "STANDARD" as const,
      quietHours: {
        enabled: false,
        startMinute: 1_320,
        endMinute: 420,
        timeZone: "UTC",
      },
      pausedAt: enabled ? null : new Date("2026-08-01T04:00:00.000Z"),
      manualRefreshRequestedAt: null,
      nextScheduledEvaluationAt: null,
      lastSuccessfulUpdateAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };
}

function update() {
  return {
    accountId: ACCOUNT,
    installationId: INSTALLATION,
    expectedRevision: 4,
    cadenceMode: "EVENT_DRIVEN" as const,
    cadenceSeconds: 300,
    gameDayWindow: { enabled: true, startMinute: 480, endMinute: 1_380 },
    digest: { enabled: true, minute: 540 },
    catchUpPolicy: "SKIP" as const,
    quietHours: {
      enabled: true,
      startMinute: 1_320,
      endMinute: 420,
      timeZone: "America/New_York",
    },
  };
}

describe("Discord cadence administration", () => {
  it("updates only schedule fields under exact-Account authority", async () => {
    const current = configuration();
    const repository = {
      getConfiguration: vi.fn().mockResolvedValue(current),
      writeConfiguration: vi
        .fn()
        .mockResolvedValue({ outcome: "updated", configuration: current }),
    };
    const service = new DiscordCadenceService(repository as never);
    await service.update(update(), actor("discord.settings.configure"));
    expect(repository.writeConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        cadenceMode: "EVENT_DRIVEN",
        trackedScopes: current.settings.trackedScopes,
        destinations: [expect.objectContaining({ purposes: ["LIVE_UPDATES"] })],
        triggers: ["SCORE_CHANGED"],
        reasonCode: "UPDATE_SCHEDULE_CHANGED",
      }),
    );
    await expect(
      service.update(
        update(),
        actor("discord.settings.configure", "account-b"),
      ),
    ).rejects.toThrow();
    expect(repository.writeConfiguration).toHaveBeenCalledTimes(1);
  });

  it("pauses idempotently, rejects stale state, and requires complete resume", async () => {
    const current = configuration();
    const repository = {
      getConfiguration: vi.fn().mockResolvedValue(current),
      writeConfiguration: vi
        .fn()
        .mockResolvedValue({ outcome: "updated", configuration: current }),
    };
    const service = new DiscordCadenceService(repository as never);
    await service.changeState(
      {
        accountId: ACCOUNT,
        installationId: INSTALLATION,
        expectedRevision: 4,
        operation: "PAUSE",
      },
      actor("discord.settings.configure"),
    );
    expect(repository.writeConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: false,
        reasonCode: "UPDATE_DELIVERY_PAUSED",
      }),
    );
    await expect(
      service.changeState(
        {
          accountId: ACCOUNT,
          installationId: INSTALLATION,
          expectedRevision: 3,
          operation: "PAUSE",
        },
        actor("discord.settings.configure"),
      ),
    ).rejects.toBeInstanceOf(DiscordCadenceError);

    const incomplete = configuration(false);
    incomplete.settings.trackedScopes = [];
    const resume = new DiscordCadenceService({
      getConfiguration: vi.fn().mockResolvedValue(incomplete),
    } as never);
    await expect(
      resume.changeState(
        {
          accountId: ACCOUNT,
          installationId: INSTALLATION,
          expectedRevision: 4,
          operation: "RESUME",
        },
        actor("discord.settings.configure"),
      ),
    ).rejects.toMatchObject({ code: "CONFIGURATION_INCOMPLETE" });
  });

  it("uses operate authority and a fixed clock for coalesced manual refresh", async () => {
    const now = new Date("2026-08-01T05:00:00.000Z");
    const repository = {
      requestManualRefresh: vi.fn().mockResolvedValue({
        outcome: "requested",
        coalesced: true,
        configuration: configuration(),
      }),
    };
    const service = new DiscordCadenceService(
      repository as never,
      undefined,
      () => now,
    );
    await expect(
      service.requestManualRefresh(
        {
          accountId: ACCOUNT,
          installationId: INSTALLATION,
          expectedRevision: 4,
        },
        actor("discord.settings.operate"),
      ),
    ).resolves.toMatchObject({ coalesced: true });
    expect(repository.requestManualRefresh).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: ACCOUNT, now }),
    );
    await expect(
      service.requestManualRefresh(
        {
          accountId: ACCOUNT,
          installationId: INSTALLATION,
          expectedRevision: 4,
        },
        actor("discord.settings.configure"),
      ),
    ).rejects.toThrow();
  });
});
