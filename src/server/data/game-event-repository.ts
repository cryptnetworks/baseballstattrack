import { createHash } from "node:crypto";

import {
  ActorKind,
  AuditOutcome,
  AuditScope,
  Prisma,
  ProjectionScope,
  ProjectionStatus,
  type PrismaClient,
  type SourceEvent,
} from "@prisma/client";

import type {
  CorrectionActorContext,
  CorrectionWorkflowResult,
  SafeCorrectionAudit,
} from "@/domain/corrections/correction-audit-replay";
import {
  EVENT_SCHEMA_VERSION,
  GameEventError,
  REDUCER_VERSION,
  canonicalJson,
  deriveEventStates,
  parseEvent,
  parseEventBody,
  replayGame,
  stateHash,
  type AcceptedEvent,
  type AcceptedSetup,
  type EventBody,
} from "@/domain/events/event-log";
import {
  STATISTIC_DERIVATION_VERSION,
  STATISTIC_RULES_VERSION,
  deriveGameStatistics,
} from "@/domain/statistics";

export type ValidatedActorContext = {
  accountId: string;
  actorId: string;
  actorKind: "USER" | "SERVICE" | "SYSTEM";
  actorUserId: string | null;
  capability:
    | "game.score"
    | "game.correct"
    | "game.reopen"
    | "game.verify"
    | "game.reverify";
  scope: { kind: "GAME"; gameId: string };
  authorizedAt: string;
};

export type AcceptEventCommand = {
  accountId: string;
  gameId: string;
  setupSnapshotId: string;
  expectedRevision: number;
  eventId: string;
  playTransactionId: string;
  clientSubmissionId: string;
  recordedAt: string;
  actor: ValidatedActorContext;
  body: EventBody;
};

export type AcceptedEventResult = {
  event: AcceptedEvent;
  idempotentReplay: boolean;
};

export type AcceptedGameHistory = {
  setup: AcceptedSetup;
  events: AcceptedEvent[];
};

export type CorrectionAcceptanceContext = {
  correlationId: string;
  membershipId: string | null;
};

const payloadDigest = (
  setupSnapshotId: string,
  expectedRevision: number,
  body: EventBody,
): string =>
  createHash("sha256")
    .update(canonicalJson({ setupSnapshotId, expectedRevision, body }))
    .digest("hex");

function toActorKind(kind: ValidatedActorContext["actorKind"]): ActorKind {
  return ActorKind[kind];
}

function verificationImpact(
  history: readonly AcceptedEvent[],
  statusBeforeCorrection: string,
): SafeCorrectionAudit["verificationImpact"] {
  if (statusBeforeCorrection === "IN_PROGRESS") {
    return "UNCHANGED_UNVERIFIED";
  }
  return history.some(({ eventType }) => eventType === "GameVerified")
    ? "INVALIDATED_REQUIRES_REVERIFICATION"
    : "REQUIRES_VERIFICATION";
}

function mapSourceEvent(
  row: SourceEvent & { playTransaction: { acceptedAt: Date } | null },
  setupRevision: number,
): AcceptedEvent {
  return parseEvent({
    id: row.id,
    accountId: row.accountId,
    gameId: row.gameId,
    setupSnapshotId: row.setupSnapshotId,
    setupRevision,
    sequence: row.sequence,
    schemaVersion: row.schemaVersion,
    rulesetVersionId: row.rulesetVersionId,
    playTransactionId: row.playTransactionId,
    componentOrder: row.componentOrder,
    clientSubmissionId: row.clientSubmissionId,
    expectedRevision: row.expectedRevision,
    acceptedRevision: row.acceptedRevision,
    actor: {
      kind: row.actorKind,
      id: row.actorId,
      userId: row.actorUserId,
    },
    recordedAt: row.recordedAt.toISOString(),
    acceptedAt: (
      row.playTransaction?.acceptedAt ?? row.recordedAt
    ).toISOString(),
    eventType: row.eventType,
    payload: row.payload,
    preStateHash: row.preStateHash,
    postStateHash: row.postStateHash,
  });
}

