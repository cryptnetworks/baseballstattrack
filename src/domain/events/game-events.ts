import { createHash } from "node:crypto";

import { z } from "zod";

export const EVENT_SCHEMA_VERSION = 1 as const;
export const SUPPORTED_EVENT_SCHEMA_VERSIONS = [EVENT_SCHEMA_VERSION] as const;
export const REDUCER_VERSION = 1 as const;

const id = z.string().trim().min(1).max(128);
const side = z.enum(["HOME", "AWAY"]);
const position = z.enum([
  "PITCHER",
  "CATCHER",
  "FIRST_BASE",
  "SECOND_BASE",
  "THIRD_BASE",
  "SHORTSTOP",
  "LEFT_FIELD",
  "CENTER_FIELD",
  "RIGHT_FIELD",
  "DESIGNATED_HITTER",
  "EXTRA_HITTER",
]);
const base = z.enum(["FIRST", "SECOND", "THIRD"]);
const runnerOrigin = z.enum(["BATTER", "FIRST", "SECOND", "THIRD"]);
const runnerDestination = z.enum(["FIRST", "SECOND", "THIRD", "HOME", "OUT"]);
const movementCause = z.enum([
  "HIT",
  "FORCED_ADVANCE",
  "OPTIONAL_ADVANCE",
  "BATTER_RESULT",
  "FIELDERS_CHOICE",
  "ERROR",
  "SACRIFICE",
  "STOLEN_BASE",
  "CAUGHT_STEALING",
  "PICKOFF",
  "AWARD",
  "CORRECTION",
]);

const reasonPayload = z.object({ reasonCode: id }).strict();
const gameStarted = z
  .object({
    eventType: z.literal("GameStarted"),
    payload: z.object({}).strict(),
  })
  .strict();
const gameSuspended = z
  .object({
    eventType: z.literal("GameSuspended"),
    payload: reasonPayload,
  })
  .strict();
const gameResumed = z
  .object({
    eventType: z.literal("GameResumed"),
    payload: z.object({}).strict(),
  })
  .strict();
const gameCompleted = z
  .object({
    eventType: z.literal("GameCompleted"),
    payload: z
      .object({
        reasonCode: id,
        ending: z.enum([
          "REGULATION",
          "WALK_OFF",
          "MERCY_RULE",
          "TIME_LIMIT",
          "FORFEIT",
        ]),
      })
      .strict(),
  })
  .strict();
const gameVerified = z
  .object({
    eventType: z.literal("GameVerified"),
    payload: z.object({}).strict(),
  })
  .strict();
const gameReopened = z
  .object({ eventType: z.literal("GameReopened"), payload: reasonPayload })
  .strict();
const gameAbandoned = z
  .object({ eventType: z.literal("GameAbandoned"), payload: reasonPayload })
  .strict();
const gameCancelled = z
  .object({ eventType: z.literal("GameCancelled"), payload: reasonPayload })
  .strict();

