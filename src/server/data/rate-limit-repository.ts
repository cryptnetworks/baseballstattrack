import {
  ActorKind,
  AuditOutcome,
  AuditScope,
  Prisma,
  RateLimitOverrideStatus,
  RateLimitScope,
  type PrismaClient,
} from "@prisma/client";

import type { RateLimitClass, RateLimitPolicy } from "@/domain/rate-limits";
import type { TrustedActorContext } from "@/server/auth/types";

export type RateLimitDecision = Readonly<{
  allowed: boolean;
  idempotentRetry: boolean;
  conflict: boolean;
  limit: number;
  remaining: number;
  resetAt: Date;
  retryAfterSeconds: number;
  constrainedBy: "ACTOR" | "ACCOUNT";
  overrideId: string | null;
}>;

type ConsumeInput = Readonly<{
  accountId: string;
  actorKind: "USER" | "SERVICE";
  actorId: string;
  capability: string;
  endpointClass: RateLimitClass;
  policy: RateLimitPolicy;
  policyVersion: string;
  cost: number;
  operationKey?: string;
  fingerprint?: string;
  idempotencyTtlSeconds: number;
}>;

function actorKind(input: "USER" | "SERVICE") {
  return input === "USER" ? ActorKind.USER : ActorKind.SERVICE;
}

function windowStart(now: Date, seconds: number) {
  const milliseconds = seconds * 1_000;
  return new Date(Math.floor(now.getTime() / milliseconds) * milliseconds);
}

function retrySeconds(now: Date, resetAt: Date) {
  return Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1_000));
}

function isSerializationConflict(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2034" || error.code === "P2002")
  );
}