async function loadSetup(
  tx: Prisma.TransactionClient,
  accountId: string,
  gameId: string,
  setupSnapshotId: string,
): Promise<AcceptedSetup> {
  const snapshot = await tx.gameSetupSnapshot.findUnique({
    where: {
      accountId_gameId_id: { accountId, gameId, id: setupSnapshotId },
    },
    include: {
      teamSnapshots: { orderBy: [{ side: "asc" }, { id: "asc" }] },
      lineupSlots: {
        orderBy: [{ battingOrder: "asc" }, { id: "asc" }],
      },
    },
  });
  if (!snapshot) {
    throw new GameEventError(
      "SETUP_NOT_READY",
      "Accepted setup is unavailable.",
    );
  }

  const side = (name: "HOME" | "AWAY") => {
    const team = snapshot.teamSnapshots.find(
      (candidate) => candidate.side === name,
    );
    if (!team) {
      throw new GameEventError(
        "SETUP_NOT_READY",
        "Accepted setup is incomplete.",
      );
    }
    const slots = snapshot.lineupSlots.filter(
      (candidate) => candidate.gameTeamSnapshotId === team.id,
    );
    const pitchers = slots.filter((candidate) => candidate.isStartingPitcher);
    const pitcher = pitchers[0];
    if (pitchers.length !== 1 || !pitcher) {
      throw new GameEventError(
        "INVALID_PITCHER",
        "Starting pitcher is missing.",
      );
    }
    return {
      startingPitcherId: pitcher.playerId ?? pitcher.id,
      lineup: slots.map((slot) => ({
        playerId: slot.playerId ?? slot.id,
        battingOrder: slot.battingOrder,
        position: slot.defensivePosition,
        active:
          slot.battingOrder !== null ||
          slot.defensivePosition !== null ||
          slot.isStartingPitcher,
      })),
    };
  };

  return {
    id: snapshot.id,
    accountId,
    gameId,
    setupRevision: snapshot.setupRevision,
    rulesetVersionId: snapshot.rulesetVersionId,
    scheduledInnings: snapshot.scheduledInnings,
    status: "READY",
    sides: { HOME: side("HOME"), AWAY: side("AWAY") },
  };
}

async function loadAcceptedHistory(
  tx: Prisma.TransactionClient,
  accountId: string,
  gameId: string,
  setupSnapshotId: string,
): Promise<AcceptedGameHistory> {
  const setup = await loadSetup(tx, accountId, gameId, setupSnapshotId);
  const [rows, correctionRows] = await Promise.all([
    tx.sourceEvent.findMany({
      where: { accountId, gameId, setupSnapshotId },
      orderBy: { sequence: "asc" },
      include: { playTransaction: { select: { acceptedAt: true } } },
    }),
    tx.eventCorrection.findMany({
      where: { accountId, gameId },
      orderBy: [{ correctionEventId: "asc" }, { targetEventId: "asc" }],
    }),
  ]);
  const events = rows.map((row) => mapSourceEvent(row, setup.setupRevision));
  const correctionEvents = events.filter(
    ({ eventType }) => eventType === "CorrectionApplied",
  );
  for (const event of correctionEvents) {
    const body = parseEventBody({
      eventType: event.eventType,
      payload: event.payload,
    });
    if (body.eventType !== "CorrectionApplied") continue;
    const persisted = correctionRows.filter(
      ({ correctionEventId }) => correctionEventId === event.id,
    );
    if (
      persisted.length !== body.payload.targetEventIds.length ||
      persisted.some(
        ({ policy, replacementEventId, replacementPayloadId, targetEventId }) =>
          policy !== body.payload.policy ||
          replacementEventId !== null ||
          replacementPayloadId !==
            (body.payload.replacements.find(
              (replacement) => replacement.targetEventId === targetEventId,
            )?.id ?? null) ||
          !body.payload.targetEventIds.includes(targetEventId),
      )
    ) {
      throw new GameEventError(
        "IMMUTABLE_HISTORY_VIOLATION",
        "Persisted correction relationships do not match the event.",
      );
    }
  }
  if (
    correctionRows.some(
      ({ correctionEventId }) =>
        !correctionEvents.some(({ id }) => id === correctionEventId),
    )
  ) {
    throw new GameEventError(
      "IMMUTABLE_HISTORY_VIOLATION",
      "Persisted correction relationship has no source event.",
    );
  }
  return { setup, events };
}

