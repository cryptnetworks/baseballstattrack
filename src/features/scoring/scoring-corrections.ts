import {
  EVENT_SCHEMA_VERSION,
  deriveEventStates,
  parseEvent,
  replayGame,
  resolveEffectiveEvents,
  stateHash,
  type AcceptedEvent,
  type AcceptedSetup,
  type EventBody,
  type GameState,
} from "@/domain/events/event-log";
import { deriveGameStatistics } from "@/domain/statistics";

const correctableEventTypes = new Set<AcceptedEvent["eventType"]>([
  "PlateAppearanceRecorded",
  "RunnerAdvanceRecorded",
  "RunnerOutRecorded",
  "StolenBaseAttemptRecorded",
  "RunnerPlayRecorded",
  "DefensiveSubstitutionMade",
  "DefensiveAlignmentChanged",
  "PitchingChangeMade",
]);

const plateOutcomesByDestination = {
  FIRST: [
    "WALK",
    "INTENTIONAL_WALK",
    "HIT_BY_PITCH",
    "SINGLE",
    "FIELDER_CHOICE",
    "REACHED_ON_ERROR",
    "INTERFERENCE",
  ],
  SECOND: ["DOUBLE"],
  THIRD: ["TRIPLE"],
  HOME: ["HOME_RUN"],
  OUT: [
    "STRIKEOUT_SWINGING",
    "STRIKEOUT_LOOKING",
    "BATTER_OUT",
    "SACRIFICE_BUNT",
    "SACRIFICE_FLY",
  ],
} as const;

export const correctionReasonCodes = [
  "SCORER_REVIEW",
  "SCORING_JUDGMENT",
  "DATA_ENTRY_ERROR",
  "OFFICIAL_SCORER_UPDATE",
] as const;

export type CorrectionReasonCode = (typeof correctionReasonCodes)[number];
export type CorrectionAction = "REVERSE_EVENT" | "REPLACE_PLATE_JUDGMENT";

export type CorrectionDraft = {
  targetEventId: string;
  action: CorrectionAction;
  replacementOutcome: string | null;
  errorFielderId: string | null;
  reasonCode: CorrectionReasonCode;
  replacementId: string;
};

export type RecentPlaySummary = {
  id: string;
  sequence: number;
  eventType: string;
  inning: number | null;
  half: "TOP" | "BOTTOM" | null;
  baseballIdentity: string;
  outcome: string;
  correctedOutcome: string | null;
  scoreEffect: { HOME: number; AWAY: number };
  outEffect: number;
  correctionState: "UNCORRECTED" | "CORRECTED" | "CORRECTION";
  status: "CURRENT" | "SUPERSEDED";
  actorReference: string;
  acceptedAt: string;
  canReplaceJudgment: boolean;
  replacementOutcomes: string[];
  eligibleFielderIds: string[];
};

export type CorrectionAuditEntry = {
  correctionEventId: string;
  sequence: number;
  actorReference: string;
  reasonCode: string;
  occurredAt: string;
  targetEventIds: string[];
  sourceRevision: { before: number; after: number };
  verificationEffect:
    | "UNCHANGED_UNVERIFIED"
    | "REQUIRES_VERIFICATION"
    | "INVALIDATED_REQUIRES_REVERIFICATION";
  status: "CURRENT" | "SUPERSEDED";
};

export type CorrectionPreview = {
  sourceRevision: number;
  score: {
    before: { HOME: number; AWAY: number };
    after: { HOME: number; AWAY: number };
  };
  situation: {
    before: string;
    after: string;
  };
  verificationEffect: "UNCHANGED_UNVERIFIED" | "REQUIRES_VERIFICATION";
  changedBatting: Array<{
    playerId: string;
    before: string;
    after: string;
  }>;
  changedPitching: Array<{
    playerId: string;
    before: string;
    after: string;
  }>;
  changedFielding: Array<{
    playerId: string;
    before: string;
    after: string;
  }>;
};

export type ScoringCorrectionErrorCode =
  | "INVALID_SELECTION"
  | "TARGET_UNAVAILABLE"
  | "UNSUPPORTED_REPLACEMENT"
  | "REOPEN_REQUIRED"
  | "INVALID_PREVIEW";

export class ScoringCorrectionError extends Error {
  constructor(
    readonly code: ScoringCorrectionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ScoringCorrectionError";
  }
}

function words(value: string) {
  return value.replaceAll("_", " ").toLowerCase();
}

function name(playerId: string, names: Readonly<Record<string, string>>) {
  return names[playerId] ?? playerId;
}