const runnerMovement = z
  .object({
    runnerId: id,
    from: runnerOrigin,
    to: runnerDestination,
    cause: movementCause,
    forced: z.boolean(),
    responsiblePitcherId: id,
    runCounts: z.boolean().optional(),
    rbiEligible: z.boolean().optional(),
    out: z
      .object({
        outNumber: z.int().min(1).max(3),
        force: z.boolean(),
        fielders: z.array(id),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((movement, context) => {
    if (
      movement.to === "HOME" &&
      (movement.runCounts === undefined ||
        movement.rbiEligible === undefined ||
        movement.out !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "A scoring movement requires run-counting and RBI judgments.",
      });
    }
    if (
      movement.to === "OUT" &&
      (movement.out === undefined ||
        movement.runCounts !== undefined ||
        movement.rbiEligible !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "An out movement requires out details.",
      });
    }
    if (
      movement.to !== "HOME" &&
      movement.to !== "OUT" &&
      (movement.out !== undefined ||
        movement.runCounts !== undefined ||
        movement.rbiEligible !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "Non-scoring safe movements cannot contain run/out judgments.",
      });
    }
  });

const plateAppearance = z
  .object({
    eventType: z.literal("PlateAppearanceRecorded"),
    payload: z
      .object({
        batterId: id,
        pitcherId: id,
        outcome: z.enum([
          "WALK",
          "INTENTIONAL_WALK",
          "HIT_BY_PITCH",
          "STRIKEOUT_SWINGING",
          "STRIKEOUT_LOOKING",
          "SINGLE",
          "DOUBLE",
          "TRIPLE",
          "HOME_RUN",
          "BATTER_OUT",
          "FIELDER_CHOICE",
          "REACHED_ON_ERROR",
          "SACRIFICE_BUNT",
          "SACRIFICE_FLY",
          "INTERFERENCE",
        ]),
        battedBall: z
          .enum(["GROUND_BALL", "FLY_BALL", "LINE_DRIVE", "POP_UP", "BUNT"])
          .nullable(),
        movements: z.array(runnerMovement).min(1),
        fieldingCredits: z.array(
          z
            .object({
              fielderId: id,
              credit: z.enum(["PUTOUT", "ASSIST", "ERROR"]),
              errorType: id.nullable(),
            })
            .strict(),
        ),
      })
      .strict()
      .superRefine((payload, context) => {
        const errors = payload.fieldingCredits.filter(
          ({ credit }) => credit === "ERROR",
        );
        if (payload.outcome === "REACHED_ON_ERROR" && errors.length === 0) {
          context.addIssue({
            code: "custom",
            message: "Reached on error requires an explicit error credit.",
            path: ["fieldingCredits"],
          });
        }
        if (
          errors.some(({ errorType }) => errorType === null) ||
          payload.fieldingCredits.some(
            ({ credit, errorType }) => credit !== "ERROR" && errorType !== null,
          )
        ) {
          context.addIssue({
            code: "custom",
            message: "Error type must appear only on error credits.",
            path: ["fieldingCredits"],
          });
        }
      }),
  })
  .strict();

const runnerAdvance = z
  .object({
    eventType: z.literal("RunnerAdvanceRecorded"),
    payload: runnerMovement.refine((movement) => movement.to !== "OUT"),
  })
  .strict();
const runnerOut = z
  .object({
    eventType: z.literal("RunnerOutRecorded"),
    payload: z
      .object({
        runnerId: id,
        from: base,
        responsiblePitcherId: id,
        cause: z.enum([
          "CAUGHT_STEALING",
          "PICKOFF",
          "FIELDERS_CHOICE",
          "OTHER",
        ]),
        outNumber: z.int().min(1).max(3),
        force: z.boolean(),
        fielders: z.array(id),
      })
      .strict(),
  })
  .strict();
const stolenBase = z
  .object({
    eventType: z.literal("StolenBaseAttemptRecorded"),
    payload: z
      .object({
        runnerId: id,
        from: base,
        to: z.enum(["SECOND", "THIRD", "HOME"]),
        result: z.enum(["STOLEN_BASE", "CAUGHT_STEALING"]),
        responsiblePitcherId: id,
        fielders: z.array(id),
      })
      .strict(),
  })
  .strict();
const defensiveSubstitution = z
  .object({
    eventType: z.literal("DefensiveSubstitutionMade"),
    payload: z
      .object({
        side,
        outgoingPlayerId: id,
        incomingPlayerId: id,
        position,
      })
      .strict(),
  })
  .strict();
const defensiveAlignment = z
  .object({
    eventType: z.literal("DefensiveAlignmentChanged"),
    payload: z
      .object({
        side,
        assignments: z
          .array(z.object({ playerId: id, position }).strict())
          .min(1),
        reasonCode: id,
      })
      .strict(),
  })
  .strict();
const pitchingChange = z
  .object({
    eventType: z.literal("PitchingChangeMade"),
    payload: z
      .object({
        side,
        outgoingPitcherId: id,
        incomingPitcherId: id,
        inheritedRunnerIds: z.array(id),
      })
      .strict(),
  })
  .strict();

const replaceableEventBodySchema = z.discriminatedUnion("eventType", [
  plateAppearance,
  runnerAdvance,
  runnerOut,
  stolenBase,
  defensiveSubstitution,
  defensiveAlignment,
  pitchingChange,
]);

const correctionApplied = z
  .object({
    eventType: z.literal("CorrectionApplied"),
    payload: z
      .object({
        policy: z.enum([
          "REPLACE_PLAY",
          "REPLACE_EVENT_RANGE",
          "REPLACE_JUDGMENT",
          "REVERSE_EVENTS",
        ]),
        targetEventIds: z.array(id).min(1),
        replacements: z.array(
          z
            .object({
              id,
              order: z.int().nonnegative(),
              targetEventId: id,
              body: replaceableEventBodySchema,
            })
            .strict(),
        ),
        reasonCode: id,
      })
      .strict()
      .superRefine((payload, context) => {
        if (
          new Set(payload.targetEventIds).size !== payload.targetEventIds.length
        ) {
          context.addIssue({
            code: "custom",
            message: "Correction targets must be unique.",
            path: ["targetEventIds"],
          });
        }
        const replacementIds = payload.replacements.map(
          ({ id: value }) => value,
        );
        const replacementOrders = payload.replacements.map(
          ({ order }) => order,
        );
        const expectedOrders = replacementOrders.map((_, index) => index);
        if (
          new Set(replacementIds).size !== replacementIds.length ||
          new Set(replacementOrders).size !== replacementOrders.length ||
          [...replacementOrders]
            .sort((a, b) => a - b)
            .some((value, index) => value !== expectedOrders[index])
        ) {
          context.addIssue({
            code: "custom",
            message:
              "Correction replacements require unique IDs and contiguous order.",
            path: ["replacements"],
          });
        }
        if (
          (payload.policy === "REVERSE_EVENTS" &&
            payload.replacements.length !== 0) ||
          (payload.policy !== "REVERSE_EVENTS" &&
            (payload.replacements.length !== payload.targetEventIds.length ||
              payload.replacements.some(
                ({ targetEventId }, index) =>
                  targetEventId !== payload.targetEventIds[index],
              )))
        ) {
          context.addIssue({
            code: "custom",
            message:
              "Correction replacements must map one-to-one to ordered targets.",
            path: ["replacements"],
          });
        }
      }),
  })
  .strict();

export const eventBodySchema = z.discriminatedUnion("eventType", [
  gameStarted,
  gameSuspended,
  gameResumed,
  gameCompleted,
  gameVerified,
  gameReopened,
  gameAbandoned,
  gameCancelled,
  plateAppearance,
  runnerAdvance,
  runnerOut,
  stolenBase,
  defensiveSubstitution,
  defensiveAlignment,
  pitchingChange,
  correctionApplied,
]);

export type EventBody = z.infer<typeof eventBodySchema>;
export type EventType = EventBody["eventType"];
export type GameSide = z.infer<typeof side>;
export type BaseballPosition = z.infer<typeof position>;
export type Base = z.infer<typeof base>;
export type RunnerMovement = z.infer<typeof runnerMovement>;

export const eventEnvelopeSchema = z
  .object({
    id,
    accountId: id,
    gameId: id,
    setupSnapshotId: id,
    setupRevision: z.int().positive(),
    sequence: z.int().positive(),
    schemaVersion: z.literal(EVENT_SCHEMA_VERSION),
    rulesetVersionId: id,
    playTransactionId: id.nullable(),
    componentOrder: z.int().nonnegative().nullable(),
    clientSubmissionId: id,
    expectedRevision: z.int().nonnegative(),
    acceptedRevision: z.int().positive(),
    actor: z
      .object({
        kind: z.enum(["USER", "SERVICE", "SYSTEM"]),
        id,
        userId: id.nullable(),
      })
      .strict(),
    recordedAt: z.iso.datetime(),
    acceptedAt: z.iso.datetime(),
    eventType: z.string(),
    payload: z.unknown(),
    preStateHash: z.string().regex(/^sha256:v1:[a-f0-9]{64}$/),
    postStateHash: z.string().regex(/^sha256:v1:[a-f0-9]{64}$/),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.acceptedRevision !== value.expectedRevision + 1) {
      context.addIssue({
        code: "custom",
        message: "acceptedRevision must equal expectedRevision + 1",
        path: ["acceptedRevision"],
      });
    }
    if (
      (value.playTransactionId === null && value.componentOrder !== null) ||
      (value.playTransactionId !== null && value.componentOrder === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Play transaction and component order must appear together.",
        path: ["componentOrder"],
      });
    }
    const parsed = eventBodySchema.safeParse({
      eventType: value.eventType,
      payload: value.payload,
    });
    if (!parsed.success) {
      context.addIssue({
        code: "custom",
        message: "event type and payload do not match schema version 1",
        path: ["payload"],
      });
    }
  });

