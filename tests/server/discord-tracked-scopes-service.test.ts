import { describe, expect, it, vi } from "vitest";

import { DiscordTrackedScopesService } from "@/server/app/discord-tracked-scopes-service";
import {
  createTrustedActorContext,
  type Capability,
} from "@/server/auth/types";

const accountId = "account-a";
const installationId = "00000000-0000-4000-8000-000000001211";
const teamId = "00000000-0000-4000-8000-000000001212";
const seasonId = "00000000-0000-4000-8000-000000001213";
const staleTeamId = "00000000-0000-4000-8000-000000001214";

function actor(capability: Capability, account = accountId) {
  return createTrustedActorContext({
    accountId: account,
    appUserId: "user-a",
    membershipId: "membership-a",
    actorKind: "USER",
    actorId: "user-a",
    actorUserId: "user-a",
    capability,
    authorityReferenceIds: ["role-a"],
    target: {
      kind: "ACCOUNT",
      accountId: account,
      teamIds: [],
      seasonId: null,
      gameId: null,
    },
    authorizedAt: "2026-08-01T04:30:00.000Z",
  });
}

const configuration = {
  installation: {
    id: installationId,
    guildId: "123456789012345611",
    guildDisplayName: "League server",
    status: "ACTIVE",
  },
  settings: {
    id: "00000000-0000-4000-8000-000000001215",
    schemaVersion: 1,
    revision: 6,
    enabled: true,
    trackedScopes: [
      { teamId, seasonId },
      { teamId: staleTeamId, seasonId },
    ],
    destinations: [
      {
        destinationId: "00000000-0000-4000-8000-000000001216",
        channelReference: "managed/channel",
        displayName: "scores",
        available: true,
        purposes: ["LIVE_UPDATES"],
      },
    ],
    cadenceMode: "FIXED_INTERVAL" as const,
    cadenceSeconds: 300,
    gameDayWindow: { enabled: false, startMinute: 480, endMinute: 1_380 },
    digest: { enabled: false, minute: 540 },
    catchUpPolicy: "LATEST_ONLY" as const,
    triggers: ["GAME_COMPLETED", "GAME_CORRECTED"],
    messageStrategy: "FINAL_ONLY",
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

const gameCounts = {
  upcoming: 1,
  inProgress: 0,
  completed: 2,
  corrected: 1,
  archived: 0,
  incomplete: 0,
};
const workspace = {
  installation: { id: installationId, status: "ACTIVE" },
  scopes: [
    {
      teamId,
      teamName: "Falcons",
      seasonId,
      seasonName: "2027",
      seasonStatus: "ACTIVE",
      startsOn: null,
      endsOn: null,
      available: true,
      staleReasons: [],
      games: gameCounts,
      gameCount: 4,
    },
    {
      teamId: staleTeamId,
      teamName: "Falcons alumni",
      seasonId,
      seasonName: "2027",
      seasonStatus: "ACTIVE",
      startsOn: null,
      endsOn: null,
      available: false,
      staleReasons: ["team archived"],
      games: { ...gameCounts, archived: 3 },
      gameCount: 7,
    },
  ],
};

function harness(overrides: Record<string, unknown> = {}) {
  const repository = {
    getWorkspace: vi.fn().mockResolvedValue(workspace),
    ...overrides,
  };
  const settings = {
    getConfiguration: vi.fn().mockResolvedValue(configuration),
    writeConfiguration: vi.fn().mockImplementation(async (input) => ({
      outcome: "updated",
      configuration: {
        ...configuration,
        settings: { ...configuration.settings, revision: 7, ...input },
      },
    })),
  };
  const rateLimits = { enforce: vi.fn().mockResolvedValue(undefined) };
  const service = new DiscordTrackedScopesService(
    repository as never,
    settings as never,
    rateLimits,
  );
  return { service, repository, settings, rateLimits };
}

describe("Discord tracked scope administration", () => {
  it("marks current active and stale selections for an exact Account viewer", async () => {
    const { service, repository } = harness();
    await expect(
      service.get(accountId, installationId, actor("discord.settings.view")),
    ).resolves.toMatchObject({
      selectedCount: 1,
      staleSelectedCount: 1,
      scopes: [{ selected: true }, { selected: true, available: false }],
    });
    await expect(
      service.get("account-b", installationId, actor("discord.settings.view")),
    ).rejects.toThrow();
    expect(repository.getWorkspace).toHaveBeenCalledTimes(1);
  });

  it("replaces active scopes while preserving every unrelated setting", async () => {
    const { service, settings, rateLimits } = harness();
    await service.update(
      {
        accountId,
        installationId,
        expectedRevision: 6,
        trackedScopes: [{ teamId, seasonId }],
      },
      actor("discord.settings.configure"),
    );
    expect(rateLimits.enforce).toHaveBeenCalledTimes(1);
    expect(settings.writeConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedRevision: 6,
        trackedScopes: [{ teamId, seasonId }],
        destinations: [
          {
            destinationId:
              configuration.settings.destinations[0]!.destinationId,
            purposes: ["LIVE_UPDATES"],
          },
        ],
        cadenceSeconds: 300,
        reasonCode: "TRACKED_SCOPES_UPDATED",
        auditAction: "update",
      }),
    );
  });

  it("pauses all scopes without deleting installation or route configuration", async () => {
    const { service, settings } = harness();
    await service.update(
      {
        accountId,
        installationId,
        expectedRevision: 6,
        trackedScopes: [],
      },
      actor("discord.settings.configure"),
    );
    expect(settings.writeConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: false,
        trackedScopes: [],
        destinations: expect.any(Array),
      }),
    );
  });

  it("rejects archived or cross-Account-like selections before writing", async () => {
    const { service, settings } = harness();
    await expect(
      service.update(
        {
          accountId,
          installationId,
          expectedRevision: 6,
          trackedScopes: [{ teamId: staleTeamId, seasonId }],
        },
        actor("discord.settings.configure"),
      ),
    ).rejects.toMatchObject({ code: "STALE_SCOPE", status: 409 });
    await expect(
      service.update(
        {
          accountId,
          installationId,
          expectedRevision: 6,
          trackedScopes: [
            {
              teamId: "00000000-0000-4000-8000-000000001299",
              seasonId,
            },
          ],
        },
        actor("discord.settings.configure"),
      ),
    ).rejects.toMatchObject({ code: "STALE_SCOPE" });
    expect(settings.writeConfiguration).not.toHaveBeenCalled();
  });
});
