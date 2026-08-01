import { describe, expect, it, vi } from "vitest";

import { DiscordUpdateContentService } from "@/server/app/discord-update-content-service";
import { createTrustedActorContext } from "@/server/auth/types";

const ACCOUNT = "account-a";
const INSTALLATION = "00000000-0000-4000-8000-000000002101";

function actor(
  capability: "discord.settings.view" | "discord.settings.configure",
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
    authorizedAt: "2026-08-01T06:00:00.000Z",
  });
}

function configuration(status: "ACTIVE" | "REVOKED" = "ACTIVE") {
  return {
    installation: {
      id: INSTALLATION,
      guildId: "123456789012345678",
      guildDisplayName: "Synthetic guild",
      status,
    },
    settings: {
      id: "00000000-0000-4000-8000-000000002102",
      schemaVersion: 1,
      revision: 7,
      enabled: true,
      trackedScopes: [
        {
          teamId: "00000000-0000-4000-8000-000000002103",
          seasonId: "00000000-0000-4000-8000-000000002104",
        },
      ],
      destinations: [
        {
          destinationId: "00000000-0000-4000-8000-000000002105",
          channelReference: "managed/channel",
          displayName: "scores",
          available: true,
          purposes: ["LIVE_UPDATES" as const],
        },
      ],
      cadenceMode: "EVENT_DRIVEN" as const,
      cadenceSeconds: 300,
      gameDayWindow: { enabled: false, startMinute: 480, endMinute: 1_380 },
      digest: { enabled: true, minute: 540 },
      catchUpPolicy: "LATEST_ONLY" as const,
      triggers: ["GAME_COMPLETED" as const, "GAME_CORRECTED" as const],
      messageStrategy: "FINAL_ONLY" as const,
      messageFormat: "STANDARD" as const,
      quietHours: {
        enabled: true,
        startMinute: 1_320,
        endMinute: 420,
        timeZone: "America/New_York",
      },
      pausedAt: null,
      manualRefreshRequestedAt: null,
      nextScheduledEvaluationAt: null,
      lastSuccessfulUpdateAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };
}

describe("Discord update content administration", () => {
  it("preserves unrelated settings and writes content under exact authority", async () => {
    const current = configuration();
    const repository = {
      getConfiguration: vi.fn().mockResolvedValue(current),
      writeConfiguration: vi
        .fn()
        .mockResolvedValue({ outcome: "updated", configuration: current }),
    };
    const rateLimits = { enforce: vi.fn().mockResolvedValue(undefined) };
    const service = new DiscordUpdateContentService(
      repository as never,
      rateLimits,
    );
    await service.update(
      {
        accountId: ACCOUNT,
        installationId: INSTALLATION,
        expectedRevision: 7,
        triggers: ["SCORING_PLAY", "GAME_COMPLETED", "GAME_CORRECTED"],
        messageStrategy: "APPEND_EVENTS",
        messageFormat: "COMPACT",
      },
      actor("discord.settings.configure"),
    );
    expect(rateLimits.enforce).toHaveBeenCalledOnce();
    expect(repository.writeConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        cadenceMode: "EVENT_DRIVEN",
        digest: { enabled: true, minute: 540 },
        triggers: ["SCORING_PLAY", "GAME_COMPLETED", "GAME_CORRECTED"],
        messageStrategy: "APPEND_EVENTS",
        messageFormat: "COMPACT",
        reasonCode: "UPDATE_CONTENT_CHANGED",
      }),
    );
    await expect(
      service.update(
        {
          accountId: ACCOUNT,
          installationId: INSTALLATION,
          expectedRevision: 7,
          triggers: ["GAME_COMPLETED", "GAME_CORRECTED"],
          messageStrategy: "FINAL_ONLY",
          messageFormat: "STANDARD",
        },
        actor("discord.settings.configure", "account-b"),
      ),
    ).rejects.toThrow();
    expect(repository.writeConfiguration).toHaveBeenCalledTimes(1);
  });

  it("allows authorized reads but rejects writes to inactive installations", async () => {
    const current = configuration("REVOKED");
    const repository = { getConfiguration: vi.fn().mockResolvedValue(current) };
    const service = new DiscordUpdateContentService(repository as never);
    await expect(
      service.get(ACCOUNT, INSTALLATION, actor("discord.settings.view")),
    ).resolves.toEqual(current);
    await expect(
      service.update(
        {
          accountId: ACCOUNT,
          installationId: INSTALLATION,
          expectedRevision: 7,
          triggers: ["GAME_COMPLETED", "GAME_CORRECTED"],
          messageStrategy: "FINAL_ONLY",
          messageFormat: "STANDARD",
        },
        actor("discord.settings.configure"),
      ),
    ).rejects.toMatchObject({ code: "INSTALLATION_INACTIVE", status: 409 });
  });
});