type ParsedEventEnvelope = z.infer<typeof eventEnvelopeSchema>;
export type AcceptedEvent = Omit<ParsedEventEnvelope, "eventType" | "payload"> &
  EventBody;

export type LineupEntry = {
  playerId: string;
  battingOrder: number | null;
  position: BaseballPosition | null;
  active: boolean;
};

export type AcceptedSetup = {
  id: string;
  accountId: string;
  gameId: string;
  setupRevision: number;
  rulesetVersionId: string;
  scheduledInnings: number;
  status: "READY";
  sides: Record<
    GameSide,
    {
      lineup: readonly LineupEntry[];
      startingPitcherId: string;
    }
  >;
};

export type GameStatus =
  | "READY"
  | "IN_PROGRESS"
  | "SUSPENDED"
  | "COMPLETED"
  | "VERIFIED"
  | "CORRECTED"
  | "ABANDONED"
  | "CANCELLED";

export type GameState = {
  accountId: string;
  gameId: string;
  setupSnapshotId: string;
  setupRevision: number;
  rulesetVersionId: string;
  scheduledInnings: number;
  status: GameStatus;
  inning: number | null;
  half: "TOP" | "BOTTOM" | null;
  outs: number;
  score: Record<GameSide, number>;
  bases: Record<Base, string | null>;
  battingOrderIndex: Record<GameSide, number>;
  lineups: Record<GameSide, LineupEntry[]>;
  participatedPlayers: Record<GameSide, string[]>;
  defense: Record<GameSide, Partial<Record<BaseballPosition, string>>>;
  activePitcher: Record<GameSide, string>;
  runnerPitcherResponsibility: Record<string, string>;
  sourceRevision: number;
  lastSequence: number;
};

