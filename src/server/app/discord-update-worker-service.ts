import { performance } from "node:perf_hooks";

import { z } from "zod";

import {
  DiscordUpdateProviderError,
  discordStatisticsSnapshotSchema,
  discordUpdateSignalSchema,
  discordWorkerIdSchema,
  type DiscordStatisticsProvider,
  type DiscordUpdateTransport,
} from "@/domain/discord-update-worker";
import {
  PrismaDiscordUpdateRepository,
  type ClaimedDiscordDelivery,
} from "@/server/data/discord-update-repository";
import { getPrismaClient } from "@/server/data/prisma";
import {
  emitOperationalEvent,
  getOperationalEventSink,
  type OperationalEventSink,
} from "@/server/observability/operational-events";
import {
  ConfiguredDiscordStatisticsProvider,
  ConfiguredDiscordUpdateTransport,
} from "@/server/providers/discord-updates";

const batchSizeSchema = z.number().int().min(1).max(100);

type Clock = () => Date;

const systemClock: Clock = () => new Date();

type DiscordUpdateRepository = Pick<
  PrismaDiscordUpdateRepository,
  | "enqueueDueSchedules"
  | "enqueueSignal"
  | "claimEvaluations"
  | "failEvaluation"
  | "completeEvaluation"
  | "releaseEvaluationClaims"
  | "claimDeliveries"
  | "deliveryIsCurrent"
  | "cancelDelivery"
  | "completeDeliveryAttempt"
  | "releaseDeliveryClaims"
>;

type DiscordUpdatePublicationRepository = Pick<
  PrismaDiscordUpdateRepository,
  "enqueueSignal"
>;

export class DiscordUpdateWorkerError extends Error {
  constructor(
    readonly code: "INVALID_REQUEST" | "CONFIGURATION_ERROR",
    readonly status: 400 | 500,
    message: string,
  ) {
    super(message);
    this.name = "DiscordUpdateWorkerError";
  }
}

export class DiscordUpdatePublicationService {
  constructor(
    private readonly repository: DiscordUpdatePublicationRepository,
  ) {}

  async publish(input: unknown) {
    const parsed = discordUpdateSignalSchema.parse(input);
    return this.repository.enqueueSignal({
      accountId: parsed.accountId,
      gameExternalId: parsed.gameId,
      trigger: parsed.trigger,
      sourceRevision: parsed.sourceRevision,
      occurredAt: parsed.occurredAt ? new Date(parsed.occurredAt) : new Date(),
    });
  }
}

function providerFailure(error: unknown) {
  return error instanceof DiscordUpdateProviderError
    ? error
    : new DiscordUpdateProviderError("PROVIDER_UNAVAILABLE", true);
}

function outcome(status: string | undefined, succeeded: boolean) {
  if (succeeded) return "succeeded" as const;
  if (status === "DEAD_LETTER") return "dead_letter" as const;
  if (status === "CANCELLED") return "cancelled" as const;
  return "retry" as const;
}

export class DiscordUpdateWorkerService {
  constructor(
    private readonly repository: DiscordUpdateRepository,
    private readonly statistics: DiscordStatisticsProvider,
    private readonly transport: DiscordUpdateTransport,
    private readonly events: OperationalEventSink = getOperationalEventSink(),
    private readonly clock: Clock = systemClock,
  ) {}

