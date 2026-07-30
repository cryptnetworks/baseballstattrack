import type {
  Base,
  EarnedRunClassification,
  EventBody,
  GameState,
  RunnerMovement,
} from "@/domain/events/event-log";
import type { RunnerOutcome } from "@/features/scoring/runner-interactions";

export type PlateOutcome = Extract<
  EventBody,
  { eventType: "PlateAppearanceRecorded" }
>["payload"]["outcome"];

export const PLATE_OUTCOMES = [
  { value: "BATTER_OUT", label: "In-play out", key: "o", common: true },
  {
    value: "STRIKEOUT_SWINGING",
    label: "Strikeout",
    key: "k",
    common: true,
  },
  { value: "WALK", label: "Walk", key: "w", common: true },
  { value: "HIT_BY_PITCH", label: "Hit by pitch", key: "h", common: true },
  { value: "SINGLE", label: "Single", key: "1", common: true },
  { value: "DOUBLE", label: "Double", key: "2", common: true },
  { value: "TRIPLE", label: "Triple", key: "3", common: true },
  { value: "HOME_RUN", label: "Home run", key: "4", common: true },
  {
    value: "REACHED_ON_ERROR",
    label: "Reached on error",
    key: "e",
    common: true,
  },
  {
    value: "FIELDER_CHOICE",
    label: "Fielder’s choice",
    key: "f",
    common: true,
  },
  {
    value: "INTENTIONAL_WALK",
    label: "Intentional walk",
    key: "i",
    common: false,
  },
  {
    value: "STRIKEOUT_LOOKING",
    label: "Strikeout looking",
    key: "l",
    common: false,
  },
  {
    value: "SACRIFICE_BUNT",
    label: "Sacrifice bunt",
    key: "b",
    common: false,
  },
  {
    value: "SACRIFICE_FLY",
    label: "Sacrifice fly",
    key: "y",
    common: false,
  },
  {
    value: "INTERFERENCE",
    label: "Interference",
    key: "n",
    common: false,
  },
] as const satisfies readonly {
  value: PlateOutcome;
  label: string;
  key: string;
  common: boolean;
}[];

export function plateOutcomeForShortcut(key: string): PlateOutcome | null {
  return (
    PLATE_OUTCOMES.find((outcome) => outcome.key === key.trim().toLowerCase())
      ?.value ?? null
  );
}

type RunnerOrigin = Base | "BATTER";

export type PlateAppearanceDraft = {
  outcome: PlateOutcome;
  outcomes: Partial<Record<Base, RunnerOutcome>>;
  earnedRuns: Partial<Record<RunnerOrigin, EarnedRunClassification>>;
  rbiEligible: Partial<Record<RunnerOrigin, boolean>>;
  forceOuts: Partial<Record<RunnerOrigin, boolean>>;
  putoutFielderId: string | null;
  errorFielderId: string | null;
  battedBall: Extract<
    EventBody,
    { eventType: "PlateAppearanceRecorded" }
  >["payload"]["battedBall"];
};

export type PlateAppearancePreview = {
  body: Extract<EventBody, { eventType: "PlateAppearanceRecorded" }> | null;
  bases: GameState["bases"];
  outs: number;
  runs: number;
  inningEnded: boolean;
  errors: string[];
  announcements: string[];
};

const bases = ["FIRST", "SECOND", "THIRD"] as const;
const rank: Record<Base | "HOME" | "OUT" | "REMAINS", number> = {
  REMAINS: -1,
  FIRST: 1,
  SECOND: 2,
  THIRD: 3,
  HOME: 4,
  OUT: 5,
};

export function currentBatterId(state: GameState): string {
  const side = state.half === "TOP" ? "AWAY" : "HOME";
  const lineup = state.lineups[side]
    .filter(({ active, battingOrder }) => active && battingOrder !== null)
    .sort((left, right) => left.battingOrder! - right.battingOrder!);
  const batter =
    lineup[state.battingOrderIndex[side] % Math.max(lineup.length, 1)];
  return batter?.playerId ?? "";
}

export function nextBatterId(state: GameState): string {
  const side = state.half === "TOP" ? "AWAY" : "HOME";
  const lineup = state.lineups[side]
    .filter(({ active, battingOrder }) => active && battingOrder !== null)
    .sort((left, right) => left.battingOrder! - right.battingOrder!);
  const batter =
    lineup[(state.battingOrderIndex[side] + 1) % Math.max(lineup.length, 1)];
  return batter?.playerId ?? "";
}