export type EventErrorCode =
  | "INVALID_PAYLOAD"
  | "UNSUPPORTED_EVENT_TYPE"
  | "UNSUPPORTED_SCHEMA_VERSION"
  | "SETUP_NOT_READY"
  | "INVALID_LIFECYCLE_TRANSITION"
  | "INVALID_BASEBALL_TRANSITION"
  | "INVALID_LINEUP"
  | "INVALID_RUNNER_MOVEMENT"
  | "INVALID_PITCHER"
  | "STALE_SOURCE_REVISION"
  | "SEQUENCE_CONFLICT"
  | "DUPLICATE_IDEMPOTENCY_KEY"
  | "DUPLICATE_ACCEPTED_EVENT"
  | "CORRECTION_TARGET_MISSING"
  | "CORRECTION_GRAPH_INVALID"
  | "ACCOUNT_MISMATCH"
  | "GAME_MISMATCH"
  | "IMMUTABLE_HISTORY_VIOLATION"
  | "PERSISTENCE_CONFLICT"
  | "INTERNAL_INVARIANT_FAILURE";

export class GameEventError extends Error {
  constructor(
    readonly code: EventErrorCode,
    message: string,
    readonly context: Readonly<Record<string, string | number>> = {},
  ) {
    super(message);
    this.name = "GameEventError";
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function stateHash(state: GameState): string {
  const digest = createHash("sha256")
    .update(canonicalJson(state))
    .digest("hex");
  return `sha256:v1:${digest}`;
}

export function parseEventBody(input: unknown): EventBody {
  const result = eventBodySchema.safeParse(input);
  if (result.success) return result.data;
  const eventType =
    typeof input === "object" && input !== null && "eventType" in input
      ? (input as { eventType?: unknown }).eventType
      : undefined;
  if (
    typeof eventType === "string" &&
    !eventBodySchema.options.some(
      (option) => option.shape.eventType.value === eventType,
    )
  ) {
    throw new GameEventError(
      "UNSUPPORTED_EVENT_TYPE",
      "Unsupported event type.",
    );
  }
  throw new GameEventError("INVALID_PAYLOAD", "Invalid event payload.");
}

export function parseEvent(input: unknown): AcceptedEvent {
  const version =
    typeof input === "object" && input !== null && "schemaVersion" in input
      ? (input as { schemaVersion?: unknown }).schemaVersion
      : undefined;
  if (version !== EVENT_SCHEMA_VERSION) {
    throw new GameEventError(
      "UNSUPPORTED_SCHEMA_VERSION",
      "Unsupported event schema version.",
    );
  }
  const result = eventEnvelopeSchema.safeParse(input);
  if (!result.success) {
    parseEventBody(
      typeof input === "object" && input !== null
        ? {
            eventType: (input as { eventType?: unknown }).eventType,
            payload: (input as { payload?: unknown }).payload,
          }
        : input,
    );
    throw new GameEventError("INVALID_PAYLOAD", "Invalid event envelope.");
  }
  return result.data as AcceptedEvent;
}