export class PrismaGameEventRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async loadAcceptedHistory(
    accountId: string,
    gameId: string,
    setupSnapshotId: string,
  ): Promise<AcceptedGameHistory> {
    return this.prisma.$transaction(async (tx) => {
      const history = await loadAcceptedHistory(
        tx,
        accountId,
        gameId,
        setupSnapshotId,
      );
      replayGame(history.setup, history.events, { verifyEvidence: true });
      return history;
    });
  }

  async replay(accountId: string, gameId: string, setupSnapshotId: string) {
    return this.prisma.$transaction(async (tx) => {
      const { setup, events } = await loadAcceptedHistory(
        tx,
        accountId,
        gameId,
        setupSnapshotId,
      );
      return replayGame(setup, events, { verifyEvidence: true });
    });
  }

  async accept(command: AcceptEventCommand): Promise<AcceptedEventResult> {
    return this.acceptInternal(command, null);
  }

  async acceptCorrection(
    command: AcceptEventCommand,
    context: CorrectionAcceptanceContext,
    actor: CorrectionActorContext,
  ): Promise<CorrectionWorkflowResult> {
    if (
      command.body.eventType !== "CorrectionApplied" ||
      actor.accountId !== command.accountId ||
      actor.actorId !== command.actor.actorId ||
      actor.actorKind !== command.actor.actorKind ||
      actor.actorUserId !== command.actor.actorUserId ||
      actor.scope.gameId !== command.gameId ||
      actor.capability !== "game.correct"
    ) {
      throw new GameEventError(
        "ACCOUNT_MISMATCH",
        "Correction actor or command boundary is inconsistent.",
      );
    }
    const accepted = await this.acceptInternal(command, {
      ...context,
      actor,
    });
    return this.loadCorrectionResult(
      command.accountId,
      command.gameId,
      command.setupSnapshotId,
      accepted.event.id,
      context.correlationId,
      accepted.idempotentReplay,
    );
  }

  private async acceptInternal(
    command: AcceptEventCommand,
    correction:
      (CorrectionAcceptanceContext & { actor: CorrectionActorContext }) | null,
  ): Promise<AcceptedEventResult> {
    if (
      command.actor.accountId !== command.accountId ||
      command.actor.scope.kind !== "GAME" ||
      command.actor.scope.gameId !== command.gameId
    ) {
      throw new GameEventError(
        "ACCOUNT_MISMATCH",
        "Validated actor scope does not match the command.",
      );
    }
    if (
      (command.actor.actorKind === "USER" &&
        command.actor.actorUserId === null) ||
      (command.actor.actorKind !== "USER" && command.actor.actorUserId !== null)
    ) {
      throw new GameEventError(
        "INVALID_PAYLOAD",
        "Validated actor identity is inconsistent.",
      );
    }
    const body = parseEventBody(command.body);
    const permittedCapability =
      body.eventType === "GameVerified"
        ? command.actor.capability === "game.verify" ||
          command.actor.capability === "game.reverify"
        : body.eventType === "CorrectionApplied"
          ? command.actor.capability === "game.correct"
          : body.eventType === "GameReopened"
            ? command.actor.capability === "game.reopen"
            : command.actor.capability === "game.score";
    if (!permittedCapability) {
      throw new GameEventError(
        "INVALID_LIFECYCLE_TRANSITION",
        "Validated actor capability does not permit this event.",
      );
    }
    const recordedAt = new Date(command.recordedAt);
    const authorizedAt = new Date(command.actor.authorizedAt);
    if (
      Number.isNaN(recordedAt.valueOf()) ||
      Number.isNaN(authorizedAt.valueOf())
    ) {
      throw new GameEventError(
        "INVALID_PAYLOAD",
        "Event or actor timestamp is invalid.",
      );
    }
    const digest = payloadDigest(
      command.setupSnapshotId,
      command.expectedRevision,
      body,
    );

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const prior = await tx.playTransaction.findUnique({
            where: {
              accountId_gameId_actorId_clientSubmissionId: {
                accountId: command.accountId,
                gameId: command.gameId,
                actorId: command.actor.actorId,
                clientSubmissionId: command.clientSubmissionId,
              },
            },
            include: {
              sourceEvents: {
                include: {
                  playTransaction: { select: { acceptedAt: true } },
                },
              },
            },
          });
          if (prior) {
            if (prior.payloadHash !== digest) {
              throw new GameEventError(
                "DUPLICATE_IDEMPOTENCY_KEY",
                "Idempotency key was already used for different input.",
              );
            }
            const setup = await loadSetup(
              tx,
              command.accountId,
              command.gameId,
              prior.setupSnapshotId,
            );
            const event = prior.sourceEvents[0];
            if (!event) {
              throw new GameEventError(
                "INTERNAL_INVARIANT_FAILURE",
                "Accepted transaction has no source event.",
              );
            }
            if (correction) {
              const priorAudit = await tx.securityAuditRecord.findFirst({
                where: {
                  accountId: command.accountId,
                  action: "game.correction.apply",
                  targetType: "Correction",
                  targetId: event.id,
                  outcome: AuditOutcome.SUCCEEDED,
                },
              });
              if (!priorAudit) {
                throw new GameEventError(
                  "INTERNAL_INVARIANT_FAILURE",
                  "Accepted correction has no durable audit evidence.",
                );
              }
              if (priorAudit.correlationId !== correction.correlationId) {
                throw new GameEventError(
                  "DUPLICATE_IDEMPOTENCY_KEY",
                  "Idempotency key was already used with another correlation.",
                );
              }
            }
            return {
              event: mapSourceEvent(event, setup.setupRevision),
              idempotentReplay: true,
            };
          }

          const game = await tx.game.findUnique({
            where: {
              accountId_id: {
                accountId: command.accountId,
                id: command.gameId,
              },
            },
          });
          if (!game) {
            throw new GameEventError("GAME_MISMATCH", "Game is unavailable.");
          }
          if (game.revision !== command.expectedRevision) {
            throw new GameEventError(
              "STALE_SOURCE_REVISION",
              "Expected source revision is stale.",
            );
          }
          if (game.readySetupSnapshotId !== command.setupSnapshotId) {
            throw new GameEventError(
              "SETUP_NOT_READY",
              "Event must reference the exact current ready setup.",
            );
          }

          const setup = await loadSetup(
            tx,
            command.accountId,
            command.gameId,
            command.setupSnapshotId,
          );
          if (setup.setupRevision !== game.setupRevision) {
            throw new GameEventError(
              "IMMUTABLE_HISTORY_VIOLATION",
              "Ready setup pointer disagrees with the game setup revision.",
            );
          }
          const stored = await tx.sourceEvent.findMany({
            where: {
              accountId: command.accountId,
              gameId: command.gameId,
              setupSnapshotId: command.setupSnapshotId,
            },
            orderBy: { sequence: "asc" },
            include: { playTransaction: { select: { acceptedAt: true } } },
          });
          const history = stored.map((row) =>
            mapSourceEvent(row, setup.setupRevision),
          );
          const current = replayGame(setup, history, {
            verifyEvidence: true,
          }).state;
          if (
            body.eventType === "GameVerified" &&
            command.actor.capability !==
              (history.some(({ eventType }) => eventType === "GameVerified")
                ? "game.reverify"
                : "game.verify")
          ) {
            throw new GameEventError(
              "INVALID_LIFECYCLE_TRANSITION",
              "Validated actor capability does not permit this verification.",
            );
          }
          if (
            current.sourceRevision !== game.revision ||
            current.status !== game.status
          ) {
            throw new GameEventError(
              "IMMUTABLE_HISTORY_VIOLATION",
              "Game checkpoint disagrees with accepted history.",
            );
          }
          const sequence = current.lastSequence + 1;
          const acceptedRevision = command.expectedRevision + 1;
          const timestampRows = await tx.$queryRaw<Array<{ acceptedAt: Date }>>(
            Prisma.sql`SELECT transaction_timestamp() AS "acceptedAt"`,
          );
          const acceptedAt = timestampRows[0]?.acceptedAt;
          if (!acceptedAt) {
            throw new GameEventError(
              "INTERNAL_INVARIANT_FAILURE",
              "Database acceptance time is unavailable.",
            );
          }
          const partial = {
            id: command.eventId,
            accountId: command.accountId,
            gameId: command.gameId,
            setupSnapshotId: command.setupSnapshotId,
            setupRevision: setup.setupRevision,
            sequence,
            schemaVersion: EVENT_SCHEMA_VERSION,
            rulesetVersionId: setup.rulesetVersionId,
            playTransactionId: command.playTransactionId,
            componentOrder: 0,
            clientSubmissionId: command.clientSubmissionId,
            expectedRevision: command.expectedRevision,
            acceptedRevision,
            actor: {
              kind: command.actor.actorKind,
              id: command.actor.actorId,
              userId: command.actor.actorUserId,
            },
            recordedAt: command.recordedAt,
            acceptedAt: acceptedAt.toISOString(),
            ...body,
            preStateHash: stateHash(current),
            postStateHash: `sha256:v1:${"0".repeat(64)}`,
          } satisfies AcceptedEvent;
          const { before, after } = deriveEventStates(setup, history, partial);
          const event = {
            ...partial,
            preStateHash: stateHash(before),
            postStateHash: stateHash(after),
          };

          const updated = await tx.game.updateMany({
            where: {
              id: command.gameId,
              accountId: command.accountId,
              revision: command.expectedRevision,
            },
            data: { revision: acceptedRevision, status: after.status },
          });
          if (updated.count !== 1) {
            throw new GameEventError(
              "STALE_SOURCE_REVISION",
              "Concurrent writer advanced the game.",
            );
          }
          await tx.playTransaction.create({
            data: {
              id: command.playTransactionId,
              accountId: command.accountId,
              gameId: command.gameId,
              setupSnapshotId: command.setupSnapshotId,
              acceptedRevision,
              expectedRevision: command.expectedRevision,
              clientSubmissionId: command.clientSubmissionId,
              payloadHash: digest,
              preStateHash: event.preStateHash,
              postStateHash: event.postStateHash,
              actorKind: toActorKind(command.actor.actorKind),
              actorId: command.actor.actorId,
              actorUserId: command.actor.actorUserId,
              acceptedAt,
            },
          });
          await tx.sourceEvent.create({
            data: {
              id: command.eventId,
              accountId: command.accountId,
              gameId: command.gameId,
              setupSnapshotId: command.setupSnapshotId,
              playTransactionId: command.playTransactionId,
              sequence,
              componentOrder: 0,
              eventType: body.eventType,
              schemaVersion: EVENT_SCHEMA_VERSION,
              rulesetVersionId: setup.rulesetVersionId,
              clientSubmissionId: command.clientSubmissionId,
              expectedRevision: command.expectedRevision,
              acceptedRevision,
              payloadHash: digest,
              payload: body.payload as Prisma.InputJsonValue,
              preStateHash: event.preStateHash,
              postStateHash: event.postStateHash,
              actorKind: toActorKind(command.actor.actorKind),
              actorId: command.actor.actorId,
              actorUserId: command.actor.actorUserId,
              recordedAt,
            },
          });
          await tx.projectionCheckpoint.updateMany({
            where: {
              accountId: command.accountId,
              gameId: command.gameId,
              scope: ProjectionScope.GAME,
              status: ProjectionStatus.CURRENT,
            },
            data: { status: ProjectionStatus.STALE },
          });
          if (
            body.eventType === "GameReopened" ||
            body.eventType === "GameVerified"
          ) {
            await tx.securityAuditRecord.create({
              data: {
                scope: AuditScope.ACCOUNT,
                accountId: command.accountId,
                actorKind: toActorKind(command.actor.actorKind),
                actorId: command.actor.actorId,
                actorUserId: command.actor.actorUserId,
                action:
                  body.eventType === "GameReopened"
                    ? "game.reopen"
                    : command.actor.capability === "game.reverify"
                      ? "game.reverify"
                      : "game.verify",
                capability: command.actor.capability,
                targetType: "Game",
                targetId: command.gameId,
                outcome: AuditOutcome.SUCCEEDED,
                reasonCode:
                  body.eventType === "GameReopened"
                    ? body.payload.reasonCode
                    : null,
                metadata: {
                  sourceRevisionBefore: command.expectedRevision,
                  sourceRevisionAfter: acceptedRevision,
                  verificationStatus:
                    body.eventType === "GameReopened"
                      ? "INVALIDATED"
                      : "VERIFIED",
                },
              },
            });
          }
          if (body.eventType === "CorrectionApplied") {
            const targets = await tx.sourceEvent.findMany({
              where: {
                accountId: command.accountId,
                gameId: command.gameId,
                id: { in: body.payload.targetEventIds },
                sequence: { lt: sequence },
              },
              select: { id: true },
            });
            if (targets.length !== body.payload.targetEventIds.length) {
              throw new GameEventError(
                "CORRECTION_TARGET_MISSING",
                "Correction target is unavailable.",
              );
            }
            await tx.eventCorrection.createMany({
              data: body.payload.targetEventIds.map((targetEventId) => ({
                accountId: command.accountId,
                gameId: command.gameId,
                correctionEventId: command.eventId,
                targetEventId,
                replacementEventId: null,
                replacementPayloadId:
                  body.payload.replacements.find(
                    (replacement) =>
                      replacement.targetEventId === targetEventId,
                  )?.id ?? null,
                policy: body.payload.policy,
              })),
            });
            if (correction) {
              const privacyRevision = await tx.privacyOverlay.aggregate({
                where: { accountId: command.accountId },
                _max: { effectiveOrder: true },
              });
              const privacyOverlayRevision =
                privacyRevision._max.effectiveOrder ?? 0;
              const projection = deriveGameStatistics({
                setup,
                events: [...history, event],
                privacyOverlayRevision,
              });
              if (
                projection.metadata.sourceRevision !== acceptedRevision ||
                projection.metadata.lifecycleStatus !== after.status
              ) {
                throw new GameEventError(
                  "INTERNAL_INVARIANT_FAILURE",
                  "Correction projection disagrees with replay.",
                );
              }
              const projectionIdentity = {
                accountId: command.accountId,
                gameId: command.gameId,
                sourceRevision: acceptedRevision,
                privacyOverlayRevision,
                derivationVersion: STATISTIC_DERIVATION_VERSION,
              };
              const existingProjection =
                await tx.projectionCheckpoint.findUnique({
                  where: {
                    accountId_gameId_sourceRevision_privacyOverlayRevision_derivationVersion:
                      projectionIdentity,
                  },
                });
              if (existingProjection) {
                await tx.projectionCheckpoint.update({
                  where: { id: existingProjection.id },
                  data: {
                    scope: ProjectionScope.GAME,
                    seasonId: null,
                    status: ProjectionStatus.CURRENT,
                    failureCode: null,
                  },
                });
              } else {
                await tx.projectionCheckpoint.create({
                  data: {
                    ...projectionIdentity,
                    seasonId: null,
                    scope: ProjectionScope.GAME,
                    status: ProjectionStatus.CURRENT,
                  },
                });
              }
              await tx.securityAuditRecord.create({
                data: {
                  scope: AuditScope.ACCOUNT,
                  accountId: command.accountId,
                  actorKind: toActorKind(command.actor.actorKind),
                  actorId: command.actor.actorId,
                  actorUserId: command.actor.actorUserId,
                  action: "game.correction.apply",
                  capability: "game.correct",
                  targetType: "Correction",
                  targetId: command.eventId,
                  outcome: AuditOutcome.SUCCEEDED,
                  reasonCode: body.payload.reasonCode,
                  correlationId: correction.correlationId,
                  metadata: {
                    gameId: command.gameId,
                    membershipId: correction.membershipId,
                    targetEventIds: body.payload.targetEventIds,
                    correctionPolicy: body.payload.policy,
                    sourceRevisionBefore: command.expectedRevision,
                    sourceRevisionAfter: acceptedRevision,
                    verificationImpact: verificationImpact(
                      history,
                      current.status,
                    ),
                    rulesetVersionId: setup.rulesetVersionId,
                    reducerVersion: REDUCER_VERSION,
                    statisticDerivationVersion: STATISTIC_DERIVATION_VERSION,
                    statisticRulesVersion: STATISTIC_RULES_VERSION,
                    projectionFreshness: "CURRENT",
                    generatedAt: acceptedAt.toISOString(),
                  },
                },
              });
            }
          }
          return { event, idempotentReplay: false };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof GameEventError) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === "P2002" || error.code === "P2034") {
          const prior = await this.prisma.playTransaction.findUnique({
            where: {
              accountId_gameId_actorId_clientSubmissionId: {
                accountId: command.accountId,
                gameId: command.gameId,
                actorId: command.actor.actorId,
                clientSubmissionId: command.clientSubmissionId,
              },
            },
            include: {
              sourceEvents: {
                include: {
                  playTransaction: { select: { acceptedAt: true } },
                },
              },
            },
          });
          if (prior) {
            if (prior.payloadHash !== digest) {
              throw new GameEventError(
                "DUPLICATE_IDEMPOTENCY_KEY",
                "Idempotency key was already used for different input.",
              );
            }
            const event = prior.sourceEvents[0];
            if (!event) {
              throw new GameEventError(
                "INTERNAL_INVARIANT_FAILURE",
                "Accepted transaction has no source event.",
              );
            }
            if (correction) {
              const priorAudit =
                await this.prisma.securityAuditRecord.findFirst({
                  where: {
                    accountId: command.accountId,
                    action: "game.correction.apply",
                    targetType: "Correction",
                    targetId: event.id,
                    outcome: AuditOutcome.SUCCEEDED,
                  },
                });
              if (!priorAudit) {
                throw new GameEventError(
                  "INTERNAL_INVARIANT_FAILURE",
                  "Accepted correction has no durable audit evidence.",
                );
              }
              if (priorAudit.correlationId !== correction.correlationId) {
                throw new GameEventError(
                  "DUPLICATE_IDEMPOTENCY_KEY",
                  "Idempotency key was already used with another correlation.",
                );
              }
            }
            const setup = await this.prisma.gameSetupSnapshot.findUnique({
              where: {
                accountId_gameId_id: {
                  accountId: command.accountId,
                  gameId: command.gameId,
                  id: prior.setupSnapshotId,
                },
              },
              select: { setupRevision: true },
            });
            if (!setup) {
              throw new GameEventError(
                "INTERNAL_INVARIANT_FAILURE",
                "Accepted transaction setup is unavailable.",
              );
            }
            return {
              event: mapSourceEvent(event, setup.setupRevision),
              idempotentReplay: true,
            };
          }
          const target = JSON.stringify(error.meta?.target ?? "");
          if (error.code === "P2002" && target.includes("id")) {
            throw new GameEventError(
              "DUPLICATE_ACCEPTED_EVENT",
              "Accepted event or transaction identifier already exists.",
            );
          }
          throw new GameEventError(
            "PERSISTENCE_CONFLICT",
            "Concurrent event acceptance conflicted.",
          );
        }
      }
      throw new GameEventError(
        "PERSISTENCE_CONFLICT",
        "Event persistence failed.",
      );
    }
  }

  private async loadCorrectionResult(
    accountId: string,
    gameId: string,
    setupSnapshotId: string,
    correctionEventId: string,
    correlationId: string,
    idempotentReplay: boolean,
  ): Promise<CorrectionWorkflowResult> {
    return this.prisma.$transaction(async (tx) => {
      const { setup, events } = await loadAcceptedHistory(
        tx,
        accountId,
        gameId,
        setupSnapshotId,
      );
      const correction = events.find(({ id }) => id === correctionEventId);
      if (!correction || correction.eventType !== "CorrectionApplied") {
        throw new GameEventError(
          "CORRECTION_TARGET_MISSING",
          "Accepted correction is unavailable.",
        );
      }
      const body = parseEventBody(
        {
          eventType: correction.eventType,
          payload: correction.payload,
        },
        correction.schemaVersion,
      );
      if (body.eventType !== "CorrectionApplied") {
        throw new GameEventError(
          "IMMUTABLE_HISTORY_VIOLATION",
          "Accepted correction body is invalid.",
        );
      }
      const game = await tx.game.findUnique({
        where: { accountId_id: { accountId, id: gameId } },
        select: { revision: true, status: true },
      });
      if (!game || game.revision !== correction.acceptedRevision) {
        throw new GameEventError(
          "STALE_SOURCE_REVISION",
          "Correction result is no longer the current game version.",
        );
      }
      const privacyRevision = await tx.privacyOverlay.aggregate({
        where: { accountId },
        _max: { effectiveOrder: true },
      });
      const privacyOverlayRevision = privacyRevision._max.effectiveOrder ?? 0;
      const checkpoint = await tx.projectionCheckpoint.findFirst({
        where: {
          accountId,
          gameId,
          seasonId: null,
          scope: ProjectionScope.GAME,
          sourceRevision: game.revision,
          privacyOverlayRevision,
          derivationVersion: STATISTIC_DERIVATION_VERSION,
          status: ProjectionStatus.CURRENT,
        },
      });
      const correctionEventIds = events
        .filter(({ eventType }) => eventType === "CorrectionApplied")
        .map(({ id }) => id);
      const auditRows = await tx.securityAuditRecord.findMany({
        where: {
          accountId,
          action: "game.correction.apply",
          targetType: "Correction",
          targetId: { in: correctionEventIds },
          outcome: AuditOutcome.SUCCEEDED,
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      const audit = auditRows.find(
        (row) =>
          row.targetId === correctionEventId &&
          row.correlationId === correlationId,
      );
      if (!checkpoint || !audit) {
        throw new GameEventError(
          "INTERNAL_INVARIANT_FAILURE",
          "Correction audit or current projection checkpoint is unavailable.",
        );
      }

      const replay = replayGame(setup, events, { verifyEvidence: true });
      const statistics = deriveGameStatistics({
        setup,
        events,
        privacyOverlayRevision,
      });
      if (
        replay.state.sourceRevision !== game.revision ||
        replay.state.status !== game.status ||
        statistics.metadata.sourceRevision !== game.revision
      ) {
        throw new GameEventError(
          "IMMUTABLE_HISTORY_VIOLATION",
          "Correction replay, statistics, and game checkpoint disagree.",
        );
      }

      const safeAudit = (
        row: (typeof auditRows)[number],
      ): SafeCorrectionAudit => {
        const auditedEvent = events.find(({ id }) => id === row.targetId);
        if (!auditedEvent || auditedEvent.eventType !== "CorrectionApplied") {
          throw new GameEventError(
            "IMMUTABLE_HISTORY_VIOLATION",
            "Correction audit target is unavailable.",
          );
        }
        const auditedBody = parseEventBody(
          {
            eventType: auditedEvent.eventType,
            payload: auditedEvent.payload,
          },
          auditedEvent.schemaVersion,
        );
        if (auditedBody.eventType !== "CorrectionApplied") {
          throw new GameEventError(
            "IMMUTABLE_HISTORY_VIOLATION",
            "Correction audit target is invalid.",
          );
        }
        const beforeHistory = events.filter(
          ({ sequence }) => sequence < auditedEvent.sequence,
        );
        const before = replayGame(setup, beforeHistory, {
          verifyEvidence: true,
        });
        const metadata =
          row.metadata !== null &&
          typeof row.metadata === "object" &&
          !Array.isArray(row.metadata)
            ? row.metadata
            : {};
        if (
          row.correlationId === null ||
          row.actorKind !== auditedEvent.actor.kind ||
          row.actorId !== auditedEvent.actor.id ||
          row.actorUserId !== auditedEvent.actor.userId ||
          (row.actorKind === ActorKind.USER &&
            typeof metadata.membershipId !== "string")
        ) {
          throw new GameEventError(
            "IMMUTABLE_HISTORY_VIOLATION",
            "Correction audit attribution is incomplete or inconsistent.",
          );
        }
        return {
          id: row.id,
          accountId,
          actor: {
            kind: row.actorKind,
            id: row.actorId,
            userId: row.actorUserId,
            membershipId:
              typeof metadata.membershipId === "string"
                ? metadata.membershipId
                : null,
          },
          action: "game.correction.apply",
          capability: "game.correct",
          target: {
            type: "Correction",
            correctionEventId: auditedEvent.id,
            gameId,
            targetEventIds: [...auditedBody.payload.targetEventIds],
          },
          reasonCode: auditedBody.payload.reasonCode,
          outcome: "SUCCEEDED",
          occurredAt: row.createdAt.toISOString(),
          correlationId: row.correlationId,
          sourceRevision: {
            before: auditedEvent.expectedRevision,
            after: auditedEvent.acceptedRevision,
          },
          verificationImpact: verificationImpact(
            beforeHistory,
            before.state.status,
          ),
        };
      };
      const auditHistory = auditRows.map(safeAudit);
      return {
        correction: correction as CorrectionWorkflowResult["correction"],
        idempotentReplay,
        replay: {
          lifecycleStatus: replay.state.status,
          score: { ...replay.state.score },
          effectiveEventCount: replay.metadata.effectiveEventCount,
        },
        statistics: {
          finalScore: { ...statistics.finalScore },
          batting: statistics.batting.map(({ playerId, counters }) => ({
            playerId,
            plateAppearances: counters.plateAppearances,
            hits: counters.hits,
            walks: counters.walks,
          })),
          pitching: statistics.pitching.map(({ playerId, counters }) => ({
            playerId,
            battersFaced: counters.battersFaced,
            hitsAllowed: counters.hitsAllowed,
            walks: counters.walks,
          })),
        },
        version: {
          sourceRevision: game.revision,
          correctionRevision: correction.acceptedRevision,
          setupRevision: setup.setupRevision,
          eventSchemaVersion: correction.schemaVersion,
          reducerVersion: REDUCER_VERSION,
          statisticDerivationVersion: STATISTIC_DERIVATION_VERSION,
          statisticRulesVersion: STATISTIC_RULES_VERSION,
          rulesetVersionId: setup.rulesetVersionId,
          verificationStatus:
            replay.state.status === "VERIFIED" ? "VERIFIED" : "UNVERIFIED",
          freshness: "CURRENT",
          generatedAt: correction.acceptedAt,
        },
        audit: safeAudit(audit),
        auditHistory,
      };
    });
  }
}
