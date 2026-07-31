import {
  ActorKind,
  AuditOutcome,
  AuditScope,
  MembershipStatus,
  NotificationAttemptOutcome,
  NotificationDeliveryStatus,
  NotificationPreferenceStatus,
  Prisma,
  type NotificationChannel as StoredNotificationChannel,
  type PrismaClient,
  type WebhookEventName as StoredWebhookEventName,
} from "@prisma/client";

import {
  NOTIFICATION_DEAD_LETTER_RETENTION_DAYS,
  NOTIFICATION_LEASE_SECONDS,
  notificationRetryAt,
  type NotificationChannel,
} from "@/domain/notifications";
import type { WebhookEventName } from "@/domain/webhooks";
import type { TrustedActorContext } from "@/server/auth/types";
import { enqueueWebhookEvent } from "@/server/data/webhook-repository";

const addDays = (date: Date, days: number) =>
  new Date(date.getTime() + days * 24 * 60 * 60 * 1_000);

const actorKind = (value: "USER" | "SERVICE") =>
  value === "USER" ? ActorKind.USER : ActorKind.SERVICE;

export type ClaimedNotificationDelivery = Awaited<
  ReturnType<PrismaNotificationRepository["claimDue"]>
>[number];

export class PrismaNotificationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async configurePreference(input: {
    accountId: string;
    membershipId: string;
    teamId: string | null;
    channel: NotificationChannel;
    destinationReference: string;
    subscribedEvents: readonly WebhookEventName[];
    sensitiveContent: false;
    actor: TrustedActorContext;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const membership = await tx.accountMembership.findFirst({
        where: {
          accountId: input.accountId,
          id: input.membershipId,
          status: MembershipStatus.ACTIVE,
        },
        select: { id: true },
      });
      if (!membership) return null;
      if (
        input.teamId &&
        (await tx.team.count({
          where: { accountId: input.accountId, id: input.teamId },
        })) !== 1
      ) {
        return null;
      }
      const recipientOptOut = await tx.notificationPreference.findFirst({
        where: {
          accountId: input.accountId,
          membershipId: input.membershipId,
          status: NotificationPreferenceStatus.OPTED_OUT,
        },
      });
      if (recipientOptOut) {
        return { outcome: "opted_out" as const, preference: recipientOptOut };
      }
      const scopeKey = input.teamId ? `TEAM:${input.teamId}` : "ACCOUNT";
      const existing = await tx.notificationPreference.findUnique({
        where: {
          accountId_membershipId_scopeKey_channel: {
            accountId: input.accountId,
            membershipId: input.membershipId,
            scopeKey,
            channel: input.channel as StoredNotificationChannel,
          },
        },
      });
      const data = {
        teamId: input.teamId,
        destinationReference: input.destinationReference,
        subscribedEvents:
          input.subscribedEvents as readonly StoredWebhookEventName[] as StoredWebhookEventName[],
        sensitiveContent: input.sensitiveContent,
        status: NotificationPreferenceStatus.ACTIVE,
        disabledAt: null,
      };
      const preference = existing
        ? await tx.notificationPreference.update({
            where: { id: existing.id },
            data,
          })
        : await tx.notificationPreference.create({
            data: {
              accountId: input.accountId,
              membershipId: input.membershipId,
              scopeKey,
              channel: input.channel as StoredNotificationChannel,
              ...data,
            },
          });
      await tx.securityAuditRecord.create({
        data: {
          scope: AuditScope.ACCOUNT,
          accountId: input.accountId,
          actorKind: actorKind(input.actor.actorKind),
          actorId: input.actor.actorId,
          actorUserId: input.actor.actorUserId,
          action: existing
            ? "notification.preference.update"
            : "notification.preference.create",
          capability: input.actor.capability,
          targetType: "NotificationPreference",
          targetId: preference.id,
          outcome: AuditOutcome.SUCCEEDED,
          metadata: {
            membershipId: input.membershipId,
            scopeKey,
            channel: input.channel,
            eventCount: input.subscribedEvents.length,
            destinationReference: input.destinationReference,
            sensitiveContent: false,
          },
        },
      });
      return { outcome: "configured" as const, preference };
    });
  }

  async listPreferences(accountId: string) {
    return this.prisma.notificationPreference.findMany({
      where: { accountId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        externalId: true,
        membershipId: true,
        teamId: true,
        scopeKey: true,
        channel: true,
        destinationReference: true,
        subscribedEvents: true,
        status: true,
        sensitiveContent: true,
        optedOutAt: true,
        disabledAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async listOwnPreferences(accountId: string, membershipId: string) {
    return this.prisma.notificationPreference.findMany({
      where: { accountId, membershipId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        externalId: true,
        teamId: true,
        scopeKey: true,
        channel: true,
        subscribedEvents: true,
        status: true,
        sensitiveContent: true,
        optedOutAt: true,
        disabledAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async listDeliveries(accountId: string, preferenceExternalId?: string) {
    return this.prisma.notificationDelivery.findMany({
      where: {
        accountId,
        ...(preferenceExternalId
          ? { preference: { externalId: preferenceExternalId } }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100,
      select: {
        externalId: true,
        channel: true,
        messageVersion: true,
        status: true,
        attemptCount: true,
        nextAttemptAt: true,
        lastFailureCode: true,
        deliveredAt: true,
        deadLetteredAt: true,
        cancelledAt: true,
        createdAt: true,
        preference: { select: { externalId: true, scopeKey: true } },
        event: {
          select: {
            externalId: true,
            sequence: true,
            eventName: true,
            payloadVersion: true,
            occurredAt: true,
          },
        },
      },
    });
  }

  async disablePreference(input: {
    accountId: string;
    preferenceExternalId: string;
    reasonCode: string;
    actor: TrustedActorContext;
    disabledAt: Date;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const preference = await tx.notificationPreference.findUnique({
        where: {
          accountId_externalId: {
            accountId: input.accountId,
            externalId: input.preferenceExternalId,
          },
        },
      });
      if (!preference) return false;
      if (preference.status !== NotificationPreferenceStatus.OPTED_OUT) {
        await tx.notificationPreference.update({
          where: { id: preference.id },
          data: {
            status: NotificationPreferenceStatus.DISABLED,
            disabledAt: input.disabledAt,
          },
        });
      }
      await tx.notificationDelivery.updateMany({
        where: {
          accountId: input.accountId,
          preferenceId: preference.id,
          status: {
            in: [
              NotificationDeliveryStatus.PENDING,
              NotificationDeliveryStatus.PROCESSING,
            ],
          },
        },
        data: {
          status: NotificationDeliveryStatus.CANCELLED,
          cancelledAt: input.disabledAt,
          leaseOwner: null,
          leaseExpiresAt: null,
          lastFailureCode: "PREFERENCE_DISABLED",
        },
      });
      await tx.securityAuditRecord.create({
        data: {
          scope: AuditScope.ACCOUNT,
          accountId: input.accountId,
          actorKind: actorKind(input.actor.actorKind),
          actorId: input.actor.actorId,
          actorUserId: input.actor.actorUserId,
          action: "notification.preference.disable",
          capability: input.actor.capability,
          targetType: "NotificationPreference",
          targetId: preference.id,
          outcome: AuditOutcome.SUCCEEDED,
          reasonCode: input.reasonCode,
        },
      });
      return true;
    });
  }

  async optOut(input: {
    accountId: string;
    membershipId: string;
    actor: TrustedActorContext;
    optedOutAt: Date;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const preferences = await tx.notificationPreference.findMany({
        where: { accountId: input.accountId, membershipId: input.membershipId },
        select: { id: true },
      });
      if (!preferences.length) return 0;
      const ids = preferences.map(({ id }) => id);
      await tx.notificationPreference.updateMany({
        where: { id: { in: ids } },
        data: {
          status: NotificationPreferenceStatus.OPTED_OUT,
          optedOutAt: input.optedOutAt,
          disabledAt: null,
        },
      });
      await tx.notificationDelivery.updateMany({
        where: {
          accountId: input.accountId,
          preferenceId: { in: ids },
          status: {
            in: [
              NotificationDeliveryStatus.PENDING,
              NotificationDeliveryStatus.PROCESSING,
            ],
          },
        },
        data: {
          status: NotificationDeliveryStatus.CANCELLED,
          cancelledAt: input.optedOutAt,
          leaseOwner: null,
          leaseExpiresAt: null,
          lastFailureCode: "RECIPIENT_OPTED_OUT",
        },
      });
      await tx.securityAuditRecord.create({
        data: {
          scope: AuditScope.ACCOUNT,
          accountId: input.accountId,
          actorKind: actorKind(input.actor.actorKind),
          actorId: input.actor.actorId,
          actorUserId: input.actor.actorUserId,
          action: "notification.preference.opt_out",
          capability: input.actor.capability,
          targetType: "AccountMembership",
          targetId: input.membershipId,
          outcome: AuditOutcome.SUCCEEDED,
          metadata: { preferenceCount: preferences.length },
        },
      });
      return preferences.length;
    });
  }

  async claimDue(workerId: string, now: Date, limit: number) {
    const leaseExpiresAt = new Date(
      now.getTime() + NOTIFICATION_LEASE_SECONDS * 1_000,
    );
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT delivery."id"
        FROM "NotificationDelivery" delivery
        JOIN "NotificationPreference" preference
          ON preference."accountId" = delivery."accountId"
         AND preference."id" = delivery."preferenceId"
        JOIN "AccountMembership" membership
          ON membership."accountId" = preference."accountId"
         AND membership."id" = preference."membershipId"
        JOIN "WebhookEvent" event
          ON event."accountId" = delivery."accountId"
         AND event."id" = delivery."eventId"
        WHERE preference."status" = 'ACTIVE'::"NotificationPreferenceStatus"
          AND membership."status" = 'ACTIVE'::"MembershipStatus"
          AND (
            (delivery."status" = 'PENDING'::"NotificationDeliveryStatus" AND delivery."nextAttemptAt" <= ${now})
            OR (delivery."status" = 'PROCESSING'::"NotificationDeliveryStatus" AND delivery."leaseExpiresAt" <= ${now})
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "NotificationDelivery" prior
            JOIN "WebhookEvent" prior_event
              ON prior_event."accountId" = prior."accountId"
             AND prior_event."id" = prior."eventId"
            WHERE prior."preferenceId" = delivery."preferenceId"
              AND prior_event."sequence" < event."sequence"
              AND prior."status" IN (
                'PENDING'::"NotificationDeliveryStatus",
                'PROCESSING'::"NotificationDeliveryStatus"
              )
          )
        ORDER BY event."sequence" ASC, delivery."createdAt" ASC
        FOR UPDATE OF delivery SKIP LOCKED
        LIMIT ${limit}
      `);
      if (!rows.length) return [];
      await tx.notificationDelivery.updateMany({
        where: { id: { in: rows.map(({ id }) => id) } },
        data: {
          status: NotificationDeliveryStatus.PROCESSING,
          leaseOwner: workerId,
          leaseExpiresAt,
        },
      });
      return tx.notificationDelivery.findMany({
        where: { id: { in: rows.map(({ id }) => id) } },
        orderBy: [{ event: { sequence: "asc" } }, { createdAt: "asc" }],
        include: { preference: true, event: true },
      });
    });
  }

  async preferenceIsActive(accountId: string, preferenceId: string) {
    return (
      (await this.prisma.notificationPreference.count({
        where: {
          accountId,
          id: preferenceId,
          status: NotificationPreferenceStatus.ACTIVE,
          membership: { status: MembershipStatus.ACTIVE },
        },
      })) === 1
    );
  }

  async cancelClaim(input: {
    accountId: string;
    deliveryId: string;
    workerId: string;
    cancelledAt: Date;
    failureCode: string;
  }) {
    return this.prisma.notificationDelivery.updateMany({
      where: {
        accountId: input.accountId,
        id: input.deliveryId,
        status: NotificationDeliveryStatus.PROCESSING,
        leaseOwner: input.workerId,
      },
      data: {
        status: NotificationDeliveryStatus.CANCELLED,
        cancelledAt: input.cancelledAt,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastFailureCode: input.failureCode,
      },
    });
  }

  async completeAttempt(input: {
    accountId: string;
    deliveryId: string;
    workerId: string;
    startedAt: Date;
    completedAt: Date;
    durationMs: number;
    responseStatus: number | null;
    failureCode: string | null;
    succeeded: boolean;
    terminal: boolean;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const delivery = await tx.notificationDelivery.findFirst({
        where: {
          accountId: input.accountId,
          id: input.deliveryId,
          status: NotificationDeliveryStatus.PROCESSING,
          leaseOwner: input.workerId,
        },
      });
      if (!delivery) return null;
      const attemptNumber = delivery.attemptCount + 1;
      const retryAt =
        input.succeeded || input.terminal
          ? null
          : notificationRetryAt(attemptNumber, input.completedAt);
      const deadLetter =
        !input.succeeded && (input.terminal || retryAt === null);
      await tx.notificationDeliveryAttempt.create({
        data: {
          accountId: input.accountId,
          deliveryId: delivery.id,
          workerId: input.workerId,
          attemptNumber,
          outcome: input.succeeded
            ? NotificationAttemptOutcome.SUCCEEDED
            : deadLetter
              ? NotificationAttemptOutcome.TERMINAL_FAILURE
              : NotificationAttemptOutcome.RETRYABLE_FAILURE,
          responseStatus: input.responseStatus,
          failureCode: input.failureCode,
          durationMs: input.durationMs,
          startedAt: input.startedAt,
          completedAt: input.completedAt,
        },
      });
      return tx.notificationDelivery.update({
        where: { id: delivery.id },
        data: input.succeeded
          ? {
              status: NotificationDeliveryStatus.SUCCEEDED,
              attemptCount: attemptNumber,
              deliveredAt: input.completedAt,
              leaseOwner: null,
              leaseExpiresAt: null,
              lastFailureCode: null,
            }
          : deadLetter
            ? {
                status: NotificationDeliveryStatus.DEAD_LETTER,
                attemptCount: attemptNumber,
                deadLetteredAt: input.completedAt,
                retentionUntil: addDays(
                  input.completedAt,
                  NOTIFICATION_DEAD_LETTER_RETENTION_DAYS,
                ),
                leaseOwner: null,
                leaseExpiresAt: null,
                lastFailureCode: input.failureCode,
              }
            : {
                status: NotificationDeliveryStatus.PENDING,
                attemptCount: attemptNumber,
                nextAttemptAt: retryAt!,
                leaseOwner: null,
                leaseExpiresAt: null,
                lastFailureCode: input.failureCode,
              },
      });
    });
  }

  async publishOperationalFailure(input: {
    accountId: string;
    service: string;
    failureCode: string;
    correlationId: string;
    severity: "WARNING" | "CRITICAL";
    teamId?: string;
    occurredAt: Date;
  }) {
    return this.prisma.$transaction((tx) =>
      enqueueWebhookEvent(tx, {
        accountId: input.accountId,
        eventName: "OPERATIONAL_FAILURE",
        deduplicationKey: `operational.failure:${input.service}:${input.correlationId}:${input.failureCode}`,
        payload: {
          service: input.service,
          failureCode: input.failureCode,
          correlationId: input.correlationId,
          severity: input.severity,
          ...(input.teamId ? { teamId: input.teamId } : {}),
        },
        occurredAt: input.occurredAt,
      }),
    );
  }
}
