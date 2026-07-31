import {
  ActorKind,
  AuditOutcome,
  AuditScope,
  CalendarConnectionStatus,
  CalendarEventSyncStatus,
  Prisma,
  type CalendarDetailLevel,
  type CalendarProvider,
  type PrismaClient,
} from "@prisma/client";

import { CALENDAR_SYNC_LEASE_SECONDS } from "@/domain/calendar-sync";
import type { TrustedActorContext } from "@/server/auth/types";

export class CalendarConnectionExistsError extends Error {}

const actorKind = (value: "USER" | "SERVICE") =>
  value === "USER" ? ActorKind.USER : ActorKind.SERVICE;

function auditActor(actor: TrustedActorContext) {
  return {
    actorKind: actorKind(actor.actorKind),
    actorId: actor.actorId,
    actorUserId: actor.actorUserId,
    capability: actor.capability,
  };
}

export class PrismaCalendarSyncRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createConnection(input: {
    accountId: string;
    provider: CalendarProvider;
    providerCalendarId: string;
    credentialReference: string;
    timeZone: string;
    detailLevel: CalendarDetailLevel;
    actor: TrustedActorContext;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.calendarConnection.findUnique({
        where: {
          accountId_provider_providerCalendarId: {
            accountId: input.accountId,
            provider: input.provider,
            providerCalendarId: input.providerCalendarId,
          },
        },
      });
      if (
        existing &&
        existing.status !== CalendarConnectionStatus.DISCONNECTED
      ) {
        throw new CalendarConnectionExistsError();
      }
      const connection = existing
        ? await tx.calendarConnection.update({
            where: { id: existing.id },
            data: {
              credentialReference: input.credentialReference,
              timeZone: input.timeZone,
              detailLevel: input.detailLevel,
              status: CalendarConnectionStatus.ACTIVE,
              disconnectedAt: null,
              lastFailureAt: null,
              lastFailureCode: null,
            },
          })
        : await tx.calendarConnection.create({
            data: {
              accountId: input.accountId,
              provider: input.provider,
              providerCalendarId: input.providerCalendarId,
              credentialReference: input.credentialReference,
              timeZone: input.timeZone,
              detailLevel: input.detailLevel,
            },
          });
      await tx.securityAuditRecord.create({
        data: {
          scope: AuditScope.ACCOUNT,
          accountId: input.accountId,
          ...auditActor(input.actor),
          action: existing
            ? "calendar.connection.reconnect"
            : "calendar.connection.create",
          targetType: "CalendarConnection",
          targetId: connection.id,
          outcome: AuditOutcome.SUCCEEDED,
          metadata: {
            provider: connection.provider,
            detailLevel: connection.detailLevel,
            timeZone: connection.timeZone,
          },
        },
      });
      return connection;
    });
  }

  async listConnections(accountId: string) {
    return this.prisma.calendarConnection.findMany({
      where: { accountId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        externalId: true,
        provider: true,
        providerCalendarId: true,
        timeZone: true,
        detailLevel: true,
        status: true,
        lastSyncAt: true,
        lastFailureAt: true,
        lastFailureCode: true,
        disconnectedAt: true,
        createdAt: true,
        events: {
          where: {
            status: {
              in: [
                CalendarEventSyncStatus.PENDING,
                CalendarEventSyncStatus.FAILED,
                CalendarEventSyncStatus.CONFLICT,
              ],
            },
          },
          orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
          take: 100,
          select: {
            status: true,
            attemptCount: true,
            lastFailureCode: true,
            lastAttemptAt: true,
            game: { select: { externalId: true, scheduledAt: true } },
          },
        },
      },
    });
  }

  async beginDisconnect(input: {
    accountId: string;
    connectionExternalId: string;
    actor: TrustedActorContext;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const connection = await tx.calendarConnection.findFirst({
        where: {
          accountId: input.accountId,
          externalId: input.connectionExternalId,
          status: { not: CalendarConnectionStatus.DISCONNECTED },
        },
      });
      if (!connection) return false;
      await tx.calendarConnection.update({
        where: { id: connection.id },
        data: {
          status: CalendarConnectionStatus.DISCONNECTING,
          lastFailureAt: null,
          lastFailureCode: null,
        },
      });
      await tx.securityAuditRecord.create({
        data: {
          scope: AuditScope.ACCOUNT,
          accountId: input.accountId,
          ...auditActor(input.actor),
          action: "calendar.connection.disconnect",
          targetType: "CalendarConnection",
          targetId: connection.id,
          outcome: AuditOutcome.SUCCEEDED,
        },
      });
      return true;
    });
  }

  async retryFailures(input: {
    accountId: string;
    connectionExternalId: string;
    force: boolean;
    actor: TrustedActorContext;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const connection = await tx.calendarConnection.findFirst({
        where: {
          accountId: input.accountId,
          externalId: input.connectionExternalId,
          status: { not: CalendarConnectionStatus.DISCONNECTED },
        },
      });
      if (!connection) return null;
      const retried = await tx.calendarEventLink.updateMany({
        where: {
          accountId: input.accountId,
          connectionId: connection.id,
          status: {
            in: [
              CalendarEventSyncStatus.FAILED,
              CalendarEventSyncStatus.CONFLICT,
            ],
          },
        },
        data: {
          status: CalendarEventSyncStatus.PENDING,
          lastFailureCode: null,
          ...(input.force ? { providerVersion: null } : {}),
        },
      });
      await tx.calendarConnection.update({
        where: { id: connection.id },
        data: { lastFailureAt: null, lastFailureCode: null },
      });
      await tx.securityAuditRecord.create({
        data: {
          scope: AuditScope.ACCOUNT,
          accountId: input.accountId,
          ...auditActor(input.actor),
          action: "calendar.sync.retry",
          targetType: "CalendarConnection",
          targetId: connection.id,
          outcome: AuditOutcome.SUCCEEDED,
          metadata: { force: input.force, retried: retried.count },
        },
      });
      return retried.count;
    });
  }

  async claimConnection(input: {
    workerId: string;
    now: Date;
    connectionExternalId?: string;
  }) {
    const leaseExpiresAt = new Date(
      input.now.getTime() + CALENDAR_SYNC_LEASE_SECONDS * 1_000,
    );
    return this.prisma.$transaction(async (tx) => {
      const requested = input.connectionExternalId
        ? Prisma.sql`AND "externalId" = ${input.connectionExternalId}::uuid`
        : Prisma.empty;
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id"
        FROM "CalendarConnection"
        WHERE "status" IN ('ACTIVE'::"CalendarConnectionStatus", 'DISCONNECTING'::"CalendarConnectionStatus")
          AND ("syncLeaseExpiresAt" IS NULL OR "syncLeaseExpiresAt" <= ${input.now})
          ${requested}
        ORDER BY "updatedAt" ASC, "id" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `);
      if (!rows[0]) return null;
      await tx.calendarConnection.update({
        where: { id: rows[0].id },
        data: {
          syncLeaseOwner: input.workerId,
          syncLeaseExpiresAt: leaseExpiresAt,
        },
      });
      return tx.calendarConnection.findUniqueOrThrow({
        where: { id: rows[0].id },
      });
    });
  }

  async loadGamesAndLinks(accountId: string, connectionId: string) {
    const [games, links] = await Promise.all([
      this.prisma.game.findMany({
        where: { accountId },
        orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          externalId: true,
          status: true,
          revision: true,
          setupRevision: true,
          teamSeasonId: true,
          scheduledAt: true,
          location: true,
          archivedAt: true,
          readySetupSnapshot: {
            select: {
              teamSnapshots: {
                orderBy: [{ side: "asc" }, { id: "asc" }],
                select: {
                  teamSeasonId: true,
                  displayName: true,
                  isAccountTeam: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.calendarEventLink.findMany({
        where: { accountId, connectionId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
    ]);
    return { games, links };
  }

  async renewLease(input: {
    connectionId: string;
    workerId: string;
    now: Date;
  }) {
    const renewed = await this.prisma.calendarConnection.updateMany({
      where: {
        id: input.connectionId,
        syncLeaseOwner: input.workerId,
        syncLeaseExpiresAt: { gt: input.now },
      },
      data: {
        syncLeaseExpiresAt: new Date(
          input.now.getTime() + CALENDAR_SYNC_LEASE_SECONDS * 1_000,
        ),
      },
    });
    return renewed.count === 1;
  }

  async ensureLink(input: {
    accountId: string;
    connectionId: string;
    gameId: string;
    providerEventId: string;
  }) {
    return this.prisma.calendarEventLink.upsert({
      where: {
        connectionId_gameId: {
          connectionId: input.connectionId,
          gameId: input.gameId,
        },
      },
      update: {},
      create: input,
    });
  }

  async reactivateCancelledLink(input: {
    linkId: string;
    providerEventId: string;
  }) {
    return this.prisma.calendarEventLink.update({
      where: { id: input.linkId },
      data: {
        providerEventId: input.providerEventId,
        providerVersion: null,
        sourceFingerprint: null,
        status: CalendarEventSyncStatus.PENDING,
        lastFailureCode: null,
        cancelledAt: null,
      },
    });
  }

  async recordSynced(input: {
    linkId: string;
    workerId: string;
    providerVersion: string;
    sourceFingerprint: string;
    now: Date;
  }) {
    return this.prisma.calendarEventLink.update({
      where: { id: input.linkId },
      data: {
        providerVersion: input.providerVersion,
        sourceFingerprint: input.sourceFingerprint,
        status: CalendarEventSyncStatus.SYNCED,
        attemptCount: { increment: 1 },
        lastFailureCode: null,
        lastAttemptAt: input.now,
        lastSyncedAt: input.now,
        cancelledAt: null,
      },
    });
  }

  async recordCancelled(input: { linkId: string; now: Date }) {
    return this.prisma.calendarEventLink.update({
      where: { id: input.linkId },
      data: {
        providerVersion: null,
        status: CalendarEventSyncStatus.CANCELLED,
        attemptCount: { increment: 1 },
        lastFailureCode: null,
        lastAttemptAt: input.now,
        cancelledAt: input.now,
      },
    });
  }

  async recordFailure(input: {
    linkId: string;
    code: string;
    conflict: boolean;
    now: Date;
  }) {
    return this.prisma.calendarEventLink.update({
      where: { id: input.linkId },
      data: {
        status: input.conflict
          ? CalendarEventSyncStatus.CONFLICT
          : CalendarEventSyncStatus.FAILED,
        attemptCount: { increment: 1 },
        lastFailureCode: input.code,
        lastAttemptAt: input.now,
      },
    });
  }

  async finishConnection(input: {
    connectionId: string;
    workerId: string;
    now: Date;
    failureCode: string | null;
    disconnected: boolean;
  }) {
    const updated = await this.prisma.calendarConnection.updateMany({
      where: {
        id: input.connectionId,
        syncLeaseOwner: input.workerId,
      },
      data: {
        syncLeaseOwner: null,
        syncLeaseExpiresAt: null,
        lastSyncAt: input.now,
        lastFailureAt: input.failureCode ? input.now : null,
        lastFailureCode: input.failureCode,
        ...(input.disconnected
          ? {
              status: CalendarConnectionStatus.DISCONNECTED,
              disconnectedAt: input.now,
            }
          : {}),
      },
    });
    return updated.count === 1;
  }

  async releaseFailedClaim(input: {
    connectionId: string;
    workerId: string;
    now: Date;
    failureCode: string;
  }) {
    await this.finishConnection({
      ...input,
      disconnected: false,
    });
  }
}
