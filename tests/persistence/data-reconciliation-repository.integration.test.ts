import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  DATA_RECONCILIATION_VERSION,
  type DataReconciliationReport,
} from "@/domain/data-reconciliation";
import { STATISTIC_DERIVATION_VERSION } from "@/domain/statistics";
import { PrismaDataReconciliationRepository } from "@/server/data/data-reconciliation-repository";
import { PrismaStatisticProjectionRepository } from "@/server/data/statistic-projection-repository";
import { seedPersistenceScoringFixture } from "../fixtures/persistence-scoring-fixture";
import { trustedActorForTest } from "../fixtures/trusted-actor";

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const prefix = `issue95-${process.pid}-${Date.now()}`;

integration("data reconciliation evidence persistence", () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl! }),
  });
  const repository = new PrismaDataReconciliationRepository(prisma);
  const projections = new PrismaStatisticProjectionRepository(prisma);
  let ids: Awaited<ReturnType<typeof seedPersistenceScoringFixture>>;

  beforeAll(async () => {
    ids = await seedPersistenceScoringFixture(prisma, prefix);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("loads only Account-scoped projection evidence and records safe audit evidence", async () => {
    await projections.publishGameCheckpoint({
      accountId: ids.account,
      gameId: ids.game,
      sourceRevision: 0,
      privacyOverlayRevision: 0,
      derivationVersion: STATISTIC_DERIVATION_VERSION,
    });
    await expect(
      repository.latestGameProjection(ids.account, ids.game),
    ).resolves.toMatchObject({
      sourceRevision: 0,
      privacyOverlayRevision: 0,
      status: "CURRENT",
    });
    await expect(
      repository.latestGameProjection(`${prefix}-other`, ids.game),
    ).resolves.toBeNull();

    const hash = `sha256:v1:${"a".repeat(64)}`;
    const report: DataReconciliationReport = {
      version: DATA_RECONCILIATION_VERSION,
      confidence: "VERIFIED",
      freshness: "CURRENT",
      blocking: false,
      findings: [],
      provenance: {
        accountId: ids.account,
        gameId: ids.game,
        setupSnapshotId: ids.setup,
        setupRevision: 1,
        sourceRevision: 0,
        effectiveEventCount: 0,
        correctionCount: 0,
        privacyOverlayRevision: 0,
        derivationVersion: STATISTIC_DERIVATION_VERSION,
        rulesetVersionId: ids.ruleset,
        sourceEvidenceHash: hash,
        effectiveHistoryHash: hash,
        replayStateHash: hash,
        statisticsHash: hash,
        reportHash: hash,
        exportHash: hash,
      },
    };
    const actor = trustedActorForTest({
      accountId: ids.account,
      actorId: `${prefix}-operator`,
      actorKind: "SERVICE",
      actorUserId: null,
      membershipId: null,
      capability: "audit.view",
      scope: { kind: "GAME", gameId: ids.game },
      authorizedAt: "2026-07-31T16:00:00.000Z",
    });
    await repository.recordEvidence({
      actor,
      report,
      correlationId: `${prefix}-correlation`,
      trigger: "REPROCESS",
    });

    const audit = await prisma.securityAuditRecord.findFirstOrThrow({
      where: {
        accountId: ids.account,
        action: "data.reconcile",
        targetId: ids.game,
      },
    });
    expect(audit).toMatchObject({
      outcome: "SUCCEEDED",
      reasonCode: "VERIFIED",
      correlationId: `${prefix}-correlation`,
      metadata: expect.objectContaining({
        confidence: "VERIFIED",
        sourceEvidenceHash: hash,
        findingCodes: "",
      }),
    });
    expect(JSON.stringify(audit.metadata)).not.toContain("displayName");
  });
});
