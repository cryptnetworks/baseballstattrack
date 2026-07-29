import { createHash } from "node:crypto";

import {
  ActorKind,
  Prisma,
  type PrismaClient,
  type SourceEvent,
} from "@prisma/client";

import {
  EVENT_SCHEMA_VERSION,
  GameEventError,
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

export type ValidatedActorContext = {
  accountId: string;
  actorId: string;
  actorKind: "USER" | "SERVICE" | "SYSTEM";
  actorUserId: string | null;
  capability: "game.score" | "game.correct" | "game.verify";
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
    const requiredCapability =
      body.eventType === "GameVerified"
        ? "game.verify"
        : body.eventType === "CorrectionApplied" ||
            body.eventType === "GameReopened"
          ? "game.correct"
          : "game.score";
    if (command.actor.capability !== requiredCapability) {
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
}
