import { describe, expect, it, vi } from "vitest";

import { STATISTIC_DERIVATION_VERSION } from "@/domain/statistics";
import { DataReconciliationService } from "@/server/app/data-reconciliation-service";
import type { PrismaDataReconciliationRepository } from "@/server/data/data-reconciliation-repository";
import type { PrismaGameBoxScoreRepository } from "@/server/data/game-box-score-repository";
import type { PrismaGameEventRepository } from "@/server/data/game-event-repository";
import type {
  OperationalEvent,
  OperationalEventSink,
} from "@/server/observability/operational-events";
import { ScoringFixtureBuilder } from "../fixtures/scoring-fixture-builder";
import { trustedActorForTest } from "../fixtures/trusted-actor";

class Collector implements OperationalEventSink {
  readonly events: OperationalEvent[] = [];
  emit(event: OperationalEvent) {
    this.events.push(event);
  }
}

function actor(gameId = "fixture-game") {
  return trustedActorForTest({
    accountId: "fixture-account",
    actorId: "reconciliation-service",
    actorKind: "SERVICE",
    actorUserId: null,
    membershipId: null,
    capability: "audit.view",
    scope: { kind: "GAME", gameId },
    authorizedAt: "2026-07-31T16:00:00.000Z",
  });
}

describe("data reconciliation service", () => {
  it("requires exact game authority, records safe evidence, and emits expected recalculation", async () => {
    const builder = new ScoringFixtureBuilder();
    builder.start();
    const sourceRevision = builder.state().sourceRevision;
    const recordEvidence = vi.fn();
    const collector = new Collector();
    const service = new DataReconciliationService(
      {
        loadAcceptedHistory: vi.fn().mockResolvedValue({
          setup: builder.setup,
          events: builder.events(),
        }),
      } as unknown as PrismaGameEventRepository,
      {
        loadPresentationSource: vi.fn().mockResolvedValue({
          sourceRevision,
          privacyOverlayRevision: 0,
          presentation: {
            season: { id: "season", displayName: "2026" },
            teams: {
              AWAY: { id: "away", displayName: "Away" },
              HOME: { id: "home", displayName: "Home" },
            },
            players: [],
          },
          projectionCheckpoint: null,
        }),
      } as unknown as PrismaGameBoxScoreRepository,
      {
        latestGameProjection: vi.fn().mockResolvedValue({
          sourceRevision,
          privacyOverlayRevision: 0,
          derivationVersion: STATISTIC_DERIVATION_VERSION,
          status: "CURRENT",
        }),
        recordEvidence,
      } as unknown as PrismaDataReconciliationRepository,
      collector,
    );

    const report = await service.reconcile(
      {
        accountId: builder.setup.accountId,
        gameId: builder.setup.gameId,
        setupSnapshotId: builder.setup.id,
        correlationId: "reconcile-1234",
        trigger: "REPROCESS",
      },
      actor(builder.setup.gameId),
    );
    expect(report).toMatchObject({ confidence: "INCOMPLETE", blocking: false });
    expect(recordEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: expect.objectContaining({ accountId: builder.setup.accountId }),
        correlationId: "reconcile-1234",
        trigger: "REPROCESS",
        report: expect.objectContaining({ confidence: "INCOMPLETE" }),
      }),
    );
    expect(collector.events).toEqual([
      expect.objectContaining({
        category: "data_quality",
        name: "reconciliation_expected_recalculation",
        outcome: "degraded",
      }),
    ]);

    recordEvidence.mockRejectedValueOnce(new Error("audit unavailable"));
    await expect(
      service.reconcile(
        {
          accountId: builder.setup.accountId,
          gameId: builder.setup.gameId,
          setupSnapshotId: builder.setup.id,
          correlationId: "reconcile-5678",
          trigger: "REPROCESS",
        },
        actor(builder.setup.gameId),
      ),
    ).rejects.toThrow("audit unavailable");
    expect(collector.events.at(-1)).toMatchObject({
      category: "security_audit",
      name: "write",
      outcome: "failed",
      severity: "critical",
      code: "INTERNAL_ERROR",
    });
  });

  it("denies wrong-game authority before reading persistence", async () => {
    const loadAcceptedHistory = vi.fn();
    const service = new DataReconciliationService(
      { loadAcceptedHistory } as unknown as PrismaGameEventRepository,
      {} as PrismaGameBoxScoreRepository,
      {} as PrismaDataReconciliationRepository,
      new Collector(),
    );
    await expect(
      service.reconcile(
        {
          accountId: "fixture-account",
          gameId: "fixture-game",
          setupSnapshotId: "fixture-setup",
        },
        actor("different-game"),
      ),
    ).rejects.toMatchObject({ code: "RECONCILIATION_SOURCE_CHANGED" });
    expect(loadAcceptedHistory).not.toHaveBeenCalled();
  });
});
