import { describe, expect, it, vi } from "vitest";

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
});
