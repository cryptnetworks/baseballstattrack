import { z } from "zod";

import { parseEventBody } from "@/domain/events/event-log";
import {
  PRODUCT_ANALYTICS_SCHEMA_VERSION,
  analyticsDurationBucket,
  classifyScoringAnalyticsError,
  scoringEventFamily,
} from "@/domain/product-analytics";
import { rateLimitFingerprint } from "@/domain/rate-limits";
import {
  getRateLimitService,
  noRateLimit,
  type RateLimitEnforcer,
} from "@/server/app/rate-limit-service";
import {
  ProductAnalyticsService,
  getProductAnalyticsService,
} from "@/server/app/product-analytics-service";
import {
  type AcceptEventCommand,
  PrismaGameEventRepository,
  type ValidatedActorContext,
} from "@/server/data/game-event-repository";
import { getPrismaClient } from "@/server/data/prisma";
import { AuthorizationError } from "@/server/auth/errors";
import {
  requireTrustedActor,
  type TrustedActorContext,
} from "@/server/auth/types";
import {
  emitOperationalEvent,
  getOperationalEventSink,
  safeOperationalErrorCode,
  type OperationalEventSink,
} from "@/server/observability/operational-events";

export type EventAcceptanceInput = Omit<
  AcceptEventCommand,
  "actor" | "body"
> & {
  body: unknown;
};

const id = z.string().trim().min(1).max(128);
const eventAcceptanceSchema = z
  .object({
    accountId: id,
    gameId: id,
    setupSnapshotId: id,
    expectedRevision: z.int().nonnegative(),
    eventId: id,
    playTransactionId: id,
    clientSubmissionId: id,
    recordedAt: z.iso.datetime(),
    body: z.unknown(),
  })
  .strict();

function capabilityForEvent(
  eventType: string,
  actor: TrustedActorContext,
): Exclude<ValidatedActorContext["capability"], "game.correct"> {
  if (eventType === "GameVerified") {
    return actor.capability === "game.reverify"
      ? "game.reverify"
      : "game.verify";
  }
  if (eventType === "GameStarted") return "game.start";
  if (eventType === "GameReopened") return "game.reopen";
  return "game.score";
}

function requireGameTarget(
  actor: TrustedActorContext,
  accountId: string,
  gameId: string,
  capability:
    Exclude<ValidatedActorContext["capability"], "game.correct"> | "game.view",
) {
  const trusted = requireTrustedActor(actor, accountId, capability);
  if (trusted.target.kind !== "GAME" || trusted.target.gameId !== gameId) {
    throw new AuthorizationError("AUTHORIZATION_REQUIRED");
  }
  return trusted;
}

export class GameEventService {
  constructor(
    private readonly repository: PrismaGameEventRepository,
    private readonly operationalEvents: OperationalEventSink = getOperationalEventSink(),
    private readonly rateLimits: RateLimitEnforcer = noRateLimit,
    private readonly productAnalytics: Pick<
      ProductAnalyticsService,
      "emitForUser"
    > = { emitForUser: async () => false },
  ) {}

  async accept(input: EventAcceptanceInput, actor: TrustedActorContext) {
    const startedAt = performance.now();
    let analyticsContext:
      | Readonly<{
          appUserId: string;
          eventFamily: ReturnType<typeof scoringEventFamily>;
        }>
      | undefined;
    try {
      const command = eventAcceptanceSchema.parse(input);
      const body = parseEventBody(command.body);
      const capability = capabilityForEvent(body.eventType, actor);
      const trusted = requireGameTarget(
        actor,
        command.accountId,
        command.gameId,
        capability,
      );
      if (trusted.actorKind === "USER") {
        analyticsContext = {
          appUserId: trusted.appUserId,
          eventFamily: scoringEventFamily(body.eventType),
        };
      }
      await this.rateLimits.enforce(
        {
          accountId: command.accountId,
          endpointClass:
            capability === "game.verify" || capability === "game.reverify"
              ? "CORRECTION_VERIFICATION"
              : "SCORING_MUTATION",
          operationKey: command.clientSubmissionId,
          fingerprint: rateLimitFingerprint(
            command.gameId,
            command.setupSnapshotId,
            command.expectedRevision,
            command.eventId,
            command.playTransactionId,
            command.body,
          ),
        },
        trusted,
      );
      const result = await this.repository.accept({
        ...command,
        body,
        actor: {
          accountId: trusted.accountId,
          actorId: trusted.actorId,
          actorKind: trusted.actorKind,
          actorUserId: trusted.actorUserId,
          capability,
          scope: { kind: "GAME", gameId: command.gameId },
          authorizedAt: trusted.authorizedAt,
        },
      });
      emitOperationalEvent(this.operationalEvents, {
        severity: "info",
        category: "scoring",
        name: "event_acceptance",
        outcome: "succeeded",
        accountId: command.accountId,
        capability,
        targetType: "GAME",
        durationMs: Math.round((performance.now() - startedAt) * 1000) / 1000,
        metadata: { eventType: body.eventType },
      });
      if (analyticsContext) {
        await this.productAnalytics.emitForUser(analyticsContext.appUserId, {
          schemaVersion: PRODUCT_ANALYTICS_SCHEMA_VERSION,
          name: "scoring.submission_succeeded",
          workflow: "LIVE_SCORING",
          result: "SUCCEEDED",
          eventFamily: analyticsContext.eventFamily,
          durationBucket: analyticsDurationBucket(
            performance.now() - startedAt,
          ),
          failureCategory: null,
        });
      }
      return result;
    } catch (error) {
      emitOperationalEvent(this.operationalEvents, {
        severity: error instanceof AuthorizationError ? "info" : "warning",
        category:
          error instanceof AuthorizationError ? "authorization" : "scoring",
        name: "event_acceptance",
        outcome: error instanceof AuthorizationError ? "rejected" : "failed",
        ...(typeof input.accountId === "string"
          ? { accountId: input.accountId }
          : {}),
        targetType: "GAME",
        code: safeOperationalErrorCode(error),
        durationMs: Math.round((performance.now() - startedAt) * 1000) / 1000,
      });
      if (analyticsContext) {
        const classification = classifyScoringAnalyticsError(error);
        await this.productAnalytics.emitForUser(analyticsContext.appUserId, {
          schemaVersion: PRODUCT_ANALYTICS_SCHEMA_VERSION,
          ...classification,
          workflow: "LIVE_SCORING",
          eventFamily: analyticsContext.eventFamily,
          durationBucket: analyticsDurationBucket(
            performance.now() - startedAt,
          ),
        });
      }
      throw error;
    }
  }

  async loadAcceptedHistory(
    accountId: string,
    gameId: string,
    setupSnapshotId: string,
    actor: TrustedActorContext,
  ) {
    requireGameTarget(actor, accountId, gameId, "game.view");
    return this.repository.loadAcceptedHistory(
      accountId,
      gameId,
      setupSnapshotId,
    );
  }

  async replay(
    accountId: string,
    gameId: string,
    setupSnapshotId: string,
    actor: TrustedActorContext,
  ) {
    requireGameTarget(actor, accountId, gameId, "game.view");
    return this.repository.replay(accountId, gameId, setupSnapshotId);
  }
}

export function getGameEventService() {
  return new GameEventService(
    new PrismaGameEventRepository(getPrismaClient()),
    getOperationalEventSink(),
    getRateLimitService(),
    getProductAnalyticsService(),
  );
}