export class PrismaRateLimitRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async consume(input: ConsumeInput): Promise<RateLimitDecision> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        return await this.consumeOnce(input);
      } catch (error) {
        if (!isSerializationConflict(error) || attempt === 3) throw error;
      }
    }
    throw new Error("Rate-limit serialization retry exhausted.");
  }

  private consumeOnce(input: ConsumeInput): Promise<RateLimitDecision> {
    return this.prisma.$transaction(
      async (tx) => {
        const lockKey = `${input.accountId}:${input.endpointClass}`;
        await tx.$queryRaw<Array<{ locked: number }>>`
          SELECT 1::integer AS locked
          FROM pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
        `;
        const databaseTimes = await tx.$queryRaw<Array<{ now: Date }>>`
          SELECT clock_timestamp() AS now
        `;
        const now = databaseTimes[0]?.now;
        if (!now) throw new Error("Database time is unavailable.");

        const kind = actorKind(input.actorKind);
        const overrides = await tx.rateLimitOverride.findMany({
          where: {
            accountId: input.accountId,
            endpointClass: input.endpointClass,
            status: RateLimitOverrideStatus.ACTIVE,
            expiresAt: { gt: now },
            OR: [
              { actorKind: kind, actorId: input.actorId },
              { actorKind: null, actorId: null },
            ],
          },
          orderBy: { createdAt: "desc" },
        });
        const override =
          overrides.find(
            (candidate) =>
              candidate.actorKind === kind &&
              candidate.actorId === input.actorId,
          ) ?? overrides.find((candidate) => candidate.actorId === null);
        const policy = override
          ? {
              actorLimit: override.actorLimit,
              accountLimit: override.accountLimit,
              windowSeconds: input.policy.windowSeconds,
            }
          : input.policy;
        const startedAt = windowStart(now, policy.windowSeconds);
        const resetAt = new Date(
          startedAt.getTime() + policy.windowSeconds * 1_000,
        );

        if (input.operationKey && input.fingerprint) {
          const existing = await tx.rateLimitCharge.findUnique({
            where: {
              accountId_actorKind_actorId_endpointClass_operationKey: {
                accountId: input.accountId,
                actorKind: kind,
                actorId: input.actorId,
                endpointClass: input.endpointClass,
                operationKey: input.operationKey,
              },
            },
          });
          if (existing && existing.expiresAt > now) {
            const exact =
              existing.fingerprint === input.fingerprint &&
              existing.cost === input.cost;
            return {
              allowed: exact,
              idempotentRetry: exact,
              conflict: !exact,
              limit: policy.actorLimit,
              remaining: Math.max(0, policy.actorLimit - existing.cost),
              resetAt,
              retryAfterSeconds: exact ? 0 : retrySeconds(now, resetAt),
              constrainedBy: "ACTOR",
              overrideId: override?.id ?? null,
            };
          }
          if (existing) {
            await tx.rateLimitCharge.delete({ where: { id: existing.id } });
          }
        }

        const accountCounter = await tx.rateLimitCounter.upsert({
          where: {
            accountId_scope_actorKind_subjectKey_endpointClass_policyVersion_windowStartedAt:
              {
                accountId: input.accountId,
                scope: RateLimitScope.ACCOUNT,
                actorKind: ActorKind.SYSTEM,
                subjectKey: input.accountId,
                endpointClass: input.endpointClass,
                policyVersion: input.policyVersion,
                windowStartedAt: startedAt,
              },
          },
          create: {
            accountId: input.accountId,
            scope: RateLimitScope.ACCOUNT,
            actorKind: ActorKind.SYSTEM,
            subjectKey: input.accountId,
            endpointClass: input.endpointClass,
            policyVersion: input.policyVersion,
            windowStartedAt: startedAt,
            windowSeconds: policy.windowSeconds,
            limit: policy.accountLimit,
            used: input.cost,
          },
          update: {
            used: { increment: input.cost },
            limit: policy.accountLimit,
            windowSeconds: policy.windowSeconds,
          },
        });
        const actorCounter = await tx.rateLimitCounter.upsert({
          where: {
            accountId_scope_actorKind_subjectKey_endpointClass_policyVersion_windowStartedAt:
              {
                accountId: input.accountId,
                scope: RateLimitScope.ACTOR,
                actorKind: kind,
                subjectKey: `${input.actorId}:${input.capability}`,
                endpointClass: input.endpointClass,
                policyVersion: input.policyVersion,
                windowStartedAt: startedAt,
              },
          },
          create: {
            accountId: input.accountId,
            scope: RateLimitScope.ACTOR,
            actorKind: kind,
            subjectKey: `${input.actorId}:${input.capability}`,
            endpointClass: input.endpointClass,
            policyVersion: input.policyVersion,
            windowStartedAt: startedAt,
            windowSeconds: policy.windowSeconds,
            limit: policy.actorLimit,
            used: input.cost,
          },
          update: {
            used: { increment: input.cost },
            limit: policy.actorLimit,
            windowSeconds: policy.windowSeconds,
          },
        });
        const actorExceeded = actorCounter.used > policy.actorLimit;
        const accountExceeded = accountCounter.used > policy.accountLimit;
        const constrainedBy = actorExceeded ? "ACTOR" : "ACCOUNT";
        const limit =
          constrainedBy === "ACTOR" ? policy.actorLimit : policy.accountLimit;
        const used =
          constrainedBy === "ACTOR" ? actorCounter.used : accountCounter.used;
        const allowed = !actorExceeded && !accountExceeded;

        if (
          allowed &&
          input.operationKey !== undefined &&
          input.fingerprint !== undefined
        ) {
          await tx.rateLimitCharge.create({
            data: {
              accountId: input.accountId,
              actorKind: kind,
              actorId: input.actorId,
              endpointClass: input.endpointClass,
              operationKey: input.operationKey,
              fingerprint: input.fingerprint,
              cost: input.cost,
              expiresAt: new Date(
                now.getTime() + input.idempotencyTtlSeconds * 1_000,
              ),
            },
          });
        }

        if (override) {
          await tx.securityAuditRecord.create({
            data: {
              scope: AuditScope.ACCOUNT,
              accountId: input.accountId,
              actorKind: kind,
              actorId: input.actorId,
              actorUserId: input.actorKind === "USER" ? input.actorId : null,
              action: "rate_limit.override.apply",
              targetType: "RateLimitOverride",
              targetId: override.id,
              outcome: allowed ? AuditOutcome.SUCCEEDED : AuditOutcome.DENIED,
              reasonCode: override.reasonCode,
              metadata: {
                endpointClass: input.endpointClass,
                cost: input.cost,
                constrainedBy,
              },
            },
          });
        }

        return {
          allowed,
          idempotentRetry: false,
          conflict: false,
          limit,
          remaining: Math.max(0, limit - used),
          resetAt,
          retryAfterSeconds: allowed ? 0 : retrySeconds(now, resetAt),
          constrainedBy,
          overrideId: override?.id ?? null,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }

  async grantOverride(input: {
    accountId: string;
    endpointClass: RateLimitClass;
    actorKind: "USER" | "SERVICE" | null;
    actorId: string | null;
    actorLimit: number;
    accountLimit: number;
    reasonCode: string;
    expiresAt: Date;
    grantedBy: TrustedActorContext;
  }) {
    return this.prisma.$transaction(
      async (tx) => {
        const lockKey = `${input.accountId}:${input.endpointClass}`;
        await tx.$queryRaw<Array<{ locked: number }>>`
          SELECT 1::integer AS locked
          FROM pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
        `;
        const databaseTimes = await tx.$queryRaw<Array<{ now: Date }>>`
          SELECT clock_timestamp() AS now
        `;
        const now = databaseTimes[0]?.now;
        if (!now || input.expiresAt <= now) return null;
        const targetKind = input.actorKind ? actorKind(input.actorKind) : null;
        await tx.rateLimitOverride.updateMany({
          where: {
            accountId: input.accountId,
            endpointClass: input.endpointClass,
            actorKind: targetKind,
            actorId: input.actorId,
            status: RateLimitOverrideStatus.ACTIVE,
          },
          data: {
            status: RateLimitOverrideStatus.REVOKED,
            revokedAt: now,
            revokedByActorId: input.grantedBy.actorId,
          },
        });
        const override = await tx.rateLimitOverride.create({
          data: {
            accountId: input.accountId,
            endpointClass: input.endpointClass,
            actorKind: targetKind,
            actorId: input.actorId,
            actorLimit: input.actorLimit,
            accountLimit: input.accountLimit,
            reasonCode: input.reasonCode,
            expiresAt: input.expiresAt,
            grantedByActorId: input.grantedBy.actorId,
          },
        });
        await tx.securityAuditRecord.create({
          data: {
            scope: AuditScope.ACCOUNT,
            accountId: input.accountId,
            actorKind: actorKind(input.grantedBy.actorKind),
            actorId: input.grantedBy.actorId,
            actorUserId: input.grantedBy.actorUserId,
            action: "rate_limit.override.grant",
            capability: input.grantedBy.capability,
            targetType: "RateLimitOverride",
            targetId: override.id,
            outcome: AuditOutcome.SUCCEEDED,
            reasonCode: input.reasonCode,
            metadata: {
              endpointClass: input.endpointClass,
              expiresAt: input.expiresAt.toISOString(),
              actorScoped: input.actorId !== null,
            },
          },
        });
        return override;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }

  async revokeOverride(input: {
    accountId: string;
    overrideId: string;
    reasonCode: string;
    revokedBy: TrustedActorContext;
  }) {
    return this.prisma.$transaction(
      async (tx) => {
        const databaseTimes = await tx.$queryRaw<Array<{ now: Date }>>`
          SELECT clock_timestamp() AS now
        `;
        const now = databaseTimes[0]?.now;
        if (!now) return null;
        let existing = await tx.rateLimitOverride.findUnique({
          where: {
            accountId_id: {
              accountId: input.accountId,
              id: input.overrideId,
            },
          },
        });
        if (!existing || existing.status !== RateLimitOverrideStatus.ACTIVE) {
          return null;
        }
        const lockKey = `${input.accountId}:${existing.endpointClass}`;
        await tx.$queryRaw<Array<{ locked: number }>>`
          SELECT 1::integer AS locked
          FROM pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
        `;
        existing = await tx.rateLimitOverride.findUnique({
          where: {
            accountId_id: {
              accountId: input.accountId,
              id: input.overrideId,
            },
          },
        });
        if (!existing || existing.status !== RateLimitOverrideStatus.ACTIVE) {
          return null;
        }
        const override = await tx.rateLimitOverride.update({
          where: { id: existing.id },
          data: {
            status: RateLimitOverrideStatus.REVOKED,
            revokedAt: now,
            revokedByActorId: input.revokedBy.actorId,
          },
        });
        await tx.securityAuditRecord.create({
          data: {
            scope: AuditScope.ACCOUNT,
            accountId: input.accountId,
            actorKind: actorKind(input.revokedBy.actorKind),
            actorId: input.revokedBy.actorId,
            actorUserId: input.revokedBy.actorUserId,
            action: "rate_limit.override.revoke",
            capability: input.revokedBy.capability,
            targetType: "RateLimitOverride",
            targetId: override.id,
            outcome: AuditOutcome.SUCCEEDED,
            reasonCode: input.reasonCode,
          },
        });
        return override;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }
}
