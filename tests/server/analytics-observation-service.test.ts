import { describe, expect, it, vi } from "vitest";

import { AnalyticsObservationService } from "@/server/app/analytics-observation-service";
import { createTrustedActorContext } from "@/server/auth/types";

const actor = createTrustedActorContext({
  accountId: "account-1",
  appUserId: "user-1",
  membershipId: "membership-1",
  actorKind: "USER",
  actorId: "user-1",
  actorUserId: "user-1",
  capability: "game.score",
  authorityReferenceIds: ["role-1"],
  target: {
    kind: "GAME",
    accountId: "account-1",
    teamIds: ["team-1"],
    seasonId: "season-1",
    gameId: "game-1",
  },
  authorizedAt: "2026-07-31T12:00:00.000Z",
});

describe("analytics observation service boundary", () => {
  it("passes exact game scoring authority to the repository", async () => {
    const create = vi.fn();
    const service = new AnalyticsObservationService({
      create,
      listCurrent: vi.fn(),
    });

    await service.create(
      {
        accountId: "account-1",
        gameId: "game-1",
        setupSnapshotId: "setup-1",
        sourceEventId: "event-1",
        type: "PITCH_LOCATION",
        version: 1,
        ordinal: 0,
        captureSource: "MANUAL",
        confidence: "OBSERVED",
        payload: {
          zoneCell: "MID_MIDDLE",
          result: "CALLED_STRIKE",
          pitchType: null,
        },
      },
      actor,
    );
    expect(create).toHaveBeenCalledOnce();
  });

  it("rejects a team-scoped actor for observation writes", async () => {
    const teamActor = createTrustedActorContext({
      ...actor,
      capability: "game.score",
      target: {
        ...actor.target,
        kind: "TEAM",
        gameId: null,
      },
    });
    const service = new AnalyticsObservationService({
      create: vi.fn(),
      listCurrent: vi.fn(),
    });
    await expect(
      service.create(
        {
          accountId: "account-1",
          gameId: "game-1",
          setupSnapshotId: "setup-1",
          sourceEventId: "event-1",
          type: "PITCH_LOCATION",
          version: 1,
          ordinal: 0,
          captureSource: "MANUAL",
          confidence: "OBSERVED",
          payload: {
            zoneCell: "MID_MIDDLE",
            result: "CALLED_STRIKE",
            pitchType: null,
          },
        },
        teamActor,
      ),
    ).rejects.toThrow(/Exact game authorization/u);
  });
});