export function defaultBattedBall(outcome: PlateOutcome) {
  if (outcome === "SACRIFICE_BUNT") return "BUNT" as const;
  if (outcome === "SACRIFICE_FLY" || outcome === "HOME_RUN") {
    return "FLY_BALL" as const;
  }
  if (
    outcome === "BATTER_OUT" ||
    outcome === "FIELDER_CHOICE" ||
    outcome === "REACHED_ON_ERROR"
  ) {
    return "GROUND_BALL" as const;
  }
  if (["SINGLE", "DOUBLE", "TRIPLE"].includes(outcome)) {
    return "LINE_DRIVE" as const;
  }
  return null;
}

export function defaultRunnerOutcomes(
  state: GameState,
  outcome: PlateOutcome,
): Partial<Record<Base, RunnerOutcome>> {
  const result: Partial<Record<Base, RunnerOutcome>> = {};
  for (const base of bases) {
    if (state.bases[base]) result[base] = "REMAINS";
  }
  if (
    outcome === "WALK" ||
    outcome === "INTENTIONAL_WALK" ||
    outcome === "HIT_BY_PITCH"
  ) {
    if (state.bases.FIRST) {
      result.FIRST = "SECOND";
      if (state.bases.SECOND) {
        result.SECOND = "THIRD";
        if (state.bases.THIRD) result.THIRD = "HOME";
      }
    }
  } else if (
    outcome === "SINGLE" ||
    outcome === "REACHED_ON_ERROR" ||
    outcome === "SACRIFICE_BUNT"
  ) {
    if (state.bases.FIRST) result.FIRST = "SECOND";
    if (state.bases.SECOND) result.SECOND = "THIRD";
    if (state.bases.THIRD) result.THIRD = "HOME";
  } else if (outcome === "FIELDER_CHOICE") {
    if (state.bases.FIRST) result.FIRST = "OUT";
  } else if (outcome === "DOUBLE") {
    if (state.bases.FIRST) result.FIRST = "THIRD";
    if (state.bases.SECOND) result.SECOND = "HOME";
    if (state.bases.THIRD) result.THIRD = "HOME";
  } else if (outcome === "TRIPLE" || outcome === "HOME_RUN") {
    for (const base of bases) {
      if (state.bases[base]) result[base] = "HOME";
    }
  } else if (outcome === "SACRIFICE_FLY" && state.bases.THIRD) {
    result.THIRD = "HOME";
  }
  return result;
}

export function createPlateAppearanceDraft(
  state: GameState,
  outcome: PlateOutcome,
): PlateAppearanceDraft {
  const outcomes = defaultRunnerOutcomes(state, outcome);
  const scoringOrigins = bases.filter((base) => outcomes[base] === "HOME");
  return {
    outcome,
    outcomes,
    earnedRuns: Object.fromEntries(
      scoringOrigins.map((base) => [base, "PENDING"]),
    ),
    rbiEligible: Object.fromEntries(
      scoringOrigins.map((base) => [
        base,
        !["REACHED_ON_ERROR", "FIELDER_CHOICE"].includes(outcome),
      ]),
    ),
    forceOuts:
      outcome === "FIELDER_CHOICE" && state.bases.FIRST ? { FIRST: true } : {},
    putoutFielderId: null,
    errorFielderId: null,
    battedBall: defaultBattedBall(outcome),
  };
}

function batterDestination(outcome: PlateOutcome): RunnerMovement["to"] {
  if (
    [
      "WALK",
      "INTENTIONAL_WALK",
      "HIT_BY_PITCH",
      "SINGLE",
      "FIELDER_CHOICE",
      "REACHED_ON_ERROR",
      "INTERFERENCE",
    ].includes(outcome)
  )
    return "FIRST";
  if (outcome === "DOUBLE") return "SECOND";
  if (outcome === "TRIPLE") return "THIRD";
  if (outcome === "HOME_RUN") return "HOME";
  return "OUT";
}

function isForcedAdvance(
  draft: PlateAppearanceDraft,
  from: Base,
  to: RunnerOutcome,
) {
  if (!["WALK", "INTENTIONAL_WALK", "HIT_BY_PITCH"].includes(draft.outcome)) {
    return false;
  }
  if (from === "FIRST") return to === "SECOND";
  if (from === "SECOND") {
    return to === "THIRD" && draft.outcomes.FIRST === "SECOND";
  }
  return to === "HOME" && draft.outcomes.SECOND === "THIRD";
}

function runnerCause(
  outcome: PlateOutcome,
  forced: boolean,
): RunnerMovement["cause"] {
  if (forced) return "FORCED_ADVANCE";
  if (["SINGLE", "DOUBLE", "TRIPLE", "HOME_RUN"].includes(outcome)) {
    return "OPTIONAL_ADVANCE";
  }
  if (outcome === "REACHED_ON_ERROR") return "ERROR";
  if (outcome === "FIELDER_CHOICE") return "FIELDERS_CHOICE";
  if (outcome === "SACRIFICE_BUNT" || outcome === "SACRIFICE_FLY") {
    return "SACRIFICE";
  }
  return "OPTIONAL_ADVANCE";
}

