import {
  ActorKind,
  AuditOutcome,
  AuditScope,
  MembershipStatus,
  NotificationPreferenceStatus,
  Prisma,
  WebhookAttemptOutcome,
  WebhookDeliveryStatus,
  WebhookEndpointStatus,
  type PrismaClient,
  type WebhookEventName as StoredWebhookEventName,
} from "@prisma/client";

import {
  NOTIFICATION_DELIVERY_RETENTION_DAYS,
  NOTIFICATION_MESSAGE_VERSION,
  notificationDeliveryAt,
} from "@/domain/notifications";
import {
  WEBHOOK_DEAD_LETTER_RETENTION_DAYS,
  WEBHOOK_DELIVERY_RETENTION_DAYS,
  WEBHOOK_EVENT_RETENTION_DAYS,
  WEBHOOK_LEASE_SECONDS,
  WEBHOOK_PAYLOAD_VERSION,
  parseWebhookPayload,
  webhookRetryAt,
  type WebhookEventName,
} from "@/domain/webhooks";
import type { TrustedActorContext } from "@/server/auth/types";

const addDays = (date: Date, days: number) =>
  new Date(date.getTime() + days * 24 * 60 * 60 * 1_000);

const actorKind = (value: "USER" | "SERVICE") =>
  value === "USER" ? ActorKind.USER : ActorKind.SERVICE;

export async function enqueueWebhookEvent(
  tx: Prisma.TransactionClient,
  input: {
    accountId: string;
    eventName: WebhookEventName;
    deduplicationKey: string;
    payload: unknown;
    occurredAt: Date;
  },
) {
  const payload = parseWebhookPayload(input.eventName, input.payload);
  const event = await tx.webhookEvent.upsert({
    where: {
      accountId_deduplicationKey: {
        accountId: input.accountId,
        deduplicationKey: input.deduplicationKey,
      },
    },
    update: {},
    create: {
      accountId: input.accountId,
      eventName: input.eventName as StoredWebhookEventName,
      payloadVersion: WEBHOOK_PAYLOAD_VERSION,
      deduplicationKey: input.deduplicationKey,
      payload: payload as Prisma.InputJsonValue,
      occurredAt: input.occurredAt,
      retentionUntil: addDays(input.occurredAt, WEBHOOK_EVENT_RETENTION_DAYS),
    },
  });
  const endpoints = await tx.webhookEndpoint.findMany({
    where: {
      accountId: input.accountId,
      status: WebhookEndpointStatus.ACTIVE,
      subscribedEvents: { has: input.eventName as StoredWebhookEventName },
    },
    select: { id: true, secretVersion: true },
  });
  if (endpoints.length) {
    await tx.webhookDelivery.createMany({
      data: endpoints.map((endpoint) => ({
        accountId: input.accountId,
        endpointId: endpoint.id,
        eventId: event.id,
        secretVersion: endpoint.secretVersion,
        retentionUntil: addDays(
          input.occurredAt,
          WEBHOOK_DELIVERY_RETENTION_DAYS,
        ),
      })),
      skipDuplicates: true,
    });
  }

  let teamId: string | null = null;
  let fantasyLeagueId: string | null = null;
  const teamExternalId =
    typeof payload.teamId === "string" ? payload.teamId : null;
  if (teamExternalId) {
    teamId =
      (
        await tx.team.findUnique({
          where: {
            accountId_externalId: {
              accountId: input.accountId,
              externalId: teamExternalId,
            },
          },
          select: { id: true },
        })
      )?.id ?? null;
  } else if (
    input.eventName === "REPORT_READY" &&
    payload.scope === "GAME" &&
    typeof payload.targetId === "string"
  ) {
    teamId =
      (
        await tx.game.findUnique({
          where: {
            accountId_externalId: {
              accountId: input.accountId,
              externalId: payload.targetId,
            },
          },
          select: { teamSeason: { select: { teamId: true } } },
        })
      )?.teamSeason.teamId ?? null;
  }
  const fantasyLeagueExternalId =
    typeof payload.fantasyLeagueId === "string"
      ? payload.fantasyLeagueId
      : null;
  if (fantasyLeagueExternalId) {
    fantasyLeagueId =
      (
        await tx.fantasyLeagueWorkspace.findUnique({
          where: {
            accountId_externalId: {
              accountId: input.accountId,
              externalId: fantasyLeagueExternalId,
            },
          },
          select: { id: true },
        })
      )?.id ?? null;
  }
  const preferences = await tx.notificationPreference.findMany({
    where: {
      accountId: input.accountId,
      status: NotificationPreferenceStatus.ACTIVE,
      sensitiveContent: false,
      recipientEnabled: true,
      subscribedEvents: { has: input.eventName as StoredWebhookEventName },
      membership: { status: MembershipStatus.ACTIVE },
      OR: [
        { teamId: null, fantasyLeagueId: null },
        ...(teamId ? [{ teamId, fantasyLeagueId: null }] : []),
        ...(fantasyLeagueId ? [{ teamId: null, fantasyLeagueId }] : []),
      ],
    },
    select: {
      id: true,
      channel: true,
      destinationReference: true,
      digestMode: true,
      digestMinute: true,
      timeZone: true,
      quietHoursEnabled: true,
      quietStartMinute: true,
      quietEndMinute: true,
    },
  });
  if (preferences.length) {
    await tx.notificationDelivery.createMany({
      data: preferences.map((preference) => ({
        accountId: input.accountId,
        preferenceId: preference.id,
        eventId: event.id,
        channel: preference.channel,
        destinationReference: preference.destinationReference,
        nextAttemptAt: notificationDeliveryAt(input.occurredAt, preference),
        messageVersion: NOTIFICATION_MESSAGE_VERSION,
        retentionUntil: addDays(
          input.occurredAt,
          NOTIFICATION_DELIVERY_RETENTION_DAYS,
        ),
      })),
      skipDuplicates: true,
    });
  }
  return event;
}