function movementSummary(
  movements: readonly {
    runnerId: string;
    from: string;
    to: string;
  }[],
  names: Readonly<Record<string, string>>,
) {
  return movements
    .map(
      ({ runnerId, from, to }) =>
        `${name(runnerId, names)} ${words(from)} to ${words(to)}`,
    )
    .join("; ");
}

export function summarizeCorrectionBody(
  body: EventBody,
  names: Readonly<Record<string, string>>,
): { identity: string; outcome: string } {
  switch (body.eventType) {
    case "PlateAppearanceRecorded":
      return {
        identity: name(body.payload.batterId, names),
        outcome: `${words(body.payload.outcome)} · ${movementSummary(
          body.payload.movements,
          names,
        )}`,
      };
    case "RunnerPlayRecorded":
      return {
        identity: body.payload.movements
          .map(({ runnerId }) => name(runnerId, names))
          .join(", "),
        outcome: `${words(body.payload.playType)} · ${movementSummary(
          body.payload.movements,
          names,
        )}`,
      };
    case "RunnerAdvanceRecorded":
      return {
        identity: name(body.payload.runnerId, names),
        outcome: movementSummary([body.payload], names),
      };
    case "RunnerOutRecorded":
      return {
        identity: name(body.payload.runnerId, names),
        outcome: `${words(body.payload.cause)} · ${words(
          body.payload.from,
        )} to out`,
      };
    case "StolenBaseAttemptRecorded":
      return {
        identity: name(body.payload.runnerId, names),
        outcome: `${words(body.payload.result)} · ${words(
          body.payload.from,
        )} to ${words(body.payload.to)}`,
      };
    case "DefensiveSubstitutionMade":
      return {
        identity: name(body.payload.incomingPlayerId, names),
        outcome: `${name(
          body.payload.incomingPlayerId,
          names,
        )} replaced ${name(body.payload.outgoingPlayerId, names)} at ${words(
          body.payload.position,
        )}`,
      };
    case "DefensiveAlignmentChanged":
      return {
        identity: words(body.payload.side),
        outcome: `defensive alignment changed · ${body.payload.assignments
          .map(
            ({ playerId, position }) =>
              `${name(playerId, names)} at ${words(position)}`,
          )
          .join(", ")}`,
      };
    case "PitchingChangeMade":
      return {
        identity: name(body.payload.incomingPitcherId, names),
        outcome: `${name(
          body.payload.incomingPitcherId,
          names,
        )} replaced ${name(body.payload.outgoingPitcherId, names)} as pitcher`,
      };
    case "CorrectionApplied":
      return {
        identity: "Scoring correction",
        outcome: `${words(body.payload.policy)} · ${words(
          body.payload.reasonCode,
        )}`,
      };
    default:
      return {
        identity: "Game",
        outcome: words(body.eventType),
      };
  }
}

function outEffect(body: EventBody) {
  if (
    body.eventType === "PlateAppearanceRecorded" ||
    body.eventType === "RunnerPlayRecorded"
  ) {
    return body.payload.movements.filter(({ to }) => to === "OUT").length;
  }
  if (body.eventType === "RunnerOutRecorded") return 1;
  if (
    body.eventType === "StolenBaseAttemptRecorded" &&
    body.payload.result === "CAUGHT_STEALING"
  ) {
    return 1;
  }
  return 0;
}

function bodyFor(event: AcceptedEvent): EventBody {
  return { eventType: event.eventType, payload: event.payload } as EventBody;
}

function historicalStates(
  setup: AcceptedSetup,
  events: readonly AcceptedEvent[],
  event: AcceptedEvent,
) {
  try {
    return deriveEventStates(
      setup,
      events.filter(({ sequence }) => sequence < event.sequence),
      event,
    );
  } catch {
    return null;
  }
}

function replacementOutcomes(event: AcceptedEvent): string[] {
  if (event.eventType !== "PlateAppearanceRecorded") return [];
  const batter = event.payload.movements.find(({ from }) => from === "BATTER");
  if (!batter) return [];
  return [...plateOutcomesByDestination[batter.to]];
}

