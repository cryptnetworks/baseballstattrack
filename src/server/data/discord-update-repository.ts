import {
  DiscordUpdateAttemptOutcome,
  DiscordUpdateWorkStatus,
  Prisma,
  type PrismaClient,
} from "@prisma/client";

import type { DiscordUpdateTrigger } from "@/domain/discord-settings";
import {
  planDiscordGameUpdate,
  type DiscordGameUpdateSnapshot,
} from "@/domain/discord-update-content";
import {
  DISCORD_UPDATE_LEASE_SECONDS,
  DISCORD_UPDATE_RETENTION_DAYS,
  discordDestinationPurposeForTrigger,
  discordUpdateRetryAt,
} from "@/domain/discord-update-worker";
import { nextDiscordEvaluation } from "@/domain/discord-update-schedule";

function addDays(value: Date, days: number) {
  return new Date(value.getTime() + days * 86_400_000);
}

const evaluationInclude = {
  account: { select: { externalId: true } },
  game: { select: { externalId: true, teamSeasonId: true } },
  settings: {
    include: {
      installation: { select: { status: true } },
      trackedScopes: { select: { teamSeasonId: true } },
      destinations: {
        include: {
          destination: {
            select: {
              id: true,
              enabled: true,
              canView: true,
              canSend: true,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.DiscordUpdateEvaluationInclude;

const deliveryInclude = {
  destination: {
    select: {
      channelId: true,
      enabled: true,
      canView: true,
      canSend: true,
    },
  },
  settings: {
    include: { installation: { select: { status: true } } },
  },
} satisfies Prisma.DiscordUpdateDeliveryInclude;

export type ClaimedDiscordEvaluation =
  Prisma.DiscordUpdateEvaluationGetPayload<{
    include: typeof evaluationInclude;
  }>;

export type ClaimedDiscordDelivery = Prisma.DiscordUpdateDeliveryGetPayload<{
  include: typeof deliveryInclude;
}>;

function storedSchedule(settings: ClaimedDiscordEvaluation["settings"]) {
  return {
    cadenceMode: settings.cadenceMode,
    cadenceSeconds: settings.cadenceSeconds,
    gameDayWindow: {
      enabled: settings.gameDayWindowEnabled,
      startMinute: settings.gameDayStartMinute,
      endMinute: settings.gameDayEndMinute,
    },
    digest: { enabled: settings.digestEnabled, minute: settings.digestMinute },
    catchUpPolicy: settings.catchUpPolicy,
  };
}

function scheduledTrigger(
  status: string,
  configured: readonly DiscordUpdateTrigger[],
  purposes: ReadonlySet<string>,
) {
  const preferred: DiscordUpdateTrigger[] =
    status === "CORRECTED"
      ? ["GAME_CORRECTED", "GAME_COMPLETED", "SCORE_CHANGED"]
      : status === "VERIFIED"
        ? ["GAME_VERIFIED", "GAME_COMPLETED", "REPORT_READY"]
        : status === "COMPLETED"
          ? ["GAME_COMPLETED", "REPORT_READY"]
          : status === "READY"
            ? ["GAME_SCHEDULED", "GAME_STARTED"]
            : ["SCORE_CHANGED", "INNING_ENDED", "GAME_STARTED"];
  return preferred.find(
    (trigger) =>
      configured.includes(trigger) &&
      purposes.has(discordDestinationPurposeForTrigger(trigger)),
  );
}

export class PrismaDiscordUpdateRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async enqueueDueSchedules(now: Date, limit: number) {
    return this.prisma.$transaction(async (tx) => {
      const due = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT settings."id"
        FROM "DiscordIntegrationSettings" settings
        JOIN "DiscordInstallation" installation
          ON installation."accountId" = settings."accountId"
         AND installation."id" = settings."installationId"
        WHERE settings."enabled" = true
          AND installation."status" = 'ACTIVE'
          AND (
            settings."manualRefreshRequestedAt" IS NOT NULL
            OR settings."nextScheduledEvaluationAt" <= ${now}
          )
        ORDER BY COALESCE(settings."manualRefreshRequestedAt", settings."nextScheduledEvaluationAt"), settings."id"
        FOR UPDATE OF settings SKIP LOCKED
        LIMIT ${limit}
      `);
      if (!due.length) return { settings: 0, created: 0 };
      const settingsRows = await tx.discordIntegrationSettings.findMany({
        where: { id: { in: due.map(({ id }) => id) } },
        include: evaluationInclude.settings.include,
      });
      let created = 0;
      for (const settings of settingsRows) {
        const teamSeasonIds = settings.trackedScopes.map(
          ({ teamSeasonId }) => teamSeasonId,
        );
        const purposes = new Set(
          settings.destinations
            .filter(
              ({ destination }) =>
                destination.enabled &&
                destination.canView &&
                destination.canSend,
            )
            .map(({ purpose }) => purpose),
        );
        const games = teamSeasonIds.length
          ? await tx.game.findMany({
              where: {
                accountId: settings.accountId,
                teamSeasonId: { in: teamSeasonIds },
                archivedAt: null,
                status: {
                  in: [
                    "READY",
                    "IN_PROGRESS",
                    "SUSPENDED",
                    "COMPLETED",
                    "VERIFIED",
                    "CORRECTED",
                  ],
                },
              },
              orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
              take: 100,
              select: { id: true, status: true, revision: true },
            })
          : [];
        for (const game of games) {
          const trigger = scheduledTrigger(
            game.status,
            settings.triggers,
            purposes,
          );
          if (!trigger) continue;
          const result = await tx.discordUpdateEvaluation.createMany({
            data: {
              accountId: settings.accountId,
              settingsId: settings.id,
              gameId: game.id,
              settingsRevision: settings.revision,
              sourceRevision: game.revision,
              trigger,
              nextAttemptAt: now,
              retentionUntil: addDays(now, DISCORD_UPDATE_RETENTION_DAYS),
            },
            skipDuplicates: true,
          });
          created += result.count;
        }
        const nextScheduledEvaluationAt = nextDiscordEvaluation({
          enabled: true,
          policy: storedSchedule(settings),
          quietHours: {
            enabled: settings.quietHoursEnabled,
            startMinute: settings.quietStartMinute,
            endMinute: settings.quietEndMinute,
            timeZone: settings.quietTimeZone,
          },
          now,
          manualRefreshRequestedAt: null,
        });
        await tx.discordIntegrationSettings.update({
          where: { id: settings.id },
          data: {
            manualRefreshRequestedAt: null,
            nextScheduledEvaluationAt,
          },
        });
      }
      return { settings: settingsRows.length, created };
    });
  }

  async enqueueSignal(input: {
    accountId: string;
    gameExternalId: string;
    trigger: DiscordUpdateTrigger;
    sourceRevision: number;
    occurredAt: Date;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const game = await tx.game.findUnique({
        where: {
          accountId_externalId: {
            accountId: input.accountId,
            externalId: input.gameExternalId,
          },
        },
        select: { id: true, teamSeasonId: true },
      });
      if (!game) return { outcome: "unavailable" as const, created: 0 };
      const settingsRows = await tx.discordIntegrationSettings.findMany({
        where: {
          accountId: input.accountId,
          enabled: true,
          installation: { status: "ACTIVE" },
          triggers: { has: input.trigger },
          trackedScopes: { some: { teamSeasonId: game.teamSeasonId } },
          destinations: {
            some: {
              purpose: discordDestinationPurposeForTrigger(input.trigger),
              destination: { enabled: true, canView: true, canSend: true },
            },
          },
        },
      });
      let created = 0;
      for (const settings of settingsRows) {
        const immediate = settings.cadenceMode === "EVENT_DRIVEN";
        const nextAttemptAt = immediate
          ? input.occurredAt
          : (settings.nextScheduledEvaluationAt ??
            (settings.manualRefreshRequestedAt ? input.occurredAt : null));
        if (!nextAttemptAt) continue;
        if (!immediate || settings.messageStrategy === "PERIODIC_SUMMARY") {
          await tx.discordUpdateEvaluation.updateMany({
            where: {
              settingsId: settings.id,
              gameId: game.id,
              status: DiscordUpdateWorkStatus.PENDING,
              sourceRevision: { lt: input.sourceRevision },
            },
            data: {
              status: DiscordUpdateWorkStatus.CANCELLED,
              cancelledAt: input.occurredAt,
              lastFailureCode: "SUPERSEDED_BY_LATEST_STATE",
            },
          });
        }
        const result = await tx.discordUpdateEvaluation.createMany({
          data: {
            accountId: input.accountId,
            settingsId: settings.id,
            gameId: game.id,
            settingsRevision: settings.revision,
            sourceRevision: input.sourceRevision,
            trigger: input.trigger,
            nextAttemptAt,
            retentionUntil: addDays(
              input.occurredAt,
              DISCORD_UPDATE_RETENTION_DAYS,
            ),
          },
          skipDuplicates: true,
        });
        created += result.count;
      }
      return { outcome: "accepted" as const, created };
    });
  }

  async claimEvaluations(workerId: string, now: Date, limit: number) {
    const leaseExpiresAt = new Date(
      now.getTime() + DISCORD_UPDATE_LEASE_SECONDS * 1_000,
    );
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT evaluation."id"
        FROM "DiscordUpdateEvaluation" evaluation
        WHERE (
          (evaluation."status" = 'PENDING'::"DiscordUpdateWorkStatus" AND evaluation."nextAttemptAt" <= ${now})
          OR (evaluation."status" = 'PROCESSING'::"DiscordUpdateWorkStatus" AND evaluation."leaseExpiresAt" <= ${now})
        )
        AND NOT EXISTS (
          SELECT 1 FROM "DiscordUpdateEvaluation" prior
          WHERE prior."settingsId" = evaluation."settingsId"
            AND prior."gameId" = evaluation."gameId"
            AND prior."sourceRevision" < evaluation."sourceRevision"
            AND prior."status" IN ('PENDING'::"DiscordUpdateWorkStatus", 'PROCESSING'::"DiscordUpdateWorkStatus")
        )
        ORDER BY evaluation."nextAttemptAt", evaluation."sourceRevision", evaluation."createdAt"
        FOR UPDATE OF evaluation SKIP LOCKED
        LIMIT ${limit}
      `);
      if (!rows.length) return [];
      const ids = rows.map(({ id }) => id);
      await tx.discordUpdateEvaluation.updateMany({
        where: { id: { in: ids } },
        data: {
          status: DiscordUpdateWorkStatus.PROCESSING,
          leaseOwner: workerId,
          leaseExpiresAt,
        },
      });
      return tx.discordUpdateEvaluation.findMany({
        where: { id: { in: ids } },
        orderBy: [{ nextAttemptAt: "asc" }, { sourceRevision: "asc" }],
        include: evaluationInclude,
      });
    });
  }

  async failEvaluation(input: {
    evaluationId: string;
    workerId: string;
    completedAt: Date;
    failureCode: string;
    terminal: boolean;
    retryAfterSeconds?: number | null;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const evaluation = await tx.discordUpdateEvaluation.findFirst({
        where: {
          id: input.evaluationId,
          status: DiscordUpdateWorkStatus.PROCESSING,
          leaseOwner: input.workerId,
        },
      });
      if (!evaluation) return null;
      const attemptCount = evaluation.attemptCount + 1;
      const retryAt = input.terminal
        ? null
        : discordUpdateRetryAt(
            attemptCount,
            input.completedAt,
            input.retryAfterSeconds,
          );
      const deadLetter = input.terminal || retryAt === null;
      return tx.discordUpdateEvaluation.update({
        where: { id: evaluation.id },
        data: deadLetter
          ? {
              status: DiscordUpdateWorkStatus.DEAD_LETTER,
              attemptCount,
              deadLetteredAt: input.completedAt,
              lastFailureCode: input.failureCode,
              leaseOwner: null,
              leaseExpiresAt: null,
            }
          : {
              status: DiscordUpdateWorkStatus.PENDING,
              attemptCount,
              nextAttemptAt: retryAt!,
              lastFailureCode: input.failureCode,
              leaseOwner: null,
              leaseExpiresAt: null,
            },
      });
    });
  }

  async completeEvaluation(input: {
    evaluationId: string;
    workerId: string;
    completedAt: Date;
    snapshot: DiscordGameUpdateSnapshot;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const evaluation = await tx.discordUpdateEvaluation.findFirst({
        where: {
          id: input.evaluationId,
          status: DiscordUpdateWorkStatus.PROCESSING,
          leaseOwner: input.workerId,
        },
        include: evaluationInclude,
      });
      if (!evaluation) return null;
      const settings = evaluation.settings;
      const scoped = settings.trackedScopes.some(
        ({ teamSeasonId }) => teamSeasonId === evaluation.game.teamSeasonId,
      );
      if (
        !settings.enabled ||
        settings.revision !== evaluation.settingsRevision ||
        settings.installation.status !== "ACTIVE" ||
        !settings.triggers.includes(evaluation.trigger) ||
        !scoped
      ) {
        return tx.discordUpdateEvaluation.update({
          where: { id: evaluation.id },
          data: {
            status: DiscordUpdateWorkStatus.CANCELLED,
            cancelledAt: input.completedAt,
            lastFailureCode: "SETTINGS_OR_SCOPE_CHANGED",
            leaseOwner: null,
            leaseExpiresAt: null,
          },
        });
      }
      const purpose = discordDestinationPurposeForTrigger(evaluation.trigger);
      const destinations = new Map(
        settings.destinations
          .filter(
            (route) =>
              route.purpose === purpose &&
              route.destination.enabled &&
              route.destination.canView &&
              route.destination.canSend,
          )
          .map((route) => [route.destination.id, route.destination]),
      );
      for (const destination of destinations.values()) {
        const previous = await tx.discordUpdateDelivery.findFirst({
          where: {
            settingsId: settings.id,
            gameId: evaluation.gameId,
            destinationId: destination.id,
            status: DiscordUpdateWorkStatus.SUCCEEDED,
            providerMessageId: { not: null },
          },
          orderBy: [{ sourceRevision: "desc" }, { deliveredAt: "desc" }],
        });
        const plan = planDiscordGameUpdate({
          strategy: settings.messageStrategy,
          format: settings.messageFormat,
          triggers: settings.triggers,
          trigger: evaluation.trigger,
          snapshot: input.snapshot,
          hasPublishedMessage: previous !== null,
        });
        if (
          !plan.content ||
          ["IGNORE", "WAIT_FOR_FINAL"].includes(plan.operation)
        ) {
          continue;
        }
        const operation =
          plan.operation === "EDIT"
            ? "EDIT"
            : plan.operation === "APPEND" || plan.operation === "QUEUE_SUMMARY"
              ? previous
                ? "APPEND"
                : "CREATE"
              : "CREATE";
        await tx.discordUpdateDelivery.createMany({
          data: {
            accountId: evaluation.accountId,
            settingsId: settings.id,
            evaluationId: evaluation.id,
            gameId: evaluation.gameId,
            destinationId: destination.id,
            settingsRevision: evaluation.settingsRevision,
            sourceRevision: evaluation.sourceRevision,
            operation,
            messageFormat: settings.messageFormat,
            content: plan.content,
            targetProviderMessageId:
              operation === "EDIT" ? previous!.providerMessageId : null,
            retentionUntil: evaluation.retentionUntil,
            createdAt: input.completedAt,
            nextAttemptAt: input.completedAt,
          },
          skipDuplicates: true,
        });
      }
      const nextScheduledEvaluationAt = nextDiscordEvaluation({
        enabled: true,
        policy: storedSchedule(settings),
        quietHours: {
          enabled: settings.quietHoursEnabled,
          startMinute: settings.quietStartMinute,
          endMinute: settings.quietEndMinute,
          timeZone: settings.quietTimeZone,
        },
        now: input.completedAt,
        manualRefreshRequestedAt: null,
      });
      await tx.discordIntegrationSettings.updateMany({
        where: { id: settings.id, revision: settings.revision },
        data: {
          manualRefreshRequestedAt: null,
          nextScheduledEvaluationAt,
        },
      });
      return tx.discordUpdateEvaluation.update({
        where: { id: evaluation.id },
        data: {
          status: DiscordUpdateWorkStatus.SUCCEEDED,
          attemptCount: evaluation.attemptCount + 1,
          evaluatedAt: input.completedAt,
          lastFailureCode: null,
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
    });
  }

  async claimDeliveries(workerId: string, now: Date, limit: number) {
    const leaseExpiresAt = new Date(
      now.getTime() + DISCORD_UPDATE_LEASE_SECONDS * 1_000,
    );
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT delivery."id"
        FROM "DiscordUpdateDelivery" delivery
        WHERE (
          (delivery."status" = 'PENDING'::"DiscordUpdateWorkStatus" AND delivery."nextAttemptAt" <= ${now})
          OR (delivery."status" = 'PROCESSING'::"DiscordUpdateWorkStatus" AND delivery."leaseExpiresAt" <= ${now})
        )
        AND NOT EXISTS (
          SELECT 1 FROM "DiscordUpdateDelivery" prior
          WHERE prior."settingsId" = delivery."settingsId"
            AND prior."gameId" = delivery."gameId"
            AND prior."destinationId" = delivery."destinationId"
            AND prior."sourceRevision" < delivery."sourceRevision"
            AND prior."status" IN ('PENDING'::"DiscordUpdateWorkStatus", 'PROCESSING'::"DiscordUpdateWorkStatus")
        )
        ORDER BY delivery."nextAttemptAt", delivery."sourceRevision", delivery."createdAt"
        FOR UPDATE OF delivery SKIP LOCKED
        LIMIT ${limit}
      `);
      if (!rows.length) return [];
      const ids = rows.map(({ id }) => id);
      await tx.discordUpdateDelivery.updateMany({
        where: { id: { in: ids } },
        data: {
          status: DiscordUpdateWorkStatus.PROCESSING,
          leaseOwner: workerId,
          leaseExpiresAt,
        },
      });
      for (const id of ids) {
        const delivery = await tx.discordUpdateDelivery.findUniqueOrThrow({
          where: { id },
          include: {
            settings: { select: { messageStrategy: true } },
            evaluation: { select: { trigger: true } },
          },
        });
        const previous = await tx.discordUpdateDelivery.findFirst({
          where: {
            settingsId: delivery.settingsId,
            gameId: delivery.gameId,
            destinationId: delivery.destinationId,
            sourceRevision: { lt: delivery.sourceRevision },
            status: DiscordUpdateWorkStatus.SUCCEEDED,
            providerMessageId: { not: null },
          },
          orderBy: [{ sourceRevision: "desc" }, { deliveredAt: "desc" }],
          select: { providerMessageId: true },
        });
        if (previous?.providerMessageId) {
          const edit =
            delivery.settings.messageStrategy === "EDIT_LIVE_MESSAGE" ||
            (delivery.evaluation.trigger !== "GAME_CORRECTED" &&
              delivery.settings.messageStrategy === "FINAL_ONLY");
          await tx.discordUpdateDelivery.update({
            where: { id },
            data: edit
              ? {
                  operation: "EDIT",
                  targetProviderMessageId: previous.providerMessageId,
                }
              : { operation: "APPEND", targetProviderMessageId: null },
          });
        }
      }
      return tx.discordUpdateDelivery.findMany({
        where: { id: { in: ids } },
        orderBy: [{ nextAttemptAt: "asc" }, { sourceRevision: "asc" }],
        include: deliveryInclude,
      });
    });
  }

  async deliveryIsCurrent(deliveryId: string, workerId: string) {
    const delivery = await this.prisma.discordUpdateDelivery.findFirst({
      where: {
        id: deliveryId,
        status: DiscordUpdateWorkStatus.PROCESSING,
        leaseOwner: workerId,
        settings: {
          enabled: true,
          installation: { status: "ACTIVE" },
        },
        destination: { enabled: true, canView: true, canSend: true },
      },
      select: {
        settingsRevision: true,
        settings: { select: { revision: true } },
      },
    });
    return (
      delivery !== null &&
      delivery.settings.revision === delivery.settingsRevision
    );
  }

  async cancelDelivery(input: {
    deliveryId: string;
    workerId: string;
    completedAt: Date;
    failureCode: string;
  }) {
    return this.completeDeliveryAttempt({
      ...input,
      startedAt: input.completedAt,
      durationMs: 0,
      responseStatus: null,
      providerMessageId: null,
      succeeded: false,
      terminal: true,
      cancelled: true,
    });
  }

  async completeDeliveryAttempt(input: {
    deliveryId: string;
    workerId: string;
    startedAt: Date;
    completedAt: Date;
    durationMs: number;
    responseStatus: number | null;
    failureCode: string | null;
    providerMessageId: string | null;
    succeeded: boolean;
    terminal: boolean;
    cancelled?: boolean;
    retryAfterSeconds?: number | null;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const delivery = await tx.discordUpdateDelivery.findFirst({
        where: {
          id: input.deliveryId,
          status: DiscordUpdateWorkStatus.PROCESSING,
          leaseOwner: input.workerId,
        },
      });
      if (!delivery) return null;
      const attemptNumber = delivery.attemptCount + 1;
      const retryAt =
        input.succeeded || input.terminal
          ? null
          : discordUpdateRetryAt(
              attemptNumber,
              input.completedAt,
              input.retryAfterSeconds,
            );
      const deadLetter =
        !input.succeeded &&
        !input.cancelled &&
        (input.terminal || retryAt === null);
      await tx.discordUpdateDeliveryAttempt.create({
        data: {
          accountId: delivery.accountId,
          deliveryId: delivery.id,
          workerId: input.workerId,
          attemptNumber,
          outcome: input.succeeded
            ? DiscordUpdateAttemptOutcome.SUCCEEDED
            : input.cancelled
              ? DiscordUpdateAttemptOutcome.CANCELLED
              : deadLetter
                ? DiscordUpdateAttemptOutcome.TERMINAL_FAILURE
                : DiscordUpdateAttemptOutcome.RETRYABLE_FAILURE,
          responseStatus: input.responseStatus,
          failureCode: input.failureCode,
          durationMs: input.durationMs,
          startedAt: input.startedAt,
          completedAt: input.completedAt,
        },
      });
      const updated = await tx.discordUpdateDelivery.update({
        where: { id: delivery.id },
        data: input.succeeded
          ? {
              status: DiscordUpdateWorkStatus.SUCCEEDED,
              attemptCount: attemptNumber,
              deliveredAt: input.completedAt,
              providerMessageId: input.providerMessageId,
              lastFailureCode: null,
              leaseOwner: null,
              leaseExpiresAt: null,
            }
          : input.cancelled
            ? {
                status: DiscordUpdateWorkStatus.CANCELLED,
                attemptCount: attemptNumber,
                cancelledAt: input.completedAt,
                lastFailureCode: input.failureCode,
                leaseOwner: null,
                leaseExpiresAt: null,
              }
            : deadLetter
              ? {
                  status: DiscordUpdateWorkStatus.DEAD_LETTER,
                  attemptCount: attemptNumber,
                  deadLetteredAt: input.completedAt,
                  lastFailureCode: input.failureCode,
                  leaseOwner: null,
                  leaseExpiresAt: null,
                }
              : {
                  status: DiscordUpdateWorkStatus.PENDING,
                  attemptCount: attemptNumber,
                  nextAttemptAt: retryAt!,
                  lastFailureCode: input.failureCode,
                  leaseOwner: null,
                  leaseExpiresAt: null,
                },
      });
      if (input.succeeded) {
        await tx.discordIntegrationSettings.updateMany({
          where: {
            id: delivery.settingsId,
            revision: delivery.settingsRevision,
          },
          data: { lastSuccessfulUpdateAt: input.completedAt },
        });
      }
      return updated;
    });
  }

  async releaseEvaluationClaims(workerId: string, evaluationIds: string[]) {
    if (!evaluationIds.length) return 0;
    const result = await this.prisma.discordUpdateEvaluation.updateMany({
      where: {
        id: { in: evaluationIds },
        status: DiscordUpdateWorkStatus.PROCESSING,
        leaseOwner: workerId,
      },
      data: {
        status: DiscordUpdateWorkStatus.PENDING,
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
    return result.count;
  }

  async releaseDeliveryClaims(workerId: string, deliveryIds: string[]) {
    if (!deliveryIds.length) return 0;
    const result = await this.prisma.discordUpdateDelivery.updateMany({
      where: {
        id: { in: deliveryIds },
        status: DiscordUpdateWorkStatus.PROCESSING,
        leaseOwner: workerId,
      },
      data: {
        status: DiscordUpdateWorkStatus.PENDING,
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
    return result.count;
  }
}
