import { createHash } from "node:crypto";

import {
  ActorKind,
  AuditOutcome,
  AuditScope,
  ExternalIngestionRunStatus,
  ExternalProviderRecordStatus,
  Prisma,
  type PrismaClient,
} from "@prisma/client";

import {
  EXTERNAL_DATA_PAYLOAD_VERSION,
  canonicalExternalJson,
  externalRecordDigest,
  type ExternalProviderRecord,
} from "@/domain/external-data";

export class PrismaExternalIngestionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  source(accountId: string, externalId: string) {
    return this.prisma.externalDataSource.findUnique({
      where: { accountId_externalId: { accountId, externalId } },
    });
  }

  async startRun(input: {
    accountId: string;
    sourceId: string;
    runKey: string;
    mode: string;
    from: Date;
    to: Date;
    checkpoint: Prisma.InputJsonValue | typeof Prisma.JsonNull;
  }) {
    const existing = await this.prisma.externalIngestionRun.findUnique({
      where: {
        sourceId_runKey: { sourceId: input.sourceId, runKey: input.runKey },
      },
    });
    if (existing) return { run: existing, idempotent: true };
    const run = await this.prisma.externalIngestionRun.create({
      data: {
        accountId: input.accountId,
        sourceId: input.sourceId,
        runKey: input.runKey,
        mode: input.mode,
        windowStartedAt: input.from,
        windowEndedAt: input.to,
        checkpointBefore: input.checkpoint,
      },
    });
    return { run, idempotent: false };
  }

  async storeRecord(input: {
    accountId: string;
    sourceId: string;
    runId: string;
    record: ExternalProviderRecord;
    retrievedAt: Date;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const digest = externalRecordDigest(input.record);
      const existing = await tx.externalProviderRecord.findUnique({
        where: {
          sourceId_recordType_providerRecordId_providerVersion: {
            sourceId: input.sourceId,
            recordType: input.record.recordType,
            providerRecordId: input.record.providerRecordId,
            providerVersion: input.record.providerVersion,
          },
        },
      });
      if (existing) return { status: existing.status, duplicate: true };
      const prior = await tx.externalProviderRecord.findFirst({
        where: {
          sourceId: input.sourceId,
          recordType: input.record.recordType,
          providerRecordId: input.record.providerRecordId,
          status: ExternalProviderRecordStatus.PUBLISHED,
        },
        orderBy: { retrievedAt: "desc" },
      });
      const diagnostics: string[] = [];
      if (prior && prior.providerVersion !== input.record.correctionOfVersion) {
        diagnostics.push("CORRECTION_LINEAGE_MISMATCH");
      }
      if (prior && prior.payloadDigest === digest) {
        diagnostics.push("UNCHANGED_VERSION_RENUMBERED");
      }
      const status = diagnostics.length
        ? ExternalProviderRecordStatus.QUARANTINED
        : ExternalProviderRecordStatus.PUBLISHED;
      const record = await tx.externalProviderRecord.create({
        data: {
          accountId: input.accountId,
          sourceId: input.sourceId,
          runId: input.runId,
          recordType: input.record.recordType,
          providerRecordId: input.record.providerRecordId,
          providerVersion: input.record.providerVersion,
          payloadVersion: EXTERNAL_DATA_PAYLOAD_VERSION,
          payloadDigest: digest,
          normalizedPayload: input.record.payload as Prisma.InputJsonValue,
          status,
          correctionOfId:
            status === ExternalProviderRecordStatus.PUBLISHED
              ? (prior?.id ?? null)
              : null,
          retrievedAt: input.retrievedAt,
          effectiveAt: input.record.effectiveAt
            ? new Date(input.record.effectiveAt)
            : null,
        },
      });
      if (status === ExternalProviderRecordStatus.QUARANTINED) {
        await tx.externalIngestionQuarantine.create({
          data: {
            accountId: input.accountId,
            sourceId: input.sourceId,
            recordId: record.id,
            diagnosticCodes: diagnostics,
          },
        });
      } else if (prior) {
        await tx.externalProviderRecord.update({
          where: { id: prior.id },
          data: { status: ExternalProviderRecordStatus.SUPERSEDED },
        });
        await tx.securityAuditRecord.create({
          data: {
            scope: AuditScope.ACCOUNT,
            accountId: input.accountId,
            actorKind: ActorKind.SERVICE,
            actorId: `external-ingestion:${input.sourceId}`,
            actorUserId: null,
            action: "external_data.correction.publish",
            capability: null,
            targetType: "ExternalProviderRecord",
            targetId: record.id,
            outcome: AuditOutcome.SUCCEEDED,
            metadata: {
              recordType: record.recordType,
              priorVersion: prior.providerVersion,
              providerVersion: record.providerVersion,
            },
          },
        });
      }
      return { status, duplicate: false };
    });
  }

  async quarantineInvalid(input: {
    accountId: string;
    sourceId: string;
    runId: string;
    providerVersion: string;
    rawRecord: unknown;
    retrievedAt: Date;
  }) {
    const digest = createHash("sha256")
      .update(canonicalExternalJson(input.rawRecord))
      .digest("hex");
    return this.prisma.$transaction(async (tx) => {
      const record = await tx.externalProviderRecord.upsert({
        where: {
          sourceId_recordType_providerRecordId_providerVersion: {
            sourceId: input.sourceId,
            recordType: "INVALID",
            providerRecordId: digest,
            providerVersion: input.providerVersion,
          },
        },
        update: {},
        create: {
          accountId: input.accountId,
          sourceId: input.sourceId,
          runId: input.runId,
          recordType: "INVALID",
          providerRecordId: digest,
          providerVersion: input.providerVersion,
          payloadVersion: EXTERNAL_DATA_PAYLOAD_VERSION,
          payloadDigest: digest,
          normalizedPayload: { redacted: true },
          status: ExternalProviderRecordStatus.QUARANTINED,
          retrievedAt: input.retrievedAt,
        },
      });
      await tx.externalIngestionQuarantine.upsert({
        where: { recordId: record.id },
        update: {},
        create: {
          accountId: input.accountId,
          sourceId: input.sourceId,
          recordId: record.id,
          diagnosticCodes: ["INVALID_PROVIDER_RECORD"],
        },
      });
      return record;
    });
  }

  completePage(input: {
    runId: string;
    pageRecords: number;
    published: number;
    quarantined: number;
  }) {
    return this.prisma.externalIngestionRun.update({
      where: { id: input.runId },
      data: {
        pageCount: { increment: 1 },
        recordCount: { increment: input.pageRecords },
        publishedCount: { increment: input.published },
        quarantinedCount: { increment: input.quarantined },
      },
    });
  }

  async succeed(input: {
    sourceId: string;
    runId: string;
    checkpoint: Prisma.InputJsonValue;
    completedAt: Date;
    quotaRemaining: number | null;
    quotaResetAt: Date | null;
  }) {
    return this.prisma.$transaction(async (tx) => {
      await tx.externalIngestionRun.update({
        where: { id: input.runId },
        data: {
          status: ExternalIngestionRunStatus.SUCCEEDED,
          checkpointAfter: input.checkpoint,
          completedAt: input.completedAt,
        },
      });
      await tx.externalDataSource.update({
        where: { id: input.sourceId },
        data: {
          checkpoint: input.checkpoint,
          lastSuccessAt: input.completedAt,
          lastFailureAt: null,
          lastFailureCode: null,
          consecutiveFailures: 0,
          nextAttemptAt: null,
          quotaRemaining: input.quotaRemaining,
          quotaResetAt: input.quotaResetAt,
        },
      });
    });
  }

  async fail(input: {
    sourceId: string;
    runId: string;
    failureCode: string;
    failedAt: Date;
    priorFailures: number;
  }) {
    const delaySeconds = Math.min(
      21_600,
      30 * 2 ** Math.min(input.priorFailures, 9),
    );
    return this.prisma.$transaction([
      this.prisma.externalIngestionRun.update({
        where: { id: input.runId },
        data: {
          status: ExternalIngestionRunStatus.FAILED,
          failureCode: input.failureCode,
          completedAt: input.failedAt,
        },
      }),
      this.prisma.externalDataSource.update({
        where: { id: input.sourceId },
        data: {
          lastFailureAt: input.failedAt,
          lastFailureCode: input.failureCode,
          consecutiveFailures: { increment: 1 },
          nextAttemptAt: new Date(
            input.failedAt.getTime() + delaySeconds * 1_000,
          ),
        },
      }),
    ]);
  }

  listPublished(accountId: string, sourceId: string, take = 100) {
    return this.prisma.externalProviderRecord.findMany({
      where: {
        accountId,
        sourceId,
        status: ExternalProviderRecordStatus.PUBLISHED,
      },
      orderBy: [{ effectiveAt: "desc" }, { retrievedAt: "desc" }],
      take,
      select: {
        externalId: true,
        recordType: true,
        providerRecordId: true,
        providerVersion: true,
        payloadVersion: true,
        payloadDigest: true,
        normalizedPayload: true,
        effectiveAt: true,
        retrievedAt: true,
      },
    });
  }
}