export type ClaimedWebhookDelivery = Awaited<
  ReturnType<PrismaWebhookRepository["claimDue"]>
>[number];

export class PrismaWebhookRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createEndpoint(input: {
    accountId: string;
    url: string;
    subscribedEvents: readonly WebhookEventName[];
    actor: TrustedActorContext;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const endpoint = await tx.webhookEndpoint.create({
        data: {
          accountId: input.accountId,
          url: input.url,
          subscribedEvents:
            input.subscribedEvents as readonly StoredWebhookEventName[] as StoredWebhookEventName[],
        },
      });
      await tx.securityAuditRecord.create({
        data: {
          scope: AuditScope.ACCOUNT,
          accountId: input.accountId,
          actorKind: actorKind(input.actor.actorKind),
          actorId: input.actor.actorId,
          actorUserId: input.actor.actorUserId,
          action: "webhook.endpoint.create",
          capability: input.actor.capability,
          targetType: "WebhookEndpoint",
          targetId: endpoint.id,
          outcome: AuditOutcome.SUCCEEDED,
          metadata: {
            eventCount: input.subscribedEvents.length,
            secretVersion: endpoint.secretVersion,
          },
        },
      });
      return endpoint;
    });
  }

  async listEndpoints(accountId: string) {
    return this.prisma.webhookEndpoint.findMany({
      where: { accountId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        externalId: true,
        url: true,
        status: true,
        subscribedEvents: true,
        secretVersion: true,
        verifiedAt: true,
        revokedAt: true,
        createdAt: true,
        _count: {
          select: {
            deliveries: {
              where: { status: WebhookDeliveryStatus.DEAD_LETTER },
            },
          },
        },
      },
    });
  }

  async resolveEndpoint(accountId: string, externalId: string) {
    return this.prisma.webhookEndpoint.findUnique({
      where: { accountId_externalId: { accountId, externalId } },
    });
  }

  async listDeliveries(accountId: string, endpointId: string) {
    return this.prisma.webhookDelivery.findMany({
      where: { accountId, endpointId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100,
      select: {
        externalId: true,
        replayNumber: true,
        status: true,
        attemptCount: true,
        nextAttemptAt: true,
        lastFailureCode: true,
        deliveredAt: true,
        deadLetteredAt: true,
        cancelledAt: true,
        createdAt: true,
        event: {
          select: {
            externalId: true,
            sequence: true,
            eventName: true,
            payloadVersion: true,
            occurredAt: true,
            retentionUntil: true,
          },
        },
      },
    });
  }

  async activateEndpoint(input: {
    accountId: string;
    endpointId: string;
    actor: TrustedActorContext;
    verifiedAt: Date;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.webhookEndpoint.updateMany({
        where: {
          accountId: input.accountId,
          id: input.endpointId,
          status: WebhookEndpointStatus.PENDING_VERIFICATION,
        },
        data: {
          status: WebhookEndpointStatus.ACTIVE,
          verifiedAt: input.verifiedAt,
        },
      });
      if (updated.count !== 1) return null;
      await tx.securityAuditRecord.create({
        data: {
          scope: AuditScope.ACCOUNT,
          accountId: input.accountId,
          actorKind: actorKind(input.actor.actorKind),
          actorId: input.actor.actorId,
          actorUserId: input.actor.actorUserId,
          action: "webhook.endpoint.verify",
          capability: input.actor.capability,
          targetType: "WebhookEndpoint",
          targetId: input.endpointId,
          outcome: AuditOutcome.SUCCEEDED,
        },
      });
      return tx.webhookEndpoint.findUnique({ where: { id: input.endpointId } });
    });
  }

  async rotateSecret(input: {
    accountId: string;
    endpointId: string;
    actor: TrustedActorContext;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const endpoint = await tx.webhookEndpoint.findFirst({
        where: {
          accountId: input.accountId,
          id: input.endpointId,
          status: { not: WebhookEndpointStatus.REVOKED },
        },
      });
      if (!endpoint) return null;
      const rotated = await tx.webhookEndpoint.update({
        where: { id: endpoint.id },
        data: { secretVersion: { increment: 1 } },
      });
      await tx.securityAuditRecord.create({
        data: {
          scope: AuditScope.ACCOUNT,
          accountId: input.accountId,
          actorKind: actorKind(input.actor.actorKind),
          actorId: input.actor.actorId,
          actorUserId: input.actor.actorUserId,
          action: "webhook.secret.rotate",
          capability: input.actor.capability,
          targetType: "WebhookEndpoint",
          targetId: endpoint.id,
          outcome: AuditOutcome.SUCCEEDED,
          metadata: {
            priorSecretVersion: endpoint.secretVersion,
            secretVersion: rotated.secretVersion,
          },
        },
      });
      return rotated;
    });
  }

  async revokeEndpoint(input: {
    accountId: string;
    endpointId: string;
    actor: TrustedActorContext;
    reasonCode: string;
    revokedAt: Date;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.webhookEndpoint.updateMany({
        where: {
          accountId: input.accountId,
          id: input.endpointId,
          status: { not: WebhookEndpointStatus.REVOKED },
        },
        data: {
          status: WebhookEndpointStatus.REVOKED,
          revokedAt: input.revokedAt,
        },
      });
      if (updated.count !== 1) return false;
      await tx.webhookDelivery.updateMany({
        where: {
          accountId: input.accountId,
          endpointId: input.endpointId,
          status: {
            in: [
              WebhookDeliveryStatus.PENDING,
              WebhookDeliveryStatus.PROCESSING,
            ],
          },
        },
        data: {
          status: WebhookDeliveryStatus.CANCELLED,
          cancelledAt: input.revokedAt,
          leaseOwner: null,
          leaseExpiresAt: null,
          lastFailureCode: "ENDPOINT_REVOKED",
        },
      });
      await tx.securityAuditRecord.create({
        data: {
          scope: AuditScope.ACCOUNT,
          accountId: input.accountId,
          actorKind: actorKind(input.actor.actorKind),
          actorId: input.actor.actorId,
          actorUserId: input.actor.actorUserId,
          action: "webhook.endpoint.revoke",
          capability: input.actor.capability,
          targetType: "WebhookEndpoint",
          targetId: input.endpointId,
          outcome: AuditOutcome.SUCCEEDED,
          reasonCode: input.reasonCode,
        },
      });
      return true;
    });
  }

  async replayDelivery(input: {
    accountId: string;
    endpointId: string;
    eventExternalId: string;
    actor: TrustedActorContext;
    requestedAt: Date;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const endpoint = await tx.webhookEndpoint.findFirst({
        where: {
          accountId: input.accountId,
          id: input.endpointId,
          status: WebhookEndpointStatus.ACTIVE,
        },
      });
      const event = await tx.webhookEvent.findFirst({
        where: {
          accountId: input.accountId,
          externalId: input.eventExternalId,
          retentionUntil: { gt: input.requestedAt },
        },
      });
      if (!endpoint || !event) return null;
      const latest = await tx.webhookDelivery.aggregate({
        where: { endpointId: endpoint.id, eventId: event.id },
        _max: { replayNumber: true },
      });
      const delivery = await tx.webhookDelivery.create({
        data: {
          accountId: input.accountId,
          endpointId: endpoint.id,
          eventId: event.id,
          replayNumber: (latest._max.replayNumber ?? 0) + 1,
          secretVersion: endpoint.secretVersion,
          replayRequestedAt: input.requestedAt,
          replayRequestedById: input.actor.actorId,
          retentionUntil: addDays(
            input.requestedAt,
            WEBHOOK_DELIVERY_RETENTION_DAYS,
          ),
        },
      });
      await tx.securityAuditRecord.create({
        data: {
          scope: AuditScope.ACCOUNT,
          accountId: input.accountId,
          actorKind: actorKind(input.actor.actorKind),
          actorId: input.actor.actorId,
          actorUserId: input.actor.actorUserId,
          action: "webhook.delivery.replay",
          capability: input.actor.capability,
          targetType: "WebhookDelivery",
          targetId: delivery.id,
          outcome: AuditOutcome.SUCCEEDED,
          metadata: {
            eventId: event.externalId,
            replayNumber: delivery.replayNumber,
          },
        },
      });
      return delivery;
    });
  }

  async claimDue(workerId: string, now: Date, limit: number) {
    const leaseExpiresAt = new Date(
      now.getTime() + WEBHOOK_LEASE_SECONDS * 1_000,
    );
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT d."id"
        FROM "WebhookDelivery" d
        JOIN "WebhookEndpoint" endpoint ON endpoint."id" = d."endpointId"
        JOIN "WebhookEvent" event ON event."id" = d."eventId"
        WHERE endpoint."status" = 'ACTIVE'::"WebhookEndpointStatus"
          AND (
            (d."status" = 'PENDING'::"WebhookDeliveryStatus" AND d."nextAttemptAt" <= ${now})
            OR (d."status" = 'PROCESSING'::"WebhookDeliveryStatus" AND d."leaseExpiresAt" <= ${now})
          )
          AND (
            d."replayNumber" > 0
            OR NOT EXISTS (
              SELECT 1
              FROM "WebhookDelivery" prior
              JOIN "WebhookEvent" prior_event ON prior_event."id" = prior."eventId"
              WHERE prior."endpointId" = d."endpointId"
                AND prior."replayNumber" = 0
                AND prior_event."sequence" < event."sequence"
                AND prior."status" IN ('PENDING'::"WebhookDeliveryStatus", 'PROCESSING'::"WebhookDeliveryStatus")
            )
          )
        ORDER BY event."sequence" ASC, d."createdAt" ASC
        FOR UPDATE OF d SKIP LOCKED
        LIMIT ${limit}
      `);
      if (!rows.length) return [];
      await tx.webhookDelivery.updateMany({
        where: { id: { in: rows.map(({ id }) => id) } },
        data: {
          status: WebhookDeliveryStatus.PROCESSING,
          leaseOwner: workerId,
          leaseExpiresAt,
        },
      });
      return tx.webhookDelivery.findMany({
        where: { id: { in: rows.map(({ id }) => id) } },
        orderBy: [{ event: { sequence: "asc" } }, { createdAt: "asc" }],
        include: {
          endpoint: true,
          event: true,
          account: { select: { externalId: true } },
        },
      });
    });
  }

  async endpointIsActive(accountId: string, endpointId: string) {
    return (
      (await this.prisma.webhookEndpoint.count({
        where: {
          accountId,
          id: endpointId,
          status: WebhookEndpointStatus.ACTIVE,
        },
      })) === 1
    );
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
      const delivery = await tx.webhookDelivery.findFirst({
        where: {
          accountId: input.accountId,
          id: input.deliveryId,
          status: WebhookDeliveryStatus.PROCESSING,
          leaseOwner: input.workerId,
        },
      });
      if (!delivery) return null;
      const attemptNumber = delivery.attemptCount + 1;
      const retryAt =
        input.succeeded || input.terminal
          ? null
          : webhookRetryAt(attemptNumber, input.completedAt);
      const deadLetter = !input.succeeded && retryAt === null;
      await tx.webhookDeliveryAttempt.create({
        data: {
          accountId: input.accountId,
          deliveryId: delivery.id,
          workerId: input.workerId,
          attemptNumber,
          outcome: input.succeeded
            ? WebhookAttemptOutcome.SUCCEEDED
            : deadLetter
              ? WebhookAttemptOutcome.TERMINAL_FAILURE
              : WebhookAttemptOutcome.RETRYABLE_FAILURE,
          responseStatus: input.responseStatus,
          failureCode: input.failureCode,
          durationMs: input.durationMs,
          startedAt: input.startedAt,
          completedAt: input.completedAt,
        },
      });
      return tx.webhookDelivery.update({
        where: { id: delivery.id },
        data: input.succeeded
          ? {
              status: WebhookDeliveryStatus.SUCCEEDED,
              attemptCount: attemptNumber,
              deliveredAt: input.completedAt,
              leaseOwner: null,
              leaseExpiresAt: null,
              lastFailureCode: null,
            }
          : deadLetter
            ? {
                status: WebhookDeliveryStatus.DEAD_LETTER,
                attemptCount: attemptNumber,
                deadLetteredAt: input.completedAt,
                retentionUntil: addDays(
                  input.completedAt,
                  WEBHOOK_DEAD_LETTER_RETENTION_DAYS,
                ),
                leaseOwner: null,
                leaseExpiresAt: null,
                lastFailureCode: input.failureCode,
              }
            : {
                status: WebhookDeliveryStatus.PENDING,
                attemptCount: attemptNumber,
                nextAttemptAt: retryAt!,
                leaseOwner: null,
                leaseExpiresAt: null,
                lastFailureCode: input.failureCode,
              },
      });
    });
  }
}
