import { describe, expect, it, vi } from "vitest";

import { GameBoxScoreService } from "@/server/app/game-box-score-service";
import type { PrismaGameBoxScoreRepository } from "@/server/data/game-box-score-repository";
import type { PrismaGameEventRepository } from "@/server/data/game-event-repository";
import { trustedActorForTest } from "../fixtures/trusted-actor";

describe("game box score service boundary", () => {
  it("denies cross-Account and wrong-game report reads before persistence", async () => {
    const loadAcceptedHistory = vi.fn();
    const loadPresentationSource = vi.fn();
    const service = new GameBoxScoreService(
      { loadAcceptedHistory } as unknown as PrismaGameEventRepository,
      { loadPresentationSource } as unknown as PrismaGameBoxScoreRepository,
    );
    const actor = trustedActorForTest({
      accountId: "account-a",
      actorId: "actor-a",
      actorKind: "SERVICE",
      actorUserId: null,
      membershipId: null,
      capability: "report.view",
      scope: { kind: "GAME", gameId: "another-game" },
      authorizedAt: "2026-07-30T20:00:00.000Z",
    });

    await expect(
      service.load(
        {
          accountId: "account-a",
          gameId: "game-a",
          setupSnapshotId: "setup-a",
        },
        actor,
      ),
    ).rejects.toMatchObject({ code: "INVALID_REPORT_INPUT" });
    expect(loadAcceptedHistory).not.toHaveBeenCalled();
    expect(loadPresentationSource).not.toHaveBeenCalled();
  });
});