export function previewPlateAppearance(
  state: GameState,
  draft: PlateAppearanceDraft,
): PlateAppearancePreview {
  const errors: string[] = [];
  const batterId = currentBatterId(state);
  const fieldingSide = state.half === "TOP" ? "HOME" : "AWAY";
  const pitcherId = state.activePitcher[fieldingSide];
  const movements: RunnerMovement[] = [];
  const destinations = new Set<Base>();
  let outOffset = 0;

  for (const from of bases) {
    const runnerId = state.bases[from];
    const outcome = draft.outcomes[from] ?? "REMAINS";
    if (!runnerId) {
      if (outcome !== "REMAINS") {
        errors.push(`There is no runner on ${from.toLowerCase()}.`);
      }
      continue;
    }
    if (outcome === "REMAINS") continue;
    if (outcome !== "OUT" && rank[outcome] <= rank[from]) {
      errors.push(`${runnerId} must move forward from ${from.toLowerCase()}.`);
      continue;
    }
    if (outcome === "FIRST" || outcome === "SECOND" || outcome === "THIRD") {
      if (destinations.has(outcome)) {
        errors.push(`Two runners cannot finish on ${outcome.toLowerCase()}.`);
      }
      destinations.add(outcome);
    }
    const responsiblePitcherId = state.runnerPitcherResponsibility[runnerId];
    if (!responsiblePitcherId) {
      errors.push(`Pitcher responsibility is missing for ${runnerId}.`);
      continue;
    }
    const forced = isForcedAdvance(draft, from, outcome);
    if (outcome === "OUT") outOffset += 1;
    movements.push({
      runnerId,
      from,
      to: outcome,
      cause: runnerCause(draft.outcome, forced),
      forced,
      responsiblePitcherId,
      ...(outcome === "HOME"
        ? {
            runCounts: true,
            rbiEligible:
              draft.rbiEligible[from] ??
              !["REACHED_ON_ERROR", "FIELDER_CHOICE"].includes(draft.outcome),
            earnedRun: draft.earnedRuns[from] ?? "PENDING",
          }
        : {}),
      ...(outcome === "OUT"
        ? {
            out: {
              outNumber: state.outs + outOffset,
              force: draft.forceOuts[from] ?? false,
              fielders: draft.putoutFielderId ? [draft.putoutFielderId] : [],
            },
          }
        : {}),
    });
  }

  const batterTo = batterDestination(draft.outcome);
  if (batterTo === "OUT") outOffset += 1;
  const batterForced =
    batterTo === "FIRST" &&
    ["WALK", "INTENTIONAL_WALK", "HIT_BY_PITCH"].includes(draft.outcome);
  const batterForceOut =
    draft.forceOuts.BATTER ??
    ((draft.outcome === "BATTER_OUT" && draft.battedBall === "GROUND_BALL") ||
      draft.outcome === "SACRIFICE_BUNT");
  const batterMovement: RunnerMovement = {
    runnerId: batterId,
    from: "BATTER",
    to: batterTo,
    cause: ["SINGLE", "DOUBLE", "TRIPLE", "HOME_RUN"].includes(draft.outcome)
      ? "HIT"
      : draft.outcome === "REACHED_ON_ERROR"
        ? "ERROR"
        : draft.outcome === "FIELDER_CHOICE"
          ? "FIELDERS_CHOICE"
          : batterForced
            ? "FORCED_ADVANCE"
            : draft.outcome === "SACRIFICE_BUNT" ||
                draft.outcome === "SACRIFICE_FLY"
              ? "SACRIFICE"
              : "BATTER_RESULT",
    forced: batterForced,
    responsiblePitcherId: pitcherId,
    ...(batterTo === "HOME"
      ? {
          runCounts: true,
          rbiEligible: draft.rbiEligible.BATTER ?? true,
          earnedRun: draft.earnedRuns.BATTER ?? "EARNED",
        }
      : {}),
    ...(batterTo === "OUT"
      ? {
          out: {
            outNumber: state.outs + outOffset,
            force: batterForceOut,
            fielders: draft.putoutFielderId ? [draft.putoutFielderId] : [],
          },
        }
      : {}),
  };
  movements.push(batterMovement);
  if (batterTo === "FIRST" || batterTo === "SECOND" || batterTo === "THIRD") {
    if (destinations.has(batterTo)) {
      errors.push(
        `The batter and another runner cannot both finish on ${batterTo.toLowerCase()}.`,
      );
    }
    destinations.add(batterTo);
  }

  if (!batterId || state.status !== "IN_PROGRESS") {
    errors.push("The authoritative game has no active batter.");
  }
  if (state.outs + outOffset > 3) {
    errors.push("A play cannot create a fourth out.");
  }
  if (outOffset > 0 && !draft.putoutFielderId) {
    errors.push("Select the fielder receiving the putout.");
  }
  if (draft.outcome === "REACHED_ON_ERROR" && !draft.errorFielderId) {
    errors.push("Select the fielder charged with the error.");
  }
  if (
    draft.outcome === "FIELDER_CHOICE" &&
    !movements.some(({ from, to }) => from !== "BATTER" && to === "OUT")
  ) {
    errors.push("Fielder’s choice requires a runner out.");
  }
  if (
    (draft.outcome === "SACRIFICE_BUNT" && draft.battedBall !== "BUNT") ||
    (draft.outcome === "SACRIFICE_FLY" && draft.battedBall !== "FLY_BALL")
  ) {
    errors.push("Sacrifice outcome and batted-ball type must agree.");
  }
  if (
    state.outs === 2 &&
    (draft.outcome === "SACRIFICE_BUNT" || draft.outcome === "SACRIFICE_FLY")
  ) {
    errors.push("A sacrifice cannot be recorded with two outs.");
  }

  const movingOrigins = new Set(
    movements
      .filter(({ from }) => from !== "BATTER")
      .map(({ from }) => from as Base),
  );
  for (const destination of destinations) {
    if (state.bases[destination] && !movingOrigins.has(destination)) {
      errors.push(
        `${destination.toLowerCase()} is occupied by a runner who is not moving.`,
      );
    }
  }
  const thirdOut = movements.find(({ out }) => out?.outNumber === 3)?.out;
  if (
    thirdOut?.force &&
    movements.some(({ to, runCounts }) => to === "HOME" && runCounts)
  ) {
    errors.push("A run cannot count when the third out is a force out.");
  }

  const afterBases = { ...state.bases };
  for (const movement of movements) {
    if (movement.from !== "BATTER") afterBases[movement.from] = null;
  }
  for (const movement of movements) {
    if (
      movement.to === "FIRST" ||
      movement.to === "SECOND" ||
      movement.to === "THIRD"
    ) {
      afterBases[movement.to] = movement.runnerId;
    }
  }
  const originalRanks = new Map<string, number>([[batterId, 0]]);
  for (const [base, runnerId] of Object.entries(state.bases)) {
    if (runnerId) originalRanks.set(runnerId, rank[base as Base]);
  }
  const finalRanks = new Map<string, number>();
  for (const [base, runnerId] of Object.entries(afterBases)) {
    if (runnerId) finalRanks.set(runnerId, rank[base as Base]);
  }
  for (const [trailingRunner, trailingOrigin] of originalRanks) {
    for (const [leadingRunner, leadingOrigin] of originalRanks) {
      const trailingFinal = finalRanks.get(trailingRunner);
      const leadingFinal = finalRanks.get(leadingRunner);
      if (
        trailingOrigin < leadingOrigin &&
        trailingFinal !== undefined &&
        leadingFinal !== undefined &&
        trailingFinal >= leadingFinal
      ) {
        errors.push("A runner cannot pass another runner.");
      }
    }
  }
  const inningEnded = state.outs + outOffset === 3;
  if (inningEnded) {
    afterBases.FIRST = null;
    afterBases.SECOND = null;
    afterBases.THIRD = null;
  }
  const runs = movements.filter(
    ({ to, runCounts }) => to === "HOME" && runCounts,
  ).length;
  const announcements = movements.map((movement) =>
    movement.to === "OUT"
      ? `${movement.runnerId} is out`
      : movement.to === "HOME"
        ? `${movement.runnerId} scored`
        : `${movement.runnerId} now on ${movement.to.toLowerCase()}`,
  );
  announcements.push(
    inningEnded
      ? "Inning ended"
      : `Next batter after acceptance: ${nextBatterId(state)}`,
  );

  return {
    body:
      errors.length === 0
        ? {
            eventType: "PlateAppearanceRecorded",
            payload: {
              batterId,
              pitcherId,
              outcome: draft.outcome,
              battedBall: draft.battedBall,
              movements,
              fieldingCredits:
                draft.outcome === "REACHED_ON_ERROR" && draft.errorFielderId
                  ? [
                      {
                        fielderId: draft.errorFielderId,
                        credit: "ERROR",
                        errorType: "FIELDING",
                      },
                    ]
                  : [],
            },
          }
        : null,
    bases: afterBases,
    outs: inningEnded ? 0 : state.outs + outOffset,
    runs,
    inningEnded,
    errors: [...new Set(errors)],
    announcements,
  };
}
