import { z } from "zod";

import {
  reconcileGameData,
  type DataReconciliationReport,
} from "@/domain/data-reconciliation";
import type { TrustedActorContext } from "@/server/auth/types";
import { requireTrustedActor } from "@/server/auth/types";
import { PrismaDataReconciliationRepository } from "@/server/data/data-reconciliation-repository";
import { PrismaGameBoxScoreRepository } from "@/server/data/game-box-score-repository";
import { PrismaGameEventRepository } from "@/server/data/game-event-repository";
import { getPrismaClient } from "@/server/data/prisma";
import {
  emitOperationalEvent,
  getOperationalEventSink,
  type OperationalEventSink,
} from "@/server/observability/operational-events";

const id = z.string().trim().min(1).max(128);
const requestSchema = z
  .object({
    accountId: id,
    gameId: id,
    setupSnapshotId: id,
    correlationId: id.nullable().default(null),
    trigger: z
      .enum(["MANUAL", "CORRECTION", "IMPORT", "REPROCESS"])
      .default("MANUAL"),
  })
  .strict();

export class DataReconciliationError extends Error {
  readonly code = "RECONCILIATION_SOURCE_CHANGED";

  constructor() {
    super("Game history changed during reconciliation. Retry the operation.");
    this.name = "DataReconciliationError";
  }
}

export class DataReconciliationService {
  constructor(
    private readonly events: PrismaGameEventRepository,
    private readonly reports: PrismaGameBoxScoreRepository,
    private readonly evidence: PrismaDataReconciliationRepository,
    private readonly operationalEvents: OperationalEventSink = getOperationalEventSink(),
  ) {}

  async reconcile(
    input: unknown,
    actorInput: TrustedActorContext,
  ): Promise<DataReconciliationReport> {
    const request = requestSchema.parse(input);
    const actor = requireTrustedActor(
      actorInput,
      request.accountId,
      "audit.view",
    );
    if (
      actor.target.kind !== "GAME" ||
      actor.target.gameId !== request.gameId
    ) {
      throw new DataReconciliationError();
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const [history, presentation, projection] = await Promise.all([
        this.events.loadAcceptedHistory(
          request.accountId,
          request.gameId,
          request.setupSnapshotId,
        ),
        this.reports.loadPresentationSource(
          request.accountId,
          request.gameId,
          request.setupSnapshotId,
        ),
        this.evidence.latestGameProjection(request.accountId, request.gameId),
      ]);
      const sourceRevision = history.events.at(-1)?.acceptedRevision ?? 0;
      if (sourceRevision !== presentation.sourceRevision) continue;

      const report = reconcileGameData({
        setup: history.setup,
        events: history.events,
        presentation: presentation.presentation,
        privacyOverlayRevision: presentation.privacyOverlayRevision,
        generatedAt: new Date().toISOString(),
        projection,
      });
      try {
        await this.evidence.recordEvidence({
          actor,
          report,
          correlationId: request.correlationId,
          trigger: request.trigger,
        });
      } catch (error) {
        emitOperationalEvent(this.operationalEvents, {
          category: "security_audit",
          name: "write",
          outcome: "failed",
          severity: "critical",
          accountId: request.accountId,
          ...(request.correlationId
            ? { correlationId: request.correlationId }
            : {}),
          targetType: "Game",
          code: "INTERNAL_ERROR",
        });
        throw error;
      }
      emitOperationalEvent(this.operationalEvents, {
        category: "data_quality",
        name: report.blocking
          ? "reconciliation_integrity_failure"
          : report.confidence === "VERIFIED" || report.confidence === "CURRENT"
            ? "reconciliation_complete"
            : "reconciliation_expected_recalculation",
        outcome: report.blocking
          ? "failed"
          : report.confidence === "VERIFIED" || report.confidence === "CURRENT"
            ? "succeeded"
            : "degraded",
        severity: report.blocking
          ? "critical"
          : report.confidence === "VERIFIED" || report.confidence === "CURRENT"
            ? "info"
            : "warning",
        accountId: request.accountId,
        ...(request.correlationId
          ? { correlationId: request.correlationId }
          : {}),
        targetType: "Game",
        code: report.confidence,
        metadata: {
          sourceRevision: report.provenance.sourceRevision,
          findingCount: report.findings.length,
          correctionCount: report.provenance.correctionCount,
        },
      });
      return report;
    }
    throw new DataReconciliationError();
  }
}

export function getDataReconciliationService(): DataReconciliationService {
  const prisma = getPrismaClient();
  return new DataReconciliationService(
    new PrismaGameEventRepository(prisma),
    new PrismaGameBoxScoreRepository(prisma),
    new PrismaDataReconciliationRepository(prisma),
  );
}
