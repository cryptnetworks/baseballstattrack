import type {
  Base,
  EarnedRunClassification,
  EventBody,
  GameState,
  RunnerMovement,
} from "@/domain/events/event-log";

export const RUNNER_PLAY_TYPES = [
  "OPTIONAL_ADVANCE",
  "ERROR",
  "STOLEN_BASE",
  "CAUGHT_STEALING",
  "PICKOFF",
  "RUNNER_OUT",
  "WILD_PITCH",
  "PASSED_BALL",
] as const;

export type RunnerPlayType = (typeof RUNNER_PLAY_TYPES)[number];
export type RunnerOutcome = Base | "HOME" | "OUT" | "REMAINS";

export type RunnerPlayDraft = {
  playType: RunnerPlayType;
  outcomes: Partial<Record<Base, RunnerOutcome>>;
  earnedRuns: Partial<Record<Base, EarnedRunClassification>>;
  outFielderIds: string[];
  errorFielderId: string | null;
};

export type RunnerPlayPreview = {
  body: Extract<EventBody, { eventType: "RunnerPlayRecorded" }> | null;
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

const causeFor = (playType: RunnerPlayType): RunnerMovement["cause"] => {
  const causes = {
    OPTIONAL_ADVANCE: "OPTIONAL_ADVANCE",
    ERROR: "ERROR",
    STOLEN_BASE: "STOLEN_BASE",
    CAUGHT_STEALING: "CAUGHT_STEALING",
    PICKOFF: "PICKOFF",
    RUNNER_OUT: "RUNNER_OUT",
    WILD_PITCH: "WILD_PITCH",
    PASSED_BALL: "PASSED_BALL",
  } as const;
  return causes[playType];
};

export function previewRunnerPlay(
  state: GameState,
  draft: RunnerPlayDraft,
): RunnerPlayPreview {
  const errors: string[] = [];
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
    if (
      outcome === "OUT" &&
      draft.playType !== "CAUGHT_STEALING" &&
      draft.playType !== "PICKOFF" &&
      draft.playType !== "RUNNER_OUT"
    ) {
      errors.push("Choose caught stealing or pickoff to retire a runner.");
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
    if (outcome === "OUT") outOffset += 1;
    movements.push({
      runnerId,
      from,
      to: outcome,
      cause: causeFor(draft.playType),
      forced: false,
      responsiblePitcherId,
      ...(outcome === "HOME"
        ? {
            runCounts: true,
            rbiEligible: false,
            earnedRun: draft.earnedRuns[from] ?? "PENDING",
          }
        : {}),
      ...(outcome === "OUT"
        ? {
            out: {
              outNumber: state.outs + outOffset,
              force: false,
              fielders: draft.outFielderIds,
            },
          }
        : {}),
    });
  }

  if (movements.length === 0) {
    errors.push("Change at least one runner outcome.");
  }
  if (state.outs + outOffset > 3) {
    errors.push("A play cannot create a fourth out.");
  }
  if (
    (draft.playType === "CAUGHT_STEALING" || draft.playType === "PICKOFF") &&
    outOffset !== 1
  ) {
    errors.push("This play requires exactly one runner out.");
  }
  if (draft.playType === "RUNNER_OUT" && outOffset === 0) {
    errors.push("This play requires at least one runner out.");
  }
  if (outOffset > 0 && draft.outFielderIds.length === 0) {
    errors.push("Select at least one fielder for the out.");
  }
  if (draft.playType === "ERROR" && !draft.errorFielderId) {
    errors.push("Select the fielder charged with the error.");
  }

  const movingOrigins = new Set(
    movements
      .filter(({ from }) => from !== "BATTER")
      .map(({ from }) => from as Base),
  );
  for (const destination of destinations) {
    if (state.bases[destination] !== null && !movingOrigins.has(destination)) {
      errors.push(
        `${destination.toLowerCase()} is occupied by a runner who is not moving.`,
      );
    }
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
  if (outOffset > 0) {
    announcements.push(
      inningEnded
        ? "Inning ended"
        : `${state.outs + outOffset} ${state.outs + outOffset === 1 ? "out" : "outs"}`,
    );
  }

  return {
    body:
      errors.length === 0
        ? {
            eventType: "RunnerPlayRecorded",
            payload: {
              playType: draft.playType,
              movements,
              fieldingCredits:
                draft.playType === "ERROR" && draft.errorFielderId
                  ? [
                      {
                        fielderId: draft.errorFielderId,
                        credit: "ERROR",
                        errorType: "FIELDING",
                      },
                    ]
                  : [],
              responsibleFielderId:
                draft.playType === "PASSED_BALL"
                  ? (state.defense[state.half === "TOP" ? "HOME" : "AWAY"]
                      .CATCHER ?? null)
                  : null,
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