export function buildRecentPlayHistory(
  setup: AcceptedSetup,
  events: readonly AcceptedEvent[],
  names: Readonly<Record<string, string>>,
  options: { offset?: number; limit?: number } = {},
): RecentPlaySummary[] {
  const effectiveIds = new Set(
    resolveEffectiveEvents(events).map(({ id }) => id),
  );
  const activeReplacement = new Map<string, EventBody>();
  const activeTargets = new Set<string>();
  for (const event of events) {
    if (
      event.eventType !== "CorrectionApplied" ||
      !effectiveIds.has(event.id)
    ) {
      continue;
    }
    for (const targetEventId of event.payload.targetEventIds) {
      activeTargets.add(targetEventId);
    }
    for (const replacement of event.payload.replacements) {
      activeReplacement.set(replacement.targetEventId, replacement.body);
    }
  }

  const orderedEvents = events
    .filter(
      (event) =>
        correctableEventTypes.has(event.eventType) ||
        event.eventType === "CorrectionApplied",
    )
    .sort(
      (left, right) =>
        right.sequence - left.sequence || left.id.localeCompare(right.id),
    );
  const offset = Math.max(0, options.offset ?? 0);
  const selectedEvents =
    options.limit === undefined
      ? orderedEvents.slice(offset)
      : orderedEvents.slice(offset, offset + Math.max(0, options.limit));
  return selectedEvents.map((event) => {
    const states = historicalStates(setup, events, event);
    const summary = summarizeCorrectionBody(bodyFor(event), names);
    const replacement = activeReplacement.get(event.id);
    const corrected = replacement
      ? summarizeCorrectionBody(replacement, names).outcome
      : activeTargets.has(event.id)
        ? "event reversed without replacement"
        : null;
    const outcomes = replacementOutcomes(event);
    return {
      id: event.id,
      sequence: event.sequence,
      eventType: event.eventType,
      inning: states?.before.inning ?? null,
      half: states?.before.half ?? null,
      baseballIdentity: summary.identity,
      outcome: summary.outcome,
      correctedOutcome: corrected,
      scoreEffect: {
        HOME:
          (states?.after.score.HOME ?? 0) - (states?.before.score.HOME ?? 0),
        AWAY:
          (states?.after.score.AWAY ?? 0) - (states?.before.score.AWAY ?? 0),
      },
      outEffect: outEffect(bodyFor(event)),
      correctionState:
        event.eventType === "CorrectionApplied"
          ? "CORRECTION"
          : corrected
            ? "CORRECTED"
            : "UNCORRECTED",
      status: effectiveIds.has(event.id) ? "CURRENT" : "SUPERSEDED",
      actorReference: `${event.actor.kind.toLowerCase()} ${event.actor.id}`,
      acceptedAt: event.acceptedAt,
      canReplaceJudgment: outcomes.length > 0,
      replacementOutcomes: outcomes,
      eligibleFielderIds: states?.before.half
        ? [
            ...new Set(
              Object.values(
                states.before.defense[
                  states.before.half === "TOP" ? "HOME" : "AWAY"
                ],
              ).filter((playerId): playerId is string => Boolean(playerId)),
            ),
          ].sort()
        : [],
    } satisfies RecentPlaySummary;
  });
}

export function countRecentPlayHistory(events: readonly AcceptedEvent[]) {
  return events.filter(
    (event) =>
      correctableEventTypes.has(event.eventType) ||
      event.eventType === "CorrectionApplied",
  ).length;
}

export function buildCorrectionAudit(
  setup: AcceptedSetup,
  events: readonly AcceptedEvent[],
): CorrectionAuditEntry[] {
  const effectiveIds = new Set(
    resolveEffectiveEvents(events).map(({ id }) => id),
  );
  return events
    .filter(
      (event): event is AcceptedEvent & { eventType: "CorrectionApplied" } =>
        event.eventType === "CorrectionApplied",
    )
    .map((event) => {
      const before = replayGame(
        setup,
        events.filter(({ sequence }) => sequence < event.sequence),
      ).state;
      return {
        correctionEventId: event.id,
        sequence: event.sequence,
        actorReference: `${event.actor.kind.toLowerCase()} ${event.actor.id}`,
        reasonCode: event.payload.reasonCode,
        occurredAt: event.acceptedAt,
        targetEventIds: [...event.payload.targetEventIds],
        sourceRevision: {
          before: event.expectedRevision,
          after: event.acceptedRevision,
        },
        verificationEffect:
          before.status === "VERIFIED" ||
          events
            .filter(({ sequence }) => sequence < event.sequence)
            .some(({ eventType }) => eventType === "GameVerified")
            ? "INVALIDATED_REQUIRES_REVERIFICATION"
            : before.status === "COMPLETED" || before.status === "CORRECTED"
              ? "REQUIRES_VERIFICATION"
              : "UNCHANGED_UNVERIFIED",
        status: effectiveIds.has(event.id) ? "CURRENT" : "SUPERSEDED",
      } satisfies CorrectionAuditEntry;
    })
    .sort(
      (left, right) =>
        right.sequence - left.sequence ||
        left.correctionEventId.localeCompare(right.correctionEventId),
    );
}