  async evaluateBatch(
    workerIdInput: string,
    options: { now?: Date; limit?: number; signal?: AbortSignal } = {},
  ) {
    const workerId = discordWorkerIdSchema.parse(workerIdInput);
    const limit = batchSizeSchema.parse(options.limit ?? 25);
    const now = options.now ?? this.clock();
    await this.repository.enqueueDueSchedules(now, limit);
    const claimed = await this.repository.claimEvaluations(
      workerId,
      now,
      limit,
    );
    const results: Array<{
      evaluationId: string;
      outcome: "succeeded" | "retry" | "dead_letter" | "cancelled";
    }> = [];

    for (let index = 0; index < claimed.length; index += 1) {
      const evaluation = claimed[index]!;
      if (options.signal?.aborted) {
        await this.repository.releaseEvaluationClaims(
          workerId,
          claimed.slice(index).map(({ id }) => id),
        );
        break;
      }
      const started = performance.now();
      let failureCode: string | null = null;
      let succeeded = false;
      let terminal = false;
      let retryAfterSeconds: number | null = null;
      let status: string | undefined;
      try {
        const snapshot = discordStatisticsSnapshotSchema.parse(
          await this.statistics.loadGame({
            accountId: evaluation.account.externalId,
            gameId: evaluation.game.externalId,
            settingsRevision: evaluation.settingsRevision,
          }),
        );
        if (
          snapshot.freshness !== "CURRENT" ||
          snapshot.sourceRevision < evaluation.sourceRevision
        ) {
          throw new DiscordUpdateProviderError("STATISTICS_STALE", true);
        }
        const contentSnapshot = {
          awayTeam: snapshot.awayTeam,
          homeTeam: snapshot.homeTeam,
          awayScore: snapshot.awayScore,
          homeScore: snapshot.homeScore,
          inning: snapshot.inning,
          half: snapshot.half,
          latestEvent: snapshot.latestEvent,
          correctionSummary: snapshot.correctionSummary,
          reportReady: snapshot.reportReady,
          verified: snapshot.verified,
        };
        const result = await this.repository.completeEvaluation({
          evaluationId: evaluation.id,
          workerId,
          completedAt: this.clock(),
          snapshot: contentSnapshot,
        });
        status = result?.status;
        succeeded = result?.status === "SUCCEEDED";
      } catch (error) {
        const failure = providerFailure(error);
        failureCode = failure.code;
        terminal = !failure.retryable;
        retryAfterSeconds = failure.retryAfterSeconds;
        const result = await this.repository.failEvaluation({
          evaluationId: evaluation.id,
          workerId,
          completedAt: this.clock(),
          failureCode,
          terminal,
          retryAfterSeconds,
        });
        status = result?.status;
      }
      const evaluatedOutcome = outcome(status, succeeded);
      emitOperationalEvent(this.events, {
        severity: status === "DEAD_LETTER" ? "warning" : "info",
        category: "background_job",
        name: "discord_update_evaluation",
        outcome: succeeded
          ? "succeeded"
          : status === "CANCELLED"
            ? "rejected"
            : status === "DEAD_LETTER"
              ? "failed"
              : "degraded",
        accountId: evaluation.accountId,
        ...(failureCode ? { code: failureCode } : {}),
        durationMs: Math.max(0, Math.round(performance.now() - started)),
        metadata: {
          trigger: evaluation.trigger,
          sourceRevision: evaluation.sourceRevision,
          settingsRevision: evaluation.settingsRevision,
          attemptNumber: evaluation.attemptCount + 1,
        },
      });
      results.push({ evaluationId: evaluation.id, outcome: evaluatedOutcome });
    }
    return results;
  }

