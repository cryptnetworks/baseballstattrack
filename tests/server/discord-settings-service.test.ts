import { describe, expect, it, vi } from "vitest";

import { DiscordSettingsService } from "@/server/app/discord-settings-service";
import { createTrustedActorContext } from "@/server/auth/types";
import { DiscordSettingsConflictError } from "@/server/data/discord-settings-repository";

const ACCOUNT = "account-a";
const INSTALLATION = "00000000-0000-4000-8000-000000000701";
const TEAM = "00000000-0000-4000-8000-000000000702";
const SEASON = "00000000-0000-4000-8000-000000000703";
const DESTINATION = "00000000-0000-4000-8000-000000000704";

function actor(accountId = ACCOUNT) {
  return createTrustedActorContext({
    accountId,
    appUserId: "user-a",
    membershipId: "membership-a",
    actorKind: "USER",
    actorId: "user-a",
    actorUserId: "user-a",
    capability: "discord.settings.configure",
    authorityReferenceIds: ["role-a"],
    target: {
      kind: "ACCOUNT",
      accountId,
      teamIds: [],
      seasonId: null,
      gameId: null,
    },
    authorizedAt: "2026-07-31T23:00:00.000Z",
  });
}

function update() {
  return {
    accountId: ACCOUNT,
    installationId: INSTALLATION,
    expectedRevision: 0,
    enabled: true,
    trackedScopes: [{ teamId: TEAM, seasonId: SEASON }],
    destinations: [
      {
        destinationId: DESTINATION,
        purposes: ["LIVE_UPDATES" as const, "CORRECTIONS" as const],
      },
    ],
    cadenceMode: "FIXED_INTERVAL" as const,
    cadenceSeconds: 60,
    gameDayWindow: { enabled: false, startMinute: 480, endMinute: 1_380 },
    digest: { enabled: false, minute: 540 },
    catchUpPolicy: "LATEST_ONLY" as const,
    triggers: ["SCORE_CHANGED" as const, "GAME_CORRECTED" as const],
    messageStrategy: "EDIT_LIVE_MESSAGE" as const,
    messageFormat: "STANDARD" as const,
    quietHours: {
      enabled: false,
      startMinute: 1_320,
      endMinute: 420,
      timeZone: "UTC",
    },
  };
}

const configuration = {
  installation: {
    id: INSTALLATION,
    guildId: "123456789012345678",
    guildDisplayName: "Synthetic guild",
    status: "ACTIVE",
  },
  settings: {
    id: "00000000-0000-4000-8000-000000000705",
    schemaVersion: 1,
    revision: 1,
    enabled: true,
    trackedScopes: [{ teamId: TEAM, seasonId: SEASON }],
    destinations: [],
    cadenceMode: "FIXED_INTERVAL" as const,
    cadenceSeconds: 60,
    gameDayWindow: { enabled: false, startMinute: 480, endMinute: 1_380 },
    digest: { enabled: false, minute: 540 },
    catchUpPolicy: "LATEST_ONLY" as const,
    triggers: ["SCORE_CHANGED", "GAME_CORRECTED"],
    messageStrategy: "EDIT_LIVE_MESSAGE",
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

describe("Discord settings administration", () => {
  it("requires exact Account administration and writes a complete document", async () => {
    const repository = {
      writeConfiguration: vi
        .fn()
        .mockResolvedValue({ outcome: "updated", configuration }),
    };
    const service = new DiscordSettingsService(repository as never);
    await expect(service.update(update(), actor())).resolves.toEqual(
      configuration,
    );
    expect(repository.writeConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedRevision: 0,
        auditAction: "update",
        actor: expect.objectContaining({ accountId: ACCOUNT }),
      }),
    );
    await expect(
      service.update({ ...update(), accountId: "account-b" }, actor()),
    ).rejects.toThrow();
    expect(repository.writeConfiguration).toHaveBeenCalledTimes(1);
  });

  it("maps stale revisions and inactive installations to safe conflicts", async () => {
    const conflict = new DiscordSettingsService({
      writeConfiguration: vi
        .fn()
        .mockRejectedValue(new DiscordSettingsConflictError()),
    } as never);
    await expect(conflict.update(update(), actor())).rejects.toMatchObject({
      code: "REVISION_CONFLICT",
      status: 409,
    });

    const inactive = new DiscordSettingsService({
      writeConfiguration: vi
        .fn()
        .mockResolvedValue({ outcome: "installation_inactive" }),
    } as never);
    await expect(inactive.update(update(), actor())).rejects.toMatchObject({
      code: "INSTALLATION_INACTIVE",
      status: 409,
    });
  });

  it("resets every category to disabled defaults with audit reason", async () => {
    const repository = {
      writeConfiguration: vi
        .fn()
        .mockResolvedValue({ outcome: "updated", configuration }),
    };
    const service = new DiscordSettingsService(repository as never);
    await service.reset(
      {
        accountId: ACCOUNT,
        installationId: INSTALLATION,
        expectedRevision: 8,
        reasonCode: "OPERATOR_RESET",
      },
      actor(),
    );
    expect(repository.writeConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: false,
        trackedScopes: [],
        destinations: [],
        cadenceSeconds: 300,
        messageStrategy: "FINAL_ONLY",
        messageFormat: "STANDARD",
        auditAction: "reset",
        reasonCode: "OPERATOR_RESET",
      }),
    );
  });
});