function requireCurrentTarget(
  events: readonly AcceptedEvent[],
  targetEventId: string,
  allowSuperseded: boolean,
) {
  const target = events.find(({ id }) => id === targetEventId);
  if (
    !target ||
    (!correctableEventTypes.has(target.eventType) &&
      target.eventType !== "CorrectionApplied")
  ) {
    throw new ScoringCorrectionError(
      "TARGET_UNAVAILABLE",
      "The selected play is not available for correction.",
    );
  }
  if (
    !allowSuperseded &&
    !resolveEffectiveEvents(events).some(({ id }) => id === target.id)
  ) {
    throw new ScoringCorrectionError(
      "TARGET_UNAVAILABLE",
      "The selected play has already been superseded.",
    );
  }
  return target;
}

function replacementPlateAppearance(
  target: AcceptedEvent & { eventType: "PlateAppearanceRecorded" },
  draft: CorrectionDraft,
): Extract<EventBody, { eventType: "PlateAppearanceRecorded" }> {
  const batterMovement = target.payload.movements.find(
    ({ from }) => from === "BATTER",
  );
  const allowed = batterMovement
    ? plateOutcomesByDestination[batterMovement.to]
    : [];
  if (
    !draft.replacementOutcome ||
    !(allowed as readonly string[]).includes(draft.replacementOutcome)
  ) {
    throw new ScoringCorrectionError(
      "UNSUPPORTED_REPLACEMENT",
      "The replacement judgment does not match the recorded batter destination.",
    );
  }
  const outcome = draft.replacementOutcome as typeof target.payload.outcome;
  const needsError = outcome === "REACHED_ON_ERROR";
  if (needsError && !draft.errorFielderId) {
    throw new ScoringCorrectionError(
      "INVALID_SELECTION",
      "Reached on error requires the responsible fielder.",
    );
  }
  const isOut = batterMovement?.to === "OUT";
  const battedBall =
    outcome === "SACRIFICE_BUNT"
      ? ("BUNT" as const)
      : outcome === "SACRIFICE_FLY"
        ? ("FLY_BALL" as const)
        : ["WALK", "INTENTIONAL_WALK", "HIT_BY_PITCH", "INTERFERENCE"].includes(
              outcome,
            )
          ? null
          : (target.payload.battedBall ?? "GROUND_BALL");
  return {
    eventType: "PlateAppearanceRecorded",
    payload: {
      ...target.payload,
      outcome,
      battedBall,
      movements: target.payload.movements.map((movement) => ({
        ...movement,
        cause: "CORRECTION" as const,
      })),
      fieldingCredits: needsError
        ? [
            {
              fielderId: draft.errorFielderId!,
              credit: "ERROR" as const,
              errorType: "FIELDING",
            },
          ]
        : isOut
          ? target.payload.fieldingCredits.filter(
              ({ credit }) => credit !== "ERROR",
            )
          : [],
    },
  };
}

export function buildCorrectionPayload(
  events: readonly AcceptedEvent[],
  draft: CorrectionDraft,
  options: { allowSuperseded?: boolean } = {},
): Extract<EventBody, { eventType: "CorrectionApplied" }>["payload"] {
  const target = requireCurrentTarget(
    events,
    draft.targetEventId,
    options.allowSuperseded === true,
  );
  if (!correctionReasonCodes.includes(draft.reasonCode)) {
    throw new ScoringCorrectionError(
      "INVALID_SELECTION",
      "Select a supported correction reason.",
    );
  }
  if (draft.action === "REVERSE_EVENT") {
    return {
      policy: "REVERSE_EVENTS",
      targetEventIds: [target.id],
      replacements: [],
      reasonCode: draft.reasonCode,
    };
  }
  if (target.eventType !== "PlateAppearanceRecorded") {
    throw new ScoringCorrectionError(
      "UNSUPPORTED_REPLACEMENT",
      "Structured judgment replacement is available for plate appearances only.",
    );
  }
  return {
    policy: "REPLACE_JUDGMENT",
    targetEventIds: [target.id],
    replacements: [
      {
        id: draft.replacementId,
        order: 0,
        targetEventId: target.id,
        body: replacementPlateAppearance(target, draft),
      },
    ],
    reasonCode: draft.reasonCode,
  };
}

function situation(state: GameState) {
  const occupied = (["FIRST", "SECOND", "THIRD"] as const)
    .filter((base) => state.bases[base] !== null)
    .map((base) => words(base))
    .join(", ");
  return `${state.half?.toLowerCase() ?? "before start"} ${
    state.inning ?? ""
  } · ${state.outs} out${state.outs === 1 ? "" : "s"} · ${
    occupied || "bases empty"
  }`;
}

