import {
  ActorKind,
  AuditOutcome,
  AuditScope,
  ProjectionScope,
  type PrismaClient,
} from "@prisma/client";

import type {
  DataReconciliationReport,
  ReconciliationProjectionEvidence,
} from "@/domain/data-reconciliation";
import type { TrustedActorContext } from "@/server/auth/types";

export class PrismaDataReconciliationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async latestGameProjection(
    accountId: string,
    gameId: string,
  ): Promise<ReconciliationProjectionEvidence | null> {
    const checkpoint = await this.prisma.projectionCheckpoint.findFirst({
      where: {
        accountId,
        gameId,
        scope: ProjectionScope.GAME,
        seasonId: null,
      },
      select: {
        sourceRevision: true,
        privacyOverlayRevision: true,
        derivationVersion: true,
        status: true,
      },
      orderBy: [{ sourceRevision: "desc" }, { updatedAt: "desc" }],
    });
    return checkpoint;
  }

  async recordEvidence(input: {
    actor: TrustedActorContext;
    report: DataReconciliationReport;
    correlationId: string | null;
    trigger: "MANUAL" | "CORRECTION" | "IMPORT" | "REPROCESS";
  }): Promise<void> {
    const { report } = input;
    if (
      report.provenance.accountId !== input.actor.accountId ||
      input.actor.target.kind !== "GAME" ||
      input.actor.target.gameId !== report.provenance.gameId
    ) {
      throw new Error("Reconciliation evidence scope is invalid.");
    }
    await this.prisma.securityAuditRecord.create({
      data: {
        scope: AuditScope.ACCOUNT,
        accountId: input.actor.accountId,
        actorKind:
          input.actor.actorKind === "USER" ? ActorKind.USER : ActorKind.SERVICE,
        actorId: input.actor.actorId,
        actorUserId: input.actor.actorUserId,
        action: "data.reconcile",
        capability: input.actor.capability,
        targetType: "Game",
        targetId: report.provenance.gameId,
        outcome: report.blocking ? AuditOutcome.FAILED : AuditOutcome.SUCCEEDED,
        reasonCode: report.blocking ? "INTEGRITY_FAILURE" : report.confidence,
        correlationId: input.correlationId,
        metadata: {
          reconciliationVersion: report.version,
          trigger: input.trigger,
          confidence: report.confidence,
          freshness: report.freshness,
          setupSnapshotId: report.provenance.setupSnapshotId,
          setupRevision: report.provenance.setupRevision,
          sourceRevision: report.provenance.sourceRevision,
          effectiveEventCount: report.provenance.effectiveEventCount,
          correctionCount: report.provenance.correctionCount,
          privacyOverlayRevision: report.provenance.privacyOverlayRevision,
          derivationVersion: report.provenance.derivationVersion,
          sourceEvidenceHash: report.provenance.sourceEvidenceHash,
          replayStateHash: report.provenance.replayStateHash,
          statisticsHash: report.provenance.statisticsHash,
          reportHash: report.provenance.reportHash,
          exportHash: report.provenance.exportHash,
          findingCodes: report.findings.map(({ code }) => code).join(","),
        },
      },
    });
  }
}
