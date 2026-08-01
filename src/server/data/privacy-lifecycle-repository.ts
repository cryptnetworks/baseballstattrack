import { createHash, timingSafeEqual } from "node:crypto";

import {
  ActorKind,
  AuditOutcome,
  AuditScope,
  DataExportArtifactStatus,
  PrivacyLifecycleStatus,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";

import type { TrustedActorContext } from "@/server/auth/types";

type LifecycleTarget = "ACCOUNT" | "USER" | "PLAYER";

function tokenVerifier(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function sameVerifier(candidate: string, expected: string) {
  const left = Buffer.from(tokenVerifier(candidate), "hex");
  const right = Buffer.from(expected, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

function auditData(input: {
  actor: TrustedActorContext;
  action: string;
  outcome: "SUCCEEDED" | "DENIED" | "FAILED";
  targetType: string;
  targetId: string;
  reasonCode?: string;
  metadata?: Prisma.InputJsonObject;
}) {
  return {
    scope: AuditScope.ACCOUNT,
    accountId: input.actor.accountId,
    actorKind:
      input.actor.actorKind === "USER" ? ActorKind.USER : ActorKind.SERVICE,
    actorId: input.actor.actorId,
    actorUserId: input.actor.actorUserId,
    action: input.action,
    capability: input.actor.capability,
    targetType: input.targetType,
    targetId: input.targetId,
    outcome:
      input.outcome === "SUCCEEDED"
        ? AuditOutcome.SUCCEEDED
        : input.outcome === "DENIED"
          ? AuditOutcome.DENIED
          : AuditOutcome.FAILED,
    ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}

export class PrismaPrivacyLifecycleRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async prepareExportArtifact(input: {
    accountId: string;
    actor: TrustedActorContext;
    clientRequestId: string;
    token: string;
    expiresAt: Date;
  }) {
    return this.prisma.$transaction(
      async (tx) => {
        const row = await tx.dataExportArtifact.upsert({
          where: {
            accountId_requestedByActorId_clientRequestId: {
              accountId: input.accountId,
              requestedByActorId: input.actor.actorId,
              clientRequestId: input.clientRequestId,
            },
          },
          create: {
            accountId: input.accountId,
            requestedByActorId: input.actor.actorId,
            clientRequestId: input.clientRequestId,
            tokenVerifier: tokenVerifier(input.token),
            expiresAt: input.expiresAt,
          },
          update: {
            status: DataExportArtifactStatus.AVAILABLE,
            tokenVerifier: tokenVerifier(input.token),
            expiresAt: input.expiresAt,
            downloadedAt: null,
            cancelledAt: null,
            revokedAt: null,
          },
          select: { id: true, expiresAt: true },
        });
        await tx.securityAuditRecord.create({
          data: auditData({
            actor: input.actor,
            action: "data.export.prepare",
            outcome: "SUCCEEDED",
            targetType: "DataExportArtifact",
            targetId: row.id,
            metadata: {
              expiresAt: input.expiresAt.toISOString(),
              oneTime: true,
              storesBody: false,
            },
          }),
        });
        return row;
      },
      { isolationLevel: "Serializable" },
    );
  }

  async consumeExportArtifact(input: {
    accountId: string;
    artifactId: string;
    token: string;
    actor: TrustedActorContext;
    now: Date;
  }): Promise<boolean> {
    return this.prisma.$transaction(
      async (tx) => {
        const row = await tx.dataExportArtifact.findUnique({
          where: {
            accountId_id: {
              accountId: input.accountId,
              id: input.artifactId,
            },
          },
        });
        const expired = row?.expiresAt
          ? row.expiresAt.getTime() <= input.now.getTime()
          : false;
        const available =
          row?.status === DataExportArtifactStatus.AVAILABLE &&
          !expired &&
          row.requestedByActorId === input.actor.actorId &&
          row.tokenVerifier !== null &&
          sameVerifier(input.token, row.tokenVerifier);
        if (!available || !row) {
          if (row?.status === DataExportArtifactStatus.AVAILABLE && expired) {
            await tx.dataExportArtifact.update({
              where: { id: row.id },
              data: {
                status: DataExportArtifactStatus.EXPIRED,
                tokenVerifier: null,
              },
            });
          }
          await tx.securityAuditRecord.create({
            data: auditData({
              actor: input.actor,
              action: "data.export.download",
              outcome: "DENIED",
              targetType: "DataExportArtifact",
              targetId: input.artifactId,
              reasonCode: "EXPORT_UNAVAILABLE",
            }),
          });
          return false;
        }
        await tx.dataExportArtifact.update({
          where: { id: row.id },
          data: {
            status: DataExportArtifactStatus.DOWNLOADED,
            tokenVerifier: null,
            downloadedAt: input.now,
          },
        });
        await tx.securityAuditRecord.create({
          data: auditData({
            actor: input.actor,
            action: "data.export.download",
            outcome: "SUCCEEDED",
            targetType: "DataExportArtifact",
            targetId: row.id,
            metadata: { oneTime: true, storesBody: false },
          }),
        });
        return true;
      },
      { isolationLevel: "Serializable" },
    );
  }

  async cancelExportArtifact(input: {
    accountId: string;
    artifactId: string;
    token: string;
    actor: TrustedActorContext;
    now: Date;
  }): Promise<boolean> {
    return this.prisma.$transaction(
      async (tx) => {
        const row = await tx.dataExportArtifact.findUnique({
          where: {
            accountId_id: {
              accountId: input.accountId,
              id: input.artifactId,
            },
          },
        });
        const allowed =
          row?.status === DataExportArtifactStatus.AVAILABLE &&
          row.requestedByActorId === input.actor.actorId &&
          row.tokenVerifier !== null &&
          sameVerifier(input.token, row.tokenVerifier);
        if (allowed && row) {
          await tx.dataExportArtifact.update({
            where: { id: row.id },
            data: {
              status: DataExportArtifactStatus.CANCELLED,
              tokenVerifier: null,
              cancelledAt: input.now,
            },
          });
        }
        await tx.securityAuditRecord.create({
          data: auditData({
            actor: input.actor,
            action: "data.export.cancel",
            outcome: allowed ? "SUCCEEDED" : "DENIED",
            targetType: "DataExportArtifact",
            targetId: input.artifactId,
            ...(allowed ? {} : { reasonCode: "EXPORT_UNAVAILABLE" }),
          }),
        });
        return allowed;
      },
      { isolationLevel: "Serializable" },
    );
  }

  async createLifecycleRequest(input: {
    accountId: string;
    actor: TrustedActorContext;
    clientRequestId: string;
    target: LifecycleTarget;
    targetId: string;
    reasonCode: string;
    scheduledFor: Date;
    now: Date;
  }) {
    return this.prisma.$transaction(
      async (tx) => {
        const unique = {
          accountId: input.accountId,
          requestedByActorId: input.actor.actorId,
          clientRequestId: input.clientRequestId,
        };
        const existing = await tx.privacyLifecycleRequest.findUnique({
          where: { accountId_requestedByActorId_clientRequestId: unique },
        });
        if (existing) {
          const exact =
            existing.target === input.target &&
            existing.targetId === input.targetId &&
            existing.reasonCode === input.reasonCode;
          return { request: existing, exactRetry: exact, conflict: !exact };
        }
        const account = await tx.account.findUnique({
          where: { id: input.accountId },
          select: { status: true },
        });
        if (account?.status !== "ACTIVE") return null;
        if (input.target === "USER") {
          const user = await tx.appUser.findUnique({
            where: { id: input.targetId },
            select: { id: true },
          });
          if (!user) return null;
        }
        if (input.target === "PLAYER") {
          const player = await tx.player.findUnique({
            where: {
              accountId_id: {
                accountId: input.accountId,
                id: input.targetId,
              },
            },
            select: { id: true },
          });
          if (!player) return null;
        }
        const activeRequest = await tx.privacyLifecycleRequest.findFirst({
          where: {
            accountId: input.accountId,
            target: input.target,
            targetId: input.targetId,
            status: { in: ["REQUESTED", "BLOCKED"] },
          },
        });
        if (activeRequest) {
          return {
            request: activeRequest,
            exactRetry: false,
            conflict: true,
          };
        }
        const request = await tx.privacyLifecycleRequest.create({
          data: {
            ...unique,
            target: input.target,
            targetId: input.targetId,
            reasonCode: input.reasonCode,
            scheduledFor: input.scheduledFor,
            confirmedAt: input.now,
          },
        });
        await tx.securityAuditRecord.create({
          data: auditData({
            actor: input.actor,
            action: "privacy.lifecycle.request",
            outcome: "SUCCEEDED",
            targetType: "PrivacyLifecycleRequest",
            targetId: request.id,
            metadata: {
              target: input.target,
              scheduledFor: input.scheduledFor.toISOString(),
            },
          }),
        });
        return { request, exactRetry: false, conflict: false };
      },
      { isolationLevel: "Serializable" },
    );
  }

  async cancelLifecycleRequest(input: {
    accountId: string;
    requestId: string;
    target: LifecycleTarget;
    actor: TrustedActorContext;
    now: Date;
  }) {
    return this.prisma.$transaction(
      async (tx) => {
        const request = await tx.privacyLifecycleRequest.findUnique({
          where: {
            accountId_id: {
              accountId: input.accountId,
              id: input.requestId,
            },
          },
        });
        const allowed =
          request !== null &&
          request.target === input.target &&
          request.requestedByActorId === input.actor.actorId &&
          (request.status === PrivacyLifecycleStatus.REQUESTED ||
            request.status === PrivacyLifecycleStatus.BLOCKED);
        if (!allowed || !request) return null;
        const cancelled = await tx.privacyLifecycleRequest.update({
          where: { id: request.id },
          data: {
            status: PrivacyLifecycleStatus.CANCELLED,
            blockedAt: null,
            cancelledAt: input.now,
          },
        });
        await tx.securityAuditRecord.create({
          data: auditData({
            actor: input.actor,
            action: "privacy.lifecycle.cancel",
            outcome: "SUCCEEDED",
            targetType: "PrivacyLifecycleRequest",
            targetId: request.id,
          }),
        });
        return cancelled;
      },
      { isolationLevel: "Serializable" },
    );
  }

  async placeHold(input: {
    accountId: string;
    requestId: string | null;
    reasonCode: string;
    expiresAt: Date | null;
    actor: TrustedActorContext;
  }) {
    return this.prisma.$transaction(async (tx) => {
      if (input.requestId) {
        const request = await tx.privacyLifecycleRequest.findUnique({
          where: {
            accountId_id: {
              accountId: input.accountId,
              id: input.requestId,
            },
          },
          select: { id: true, status: true },
        });
        if (
          !request ||
          (request.status !== "REQUESTED" && request.status !== "BLOCKED")
        ) {
          return null;
        }
      }
      const hold = await tx.privacyHold.create({
        data: {
          accountId: input.accountId,
          lifecycleRequestId: input.requestId,
          reasonCode: input.reasonCode,
          requestedByActorId: input.actor.actorId,
          expiresAt: input.expiresAt,
        },
      });
      await tx.securityAuditRecord.create({
        data: auditData({
          actor: input.actor,
          action: "privacy.hold.place",
          outcome: "SUCCEEDED",
          targetType: "PrivacyHold",
          targetId: hold.id,
          metadata: {
            scopedToRequest: input.requestId !== null,
            expiresAt: input.expiresAt?.toISOString() ?? "manual-release",
          },
        }),
      });
      return hold;
    });
  }

  async releaseHold(input: {
    accountId: string;
    holdId: string;
    actor: TrustedActorContext;
    now: Date;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const hold = await tx.privacyHold.findUnique({
        where: {
          accountId_id: {
            accountId: input.accountId,
            id: input.holdId,
          },
        },
      });
      if (!hold || hold.status !== "ACTIVE") return null;
      const released = await tx.privacyHold.update({
        where: { id: hold.id },
        data: { status: "RELEASED", releasedAt: input.now },
      });
      await tx.securityAuditRecord.create({
        data: auditData({
          actor: input.actor,
          action: "privacy.hold.release",
          outcome: "SUCCEEDED",
          targetType: "PrivacyHold",
          targetId: hold.id,
        }),
      });
      return released;
    });
  }

  async executeLifecycleRequest(input: {
    accountId: string;
    requestId: string;
    actor: TrustedActorContext;
    now: Date;
  }): Promise<"COMPLETED" | "BLOCKED" | "NOT_READY" | "UNAVAILABLE"> {
    return this.prisma.$transaction(
      async (tx) => {
        const request = await tx.privacyLifecycleRequest.findUnique({
          where: {
            accountId_id: {
              accountId: input.accountId,
              id: input.requestId,
            },
          },
        });
        if (
          !request ||
          (request.status !== PrivacyLifecycleStatus.REQUESTED &&
            request.status !== PrivacyLifecycleStatus.BLOCKED)
        ) {
          return "UNAVAILABLE";
        }
        if (request.scheduledFor.getTime() > input.now.getTime()) {
          return "NOT_READY";
        }
        const hold = await tx.privacyHold.findFirst({
          where: {
            accountId: input.accountId,
            status: "ACTIVE",
            OR: [
              { lifecycleRequestId: null },
              { lifecycleRequestId: request.id },
            ],
            AND: [
              {
                OR: [{ expiresAt: null }, { expiresAt: { gt: input.now } }],
              },
            ],
          },
          select: { id: true },
        });
        if (hold) {
          await tx.privacyLifecycleRequest.update({
            where: { id: request.id },
            data: {
              status: PrivacyLifecycleStatus.BLOCKED,
              blockedAt: input.now,
            },
          });
          await tx.securityAuditRecord.create({
            data: auditData({
              actor: input.actor,
              action: "privacy.lifecycle.execute",
              outcome: "DENIED",
              targetType: "PrivacyLifecycleRequest",
              targetId: request.id,
              reasonCode: "HOLD_ACTIVE",
              metadata: { target: request.target },
            }),
          });
          return "BLOCKED";
        }

        let privacyOverlayRevision: number | null = null;
        if (request.target === "ACCOUNT" || request.target === "PLAYER") {
          const players = await tx.player.findMany({
            where: {
              accountId: input.accountId,
              ...(request.target === "PLAYER" ? { id: request.targetId } : {}),
            },
            select: { id: true },
            orderBy: { id: "asc" },
          });
          if (request.target === "PLAYER" && players.length !== 1) {
            return "UNAVAILABLE";
          }
          if (players.length > 0) {
            const maximum = await tx.privacyOverlay.aggregate({
              where: { accountId: input.accountId },
              _max: { effectiveOrder: true },
            });
            privacyOverlayRevision = (maximum._max.effectiveOrder ?? 0) + 1;
            await tx.privacyOverlay.create({
              data: {
                accountId: input.accountId,
                effectiveOrder: privacyOverlayRevision,
                reasonCode: request.reasonCode,
                actorId: input.actor.actorId,
                actorUserId: input.actor.actorUserId,
                correlationId: request.id,
                fields: {
                  create: players.map(({ id }, index) => ({
                    playerId: id,
                    field: "PLAYER_DISPLAY_NAME",
                    replacementValue: `Deleted player ${index + 1}`,
                  })),
                },
              },
            });
            await tx.player.updateMany({
              where: { id: { in: players.map(({ id }) => id) } },
              data: {
                displayName: "Deleted player",
                archivedAt: input.now,
                revision: { increment: 1 },
              },
            });
            await tx.rosterEntry.updateMany({
              where: {
                accountId: input.accountId,
                playerId: { in: players.map(({ id }) => id) },
              },
              data: {
                status: "ARCHIVED",
                endsAt: input.now,
                archivedAt: input.now,
                revision: { increment: 1 },
              },
            });
          }
          await tx.projectionCheckpoint.deleteMany({
            where: { accountId: input.accountId },
          });
        }

        if (request.target === "ACCOUNT") {
          await tx.accountMembership.updateMany({
            where: {
              accountId: input.accountId,
              status: { in: ["ACTIVE", "INVITED"] },
            },
            data: { status: "DISABLED", disabledAt: input.now },
          });
          await tx.membershipInvitation.updateMany({
            where: { accountId: input.accountId, status: "PENDING" },
            data: {
              status: "REVOKED",
              terminalAt: input.now,
              deliveryContact: null,
            },
          });
          await tx.dataExportArtifact.updateMany({
            where: {
              accountId: input.accountId,
              status: DataExportArtifactStatus.AVAILABLE,
            },
            data: {
              status: DataExportArtifactStatus.REVOKED,
              tokenVerifier: null,
              revokedAt: input.now,
            },
          });
          await tx.webhookEndpoint.updateMany({
            where: {
              accountId: input.accountId,
              status: { not: "REVOKED" },
            },
            data: { status: "REVOKED", revokedAt: input.now },
          });
          await tx.webhookDelivery.updateMany({
            where: {
              accountId: input.accountId,
              status: { in: ["PENDING", "PROCESSING"] },
            },
            data: {
              status: "CANCELLED",
              cancelledAt: input.now,
              leaseOwner: null,
              leaseExpiresAt: null,
              lastFailureCode: "ACCOUNT_ARCHIVED",
            },
          });
          await tx.notificationPreference.updateMany({
            where: {
              accountId: input.accountId,
              status: { not: "OPTED_OUT" },
            },
            data: {
              status: "DISABLED",
              optedOutAt: null,
              disabledAt: input.now,
            },
          });
          await tx.notificationDelivery.updateMany({
            where: {
              accountId: input.accountId,
              status: { in: ["PENDING", "PROCESSING"] },
            },
            data: {
              status: "CANCELLED",
              cancelledAt: input.now,
              leaseOwner: null,
              leaseExpiresAt: null,
              lastFailureCode: "ACCOUNT_ARCHIVED",
            },
          });
          await tx.discordIntegrationSettings.updateMany({
            where: { accountId: input.accountId, enabled: true },
            data: { enabled: false, revision: { increment: 1 } },
          });
          await tx.discordRoleGrant.updateMany({
            where: { accountId: input.accountId, status: "ACTIVE" },
            data: {
              status: "REVOKED",
              revokedAt: input.now,
              revision: { increment: 1 },
            },
          });
          await tx.discordGuildRole.updateMany({
            where: { accountId: input.accountId, enabled: true },
            data: { enabled: false },
          });
          await tx.discordInstallation.updateMany({
            where: { accountId: input.accountId, status: "ACTIVE" },
            data: { status: "DISCONNECTED", disconnectedAt: input.now },
          });
          await tx.discordInstallation.updateMany({
            where: { accountId: input.accountId, status: "PENDING" },
            data: { status: "REVOKED", revokedAt: input.now },
          });
          await tx.externalDataSource.updateMany({
            where: {
              accountId: input.accountId,
              status: { in: ["ACTIVE", "SUSPENDED", "DISABLED"] },
            },
            data: { status: "REVOKED", nextAttemptAt: null },
          });
          await tx.rateLimitCharge.deleteMany({
            where: { accountId: input.accountId },
          });
          await tx.rateLimitCounter.deleteMany({
            where: { accountId: input.accountId },
          });
          await tx.rateLimitOverride.updateMany({
            where: { accountId: input.accountId, status: "ACTIVE" },
            data: {
              status: "REVOKED",
              revokedAt: input.now,
              revokedByActorId: input.actor.actorId,
            },
          });
          await tx.account.update({
            where: { id: input.accountId },
            data: {
              status: "ARCHIVED",
              archivedAt: input.now,
              displayName: "Deleted Account",
            },
          });
        } else if (request.target === "USER") {
          await tx.notificationDelivery.updateMany({
            where: {
              accountId: input.accountId,
              preference: { membership: { userId: request.targetId } },
              status: { in: ["PENDING", "PROCESSING"] },
            },
            data: {
              status: "CANCELLED",
              cancelledAt: input.now,
              leaseOwner: null,
              leaseExpiresAt: null,
              lastFailureCode: "RECIPIENT_DELETED",
            },
          });
          await tx.notificationPreference.updateMany({
            where: {
              accountId: input.accountId,
              membership: { userId: request.targetId },
              status: { not: "OPTED_OUT" },
            },
            data: {
              status: "DISABLED",
              optedOutAt: null,
              disabledAt: input.now,
            },
          });
          await tx.productAnalyticsConsent.deleteMany({
            where: { appUserId: request.targetId },
          });
          await tx.rateLimitCharge.deleteMany({
            where: { actorKind: "USER", actorId: request.targetId },
          });
          await tx.rateLimitCounter.deleteMany({
            where: {
              scope: "ACTOR",
              actorKind: "USER",
              subjectKey: { startsWith: `${request.targetId}:` },
            },
          });
          await tx.rateLimitOverride.updateMany({
            where: {
              actorKind: "USER",
              actorId: request.targetId,
              status: "ACTIVE",
            },
            data: {
              status: "REVOKED",
              revokedAt: input.now,
              revokedByActorId: input.actor.actorId,
            },
          });
          await tx.accountMembership.updateMany({
            where: {
              userId: request.targetId,
              status: { in: ["ACTIVE", "INVITED"] },
            },
            data: { status: "DISABLED", disabledAt: input.now },
          });
          await tx.membershipInvitation.updateMany({
            where: { intendedUserId: request.targetId, status: "PENDING" },
            data: {
              status: "REVOKED",
              terminalAt: input.now,
              deliveryContact: null,
            },
          });
          await tx.appUser.update({
            where: { id: request.targetId },
            data: { status: "DELETED", detachedAt: input.now },
          });
        }

        await tx.privacyLifecycleRequest.update({
          where: { id: request.id },
          data: {
            status: PrivacyLifecycleStatus.COMPLETED,
            blockedAt: null,
            completedAt: input.now,
          },
        });
        await tx.securityAuditRecord.create({
          data: auditData({
            actor: input.actor,
            action: "privacy.lifecycle.execute",
            outcome: "SUCCEEDED",
            targetType: "PrivacyLifecycleRequest",
            targetId: request.id,
            metadata: {
              target: request.target,
              privacyOverlayRevision,
              immutableHistoryRetained: true,
              projectionsDeleted: request.target !== "USER",
            },
          }),
        });
        return "COMPLETED";
      },
      { isolationLevel: "Serializable" },
    );
  }
}