function battingLine(
  line: ReturnType<typeof deriveGameStatistics>["batting"][number] | undefined,
) {
  const counters = line?.counters;
  return `${counters?.plateAppearances ?? 0} PA, ${
    counters?.hits ?? 0
  } H, ${counters?.walks ?? 0} BB, ${counters?.runsBattedIn ?? 0} RBI`;
}

function pitchingLine(
  line: ReturnType<typeof deriveGameStatistics>["pitching"][number] | undefined,
) {
  const counters = line?.counters;
  return `${counters?.battersFaced ?? 0} BF, ${
    counters?.hitsAllowed ?? 0
  } H, ${counters?.walks ?? 0} BB, ${counters?.earnedRuns ?? 0} ER`;
}

function fieldingLine(
  line: ReturnType<typeof deriveGameStatistics>["fielding"][number] | undefined,
) {
  const counters = line?.counters;
  return `${counters?.putouts ?? 0} PO, ${
    counters?.assists ?? 0
  } A, ${counters?.errors ?? 0} E`;
}

function changedLines<T extends { playerId: string }>(
  before: readonly T[],
  after: readonly T[],
  format: (line: T | undefined) => string,
) {
  const ids = [
    ...new Set([...before, ...after].map(({ playerId }) => playerId)),
  ].sort();
  return ids
    .flatMap((playerId) => {
      const beforeText = format(
        before.find((line) => line.playerId === playerId),
      );
      const afterText = format(
        after.find((line) => line.playerId === playerId),
      );
      return beforeText === afterText
        ? []
        : [{ playerId, before: beforeText, after: afterText }];
    })
    .slice(0, 24);
}

export function previewCorrection(
  setup: AcceptedSetup,
  events: readonly AcceptedEvent[],
  payload: Extract<EventBody, { eventType: "CorrectionApplied" }>["payload"],
): CorrectionPreview {
  const beforeReplay = replayGame(setup, events, { verifyEvidence: true });
  if (beforeReplay.state.status === "VERIFIED") {
    throw new ScoringCorrectionError(
      "REOPEN_REQUIRED",
      "Verified games must be explicitly reopened before correction.",
    );
  }
  if (
    !["IN_PROGRESS", "COMPLETED", "CORRECTED"].includes(
      beforeReplay.state.status,
    )
  ) {
    throw new ScoringCorrectionError(
      "INVALID_PREVIEW",
      "The game lifecycle does not permit correction.",
    );
  }
  const timestamp = new Date(0).toISOString();
  const placeholderHash = stateHash(beforeReplay.state);
  const proposed = parseEvent({
    id: "correction-preview",
    accountId: setup.accountId,
    gameId: setup.gameId,
    setupSnapshotId: setup.id,
    setupRevision: setup.setupRevision,
    sequence: beforeReplay.state.lastSequence + 1,
    schemaVersion: EVENT_SCHEMA_VERSION,
    rulesetVersionId: setup.rulesetVersionId,
    playTransactionId: "correction-preview-transaction",
    componentOrder: 0,
    clientSubmissionId: "correction-preview-submission",
    expectedRevision: beforeReplay.state.sourceRevision,
    acceptedRevision: beforeReplay.state.sourceRevision + 1,
    actor: { kind: "SYSTEM", id: "correction-preview", userId: null },
    recordedAt: timestamp,
    acceptedAt: timestamp,
    eventType: "CorrectionApplied",
    payload,
    preStateHash: placeholderHash,
    postStateHash: placeholderHash,
  });
  const proposedEvents = [...events, proposed];
  const afterReplay = replayGame(setup, proposedEvents);
  const beforeStats = deriveGameStatistics({ setup, events });
  const afterStats = deriveGameStatistics({ setup, events: proposedEvents });
  return {
    sourceRevision: beforeReplay.state.sourceRevision,
    score: {
      before: { ...beforeReplay.state.score },
      after: { ...afterReplay.state.score },
    },
    situation: {
      before: situation(beforeReplay.state),
      after: situation(afterReplay.state),
    },
    verificationEffect:
      beforeReplay.state.status === "IN_PROGRESS"
        ? "UNCHANGED_UNVERIFIED"
        : "REQUIRES_VERIFICATION",
    changedBatting: changedLines(
      beforeStats.batting,
      afterStats.batting,
      battingLine,
    ),
    changedPitching: changedLines(
      beforeStats.pitching,
      afterStats.pitching,
      pitchingLine,
    ),
    changedFielding: changedLines(
      beforeStats.fielding,
      afterStats.fielding,
      fieldingLine,
    ),
  };
}
