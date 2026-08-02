import { Prisma, type PrismaClient } from "@prisma/client";

import {
  buildDiscordActivity,
  DISCORD_ACTIVITY_HISTORY_LIMIT,
  safeDiscordActivityFailureCode,
} from "@/domain/discord-activity";

const activitySelection = {
  externalId: true,
  status: true,
  installedAt: true,
  updatedAt: true,
  settings: {
    select: {
      id: true,
      enabled: true,
      nextScheduledEvaluationAt: true,
      _count: { select: { trackedScopes: true, destinations: true } },
    },
  },
} satisfies Prisma.DiscordInstallationSelect;

export class PrismaDiscordActivityRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getWorkspace(accountId: string, installationExternalId: string) {
    const installation = await this.prisma.discordInstallation.findUnique({
      where: {
        accountId_externalId: {
          accountId,
          externalId: installationExternalId,
        },
      },
      select: activitySelection,
    });
    if (!installation) return null;
    const settings = installation.settings;
    if (!settings) {
      return buildDiscordActivity({
        installation: {
          id: installation.externalId,
          status: installation.status,
          installedAt: installation.installedAt,
        },
        installationUpdatedAt: installation.updatedAt,
        settings: null,
        lastHeartbeatAt: null,
        lastApiReadAt: null,
        lastDeliveryAt: null,
        failures: [],
        deliveries: [],
      });
    }

    const workFilter = { accountId, settingsId: settings.id };
    const activity = await this.prisma.$transaction(
      async (tx) => {
        const evaluationActivity = await tx.discordUpdateEvaluation.aggregate({
          where: workFilter,
          _max: {
            evaluatedAt: true,
            deadLetteredAt: true,
            cancelledAt: true,
          },
        });
        const apiRead = await tx.discordUpdateEvaluation.aggregate({
          where: { ...workFilter, evaluatedAt: { not: null } },
          _max: { evaluatedAt: true },
        });
        const deliveryActivity =
          await tx.discordUpdateDeliveryAttempt.aggregate({
            where: { accountId, delivery: { settingsId: settings.id } },
            _max: { completedAt: true },
          });
        const successfulDelivery = await tx.discordUpdateDelivery.aggregate({
          where: { ...workFilter, status: "SUCCEEDED" },
          _max: { deliveredAt: true },
        });
        const evaluationFailures = await tx.discordUpdateEvaluation.groupBy({
          by: ["lastFailureCode"],
          where: {
            ...workFilter,
            status: { in: ["PENDING", "PROCESSING", "DEAD_LETTER"] },
            lastFailureCode: { not: null },
          },
          _max: { updatedAt: true },
        });
        const deliveryFailures = await tx.discordUpdateDelivery.groupBy({
          by: ["lastFailureCode"],
          where: {
            ...workFilter,
            status: { in: ["PENDING", "PROCESSING", "DEAD_LETTER"] },
            lastFailureCode: { not: null },
          },
          _max: { updatedAt: true },
        });
        const deliveryRows = await tx.discordUpdateDelivery.findMany({
          where: workFilter,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: DISCORD_ACTIVITY_HISTORY_LIMIT,
          select: {
            externalId: true,
            operation: true,
            status: true,
            attemptCount: true,
            lastFailureCode: true,
            nextAttemptAt: true,
            deliveredAt: true,
            updatedAt: true,
          },
        });
        return {
          evaluationActivity,
          apiRead,
          deliveryActivity,
          successfulDelivery,
          evaluationFailures,
          deliveryFailures,
          deliveryRows,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    const deliveries = activity.deliveryRows.map((delivery) => ({
      correlationId: delivery.externalId,
      operation: delivery.operation,
      status: delivery.status,
      attemptCount: delivery.attemptCount,
      failureCode: delivery.lastFailureCode
        ? safeDiscordActivityFailureCode(delivery.lastFailureCode)
        : null,
      scheduledAt: delivery.nextAttemptAt,
      deliveredAt: delivery.deliveredAt,
      updatedAt: delivery.updatedAt,
    }));
    const lastHeartbeatAt = [
      activity.evaluationActivity._max.evaluatedAt,
      activity.evaluationActivity._max.deadLetteredAt,
      activity.evaluationActivity._max.cancelledAt,
      activity.deliveryActivity._max.completedAt,
    ].reduce<Date | null>(
      (latest, value) =>
        value && (!latest || value.getTime() > latest.getTime())
          ? value
          : latest,
      null,
    );
    const failures = [
      ...activity.evaluationFailures,
      ...activity.deliveryFailures,
    ].flatMap((failure) =>
      failure.lastFailureCode && failure._max.updatedAt
        ? [
            {
              code: failure.lastFailureCode,
              updatedAt: failure._max.updatedAt,
            },
          ]
        : [],
    );

    return buildDiscordActivity({
      installation: {
        id: installation.externalId,
        status: installation.status,
        installedAt: installation.installedAt,
      },
      installationUpdatedAt: installation.updatedAt,
      settings: {
        enabled: settings.enabled,
        nextScheduledEvaluationAt: settings.nextScheduledEvaluationAt,
        trackedScopeCount: settings._count.trackedScopes,
        destinationCount: settings._count.destinations,
      },
      lastHeartbeatAt,
      lastApiReadAt: activity.apiRead._max.evaluatedAt,
      lastDeliveryAt: activity.successfulDelivery._max.deliveredAt,
      failures,
      deliveries,
    });
  }
}