  async deliverBatch(
    workerIdInput: string,
    options: { now?: Date; limit?: number; signal?: AbortSignal } = {},
  ) {
    const workerId = discordWorkerIdSchema.parse(workerIdInput);
    const limit = batchSizeSchema.parse(options.limit ?? 25);
    const now = options.now ?? this.clock();
    const claimed = await this.repository.claimDeliveries(workerId, now, limit);
    const results: Array<{
      deliveryId: string;
      outcome: "succeeded" | "retry" | "dead_letter" | "cancelled";
    }> = [];

    for (let index = 0; index < claimed.length; index += 1) {
      const delivery = claimed[index]!;
      if (options.signal?.aborted) {
        await this.repository.releaseDeliveryClaims(
          workerId,
          claimed.slice(index).map(({ id }) => id),
        );
        break;
      }
      if (!(await this.repository.deliveryIsCurrent(delivery.id, workerId))) {
        const cancelled = await this.repository.cancelDelivery({
          deliveryId: delivery.id,
          workerId,
          completedAt: this.clock(),
          failureCode: "SETTINGS_OR_DESTINATION_CHANGED",
        });
        results.push({
          deliveryId: delivery.id,
          outcome: outcome(cancelled?.status, false),
        });
        this.emitDelivery(delivery, "cancelled", 0, null);
        continue;
      }

      const startedAt = this.clock();
      const started = performance.now();
      let responseStatus: number | null = null;
      let providerMessageId: string | null = null;
      let failureCode: string | null = null;
      let succeeded = false;
      let terminal = false;
      let retryAfterSeconds: number | null = null;
      try {
        const response = await this.transport.send({
          operation: delivery.operation,
          channelId: delivery.destination.channelId,
          targetMessageId: delivery.targetProviderMessageId,
          idempotencyKey: delivery.externalId,
          content: delivery.content,
          format: delivery.messageFormat,
          timeoutMs: 10_000,
        });
        responseStatus = response.status;
        providerMessageId = response.messageId;
        succeeded = true;
      } catch (error) {
        const failure = providerFailure(error);
        failureCode = failure.code;
        responseStatus = failure.responseStatus;
        terminal = !failure.retryable;
        retryAfterSeconds = failure.retryAfterSeconds;
      }
      const completedAt = this.clock();
      const durationMs = Math.max(0, Math.round(performance.now() - started));
      const result = await this.repository.completeDeliveryAttempt({
        deliveryId: delivery.id,
        workerId,
        startedAt,
        completedAt,
        durationMs,
        responseStatus,
        failureCode,
        providerMessageId,
        succeeded,
        terminal,
        retryAfterSeconds,
      });
      const deliveryOutcome = outcome(result?.status, succeeded);
      this.emitDelivery(delivery, deliveryOutcome, durationMs, failureCode);
      results.push({ deliveryId: delivery.id, outcome: deliveryOutcome });
    }
    return results;
  }

  private emitDelivery(
    delivery: ClaimedDiscordDelivery,
    deliveryOutcome: "succeeded" | "retry" | "dead_letter" | "cancelled",
    durationMs: number,
    failureCode: string | null,
  ) {
    emitOperationalEvent(this.events, {
      severity: deliveryOutcome === "dead_letter" ? "warning" : "info",
      category: "background_job",
      name: "discord_update_delivery",
      outcome:
        deliveryOutcome === "succeeded"
          ? "succeeded"
          : deliveryOutcome === "dead_letter"
            ? "failed"
            : deliveryOutcome === "cancelled"
              ? "rejected"
              : "degraded",
      accountId: delivery.accountId,
      ...(failureCode ? { code: failureCode } : {}),
      durationMs,
      metadata: {
        operation: delivery.operation,
        sourceRevision: delivery.sourceRevision,
        settingsRevision: delivery.settingsRevision,
        attemptNumber: delivery.attemptCount + 1,
      },
    });
  }
}

function requiredEnvironment(name: string, minimumLength: number) {
  const value = process.env[name]?.trim();
  if (!value || value.length < minimumLength) {
    throw new DiscordUpdateWorkerError(
      "CONFIGURATION_ERROR",
      500,
      `${name} is unavailable.`,
    );
  }
  return value;
}

export function getDiscordUpdateWorkerService() {
  return new DiscordUpdateWorkerService(
    new PrismaDiscordUpdateRepository(getPrismaClient()),
    new ConfiguredDiscordStatisticsProvider(
      requiredEnvironment("DISCORD_STATISTICS_API_BASE_URL", 12),
      requiredEnvironment("DISCORD_STATISTICS_API_TOKEN", 32),
    ),
    new ConfiguredDiscordUpdateTransport(
      process.env.DISCORD_UPDATE_API_BASE_URL ?? "https://discord.com/api/v10/",
      requiredEnvironment("DISCORD_UPDATE_BOT_TOKEN", 16),
    ),
  );
}

export function getDiscordUpdatePublicationService() {
  return new DiscordUpdatePublicationService(
    new PrismaDiscordUpdateRepository(getPrismaClient()),
  );
}
