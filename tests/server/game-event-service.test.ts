import { describe, expect, it, vi } from "vitest";

import { GameEventError } from "@/domain/events/event-log";
import { GameEventService } from "@/server/app/game-event-service";
import type { PrismaGameEventRepository } from "@/server/data/game-event-repository";
import { trustedActorForTest } from "../fixtures/trusted-actor";

const input = {
  accountId: "account-a",
  gameId: "game-a",
  setupSnapshotId: "setup-a",
  expectedRevision: 0,
  eventId: "event-a",
  playTransactionId: "transaction-a",
  clientSubmissionId: "submission-a",
  recordedAt: "2026-07-30T00:00:00.000Z",
  body: { eventType: "GameStarted", payload: {} },
};

const startActor = () =>
  trustedActorForTest({
    accountId: "account-a",
    actorId: "score-service",
    actorKind: "SERVICE",
    actorUserId: null,
    capability: "game.start",
    scope: { kind: "GAME", gameId: "game-a" },
    authorizedAt: "2026-07-29T23:59:59.000Z",
  });

const scoreActor = () =>
  trustedActorForTest({
    accountId: "account-a",
    actorId: "score-service",
    actorKind: "SERVICE",
    actorUserId: null,
    capability: "game.score",
    scope: { kind: "GAME", gameId: "game-a" },
    authorizedAt: "2026-07-29T23:59:59.000Z",
  });

const userStartActor = () =>
  trustedActorForTest({
    accountId: "account-a",
    actorId: "user-a",
    actorKind: "USER",
    actorUserId: "user-a",
    capability: "game.start",
    scope: { kind: "GAME", gameId: "game-a" },
    authorizedAt: "2026-07-29T23:59:59.000Z",
  });

describe("trusted game event application boundary", () => {
  it("keeps the synthetic actor adapter disabled outside tests", () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(startActor).toThrow(
        "Synthetic trusted actors are available only in tests.",
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("derives repository actor data from the opaque context", async () => {
    const accept = vi.fn().mockResolvedValue({ idempotentReplay: false });
    const service = new GameEventService({
      accept,
    } as unknown as PrismaGameEventRepository);
    await service.accept(input, startActor());
    expect(accept).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "account-a",
        gameId: "game-a",
        actor: {
          accountId: "account-a",
          actorId: "score-service",
          actorKind: "SERVICE",
          actorUserId: null,
          capability: "game.start",
          scope: { kind: "GAME", gameId: "game-a" },
          authorizedAt: "2026-07-29T23:59:59.000Z",
        },
      }),
    );
  });

  it("emits consent-gated success and rule-rejection product metrics for users", async () => {
    const analytics = { emitForUser: vi.fn().mockResolvedValue(true) };
    const accept = vi
      .fn()
      .mockResolvedValueOnce({ idempotentReplay: false })
      .mockRejectedValueOnce(
        new GameEventError(
          "INVALID_LIFECYCLE_TRANSITION",
          "Game already started.",
        ),
      );
    const service = new GameEventService(
      { accept } as unknown as PrismaGameEventRepository,
      undefined,
      undefined,
      analytics,
    );
    await service.accept(input, userStartActor());
    expect(analytics.emitForUser).toHaveBeenLastCalledWith(
      "user-a",
      expect.objectContaining({
        name: "scoring.submission_succeeded",
        result: "SUCCEEDED",
        eventFamily: "GAME_LIFECYCLE",
        failureCategory: null,
      }),
    );
    await expect(service.accept(input, userStartActor())).rejects.toMatchObject(
      {
        code: "INVALID_LIFECYCLE_TRANSITION",
      },
    );
    expect(analytics.emitForUser).toHaveBeenLastCalledWith(
      "user-a",
      expect.objectContaining({
        name: "scoring.baseball_rule_rejected",
        result: "BASEBALL_RULE_REJECTED",
        failureCategory: "BASEBALL_RULES",
      }),
    );
  });

  it("rejects direct actor JSON and a copied actor for another game", async () => {
    const accept = vi.fn();
    const service = new GameEventService({
      accept,
    } as unknown as PrismaGameEventRepository);
    await expect(
      service.accept(input, JSON.parse(JSON.stringify(startActor()))),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_REQUIRED" });
    await expect(
      service.accept(
        input,
        trustedActorForTest({
          accountId: "account-a",
          actorId: "score-service",
          actorKind: "SERVICE",
          actorUserId: null,
          capability: "game.start",
          scope: { kind: "GAME", gameId: "game-b" },
          authorizedAt: "2026-07-29T23:59:59.000Z",
        }),
      ),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_REQUIRED" });
    expect(accept).not.toHaveBeenCalled();
  });

  it("does not let the general scoring capability start a game", async () => {
    const accept = vi.fn();
    const service = new GameEventService({
      accept,
    } as unknown as PrismaGameEventRepository);
    await expect(
      service.accept(
        input,
        trustedActorForTest({
          accountId: "account-a",
          actorId: "score-service",
          actorKind: "SERVICE",
          actorUserId: null,
          capability: "game.score",
          scope: { kind: "GAME", gameId: "game-a" },
          authorizedAt: "2026-07-29T23:59:59.000Z",
        }),
      ),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_REQUIRED" });
    expect(accept).not.toHaveBeenCalled();
  });

  it("accepts a typed atomic plate appearance through game.score", async () => {
    const accept = vi.fn().mockResolvedValue({ idempotentReplay: false });
    const service = new GameEventService({
      accept,
    } as unknown as PrismaGameEventRepository);
    const body = {
      eventType: "PlateAppearanceRecorded",
      payload: {
        batterId: "away-batter",
        pitcherId: "home-pitcher",
        outcome: "SINGLE",
        battedBall: "LINE_DRIVE",
        movements: [
          {
            runnerId: "away-batter",
            from: "BATTER",
            to: "FIRST",
            cause: "HIT",
            forced: false,
            responsiblePitcherId: "home-pitcher",
          },
        ],
        fieldingCredits: [],
      },
    };
    await service.accept({ ...input, body }, scoreActor());
    expect(accept).toHaveBeenCalledWith(
      expect.objectContaining({
        body,
        actor: expect.objectContaining({ capability: "game.score" }),
      }),
    );
  });

  it("accepts a typed live lineup change through game.score", async () => {
    const accept = vi.fn().mockResolvedValue({ idempotentReplay: false });
    const service = new GameEventService({
      accept,
    } as unknown as PrismaGameEventRepository);
    const body = {
      eventType: "PitchingChangeMade",
      payload: {
        side: "HOME",
        outgoingPitcherId: "home-starter",
        incomingPitcherId: "home-reliever",
        inheritedRunnerIds: ["away-runner"],
      },
    } as const;
    await service.accept({ ...input, body }, scoreActor());
    expect(accept).toHaveBeenCalledWith(
      expect.objectContaining({
        body,
        actor: expect.objectContaining({
          capability: "game.score",
          accountId: "account-a",
        }),
      }),
    );
  });
});
