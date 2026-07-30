import {
  GameEventError,
  previewEventBody,
  type BaseballPosition,
  type EventBody,
  type GameSide,
  type GameState,
} from "@/domain/events/event-log";

export const BASEBALL_POSITIONS = [
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
] as const satisfies readonly BaseballPosition[];

export type LiveLineupChangeBody = Extract<
  EventBody,
  {
    eventType:
      | "DefensiveSubstitutionMade"
      | "DefensiveAlignmentChanged"
      | "PitchingChangeMade";
  }
>;

export type LineupChangePreview = {
  body: LiveLineupChangeBody | null;
  nextState: GameState | null;
  errors: string[];
  warnings: string[];
  label: string;
};

export const battingSide = (state: GameState): GameSide =>
  state.half === "TOP" ? "AWAY" : "HOME";

export const fieldingSide = (state: GameState): GameSide =>
  battingSide(state) === "HOME" ? "AWAY" : "HOME";

export function positionLabel(position: BaseballPosition | null) {
  return position
    ? position.replaceAll("_", " ").toLowerCase()
    : "no defensive position";
}

function rejected(
  error: unknown,
  warnings: string[] = [],
): LineupChangePreview {
  return {
    body: null,
    nextState: null,
    errors: [
      error instanceof GameEventError
        ? error.message
        : "The proposed lineup change is invalid.",
    ],
    warnings,
    label: "Invalid lineup change",
  };
}

export function substitutionRole(
  state: GameState,
  side: GameSide,
  outgoingPlayerId: string,
) {
  const battingOrder = state.lineups[side]
    .filter(({ active, battingOrder }) => active && battingOrder !== null)
    .sort((left, right) => left.battingOrder! - right.battingOrder!);
  const currentBatter =
    side === battingSide(state)
      ? battingOrder[
          state.battingOrderIndex[side] % Math.max(battingOrder.length, 1)
        ]?.playerId
      : null;
  if (Object.values(state.bases).includes(outgoingPlayerId)) {
    return "Pinch runner";
  }
  if (currentBatter === outgoingPlayerId) return "Pinch hitter";
  return side === fieldingSide(state)
    ? "Defensive replacement"
    : "Batting substitution";
}

export function previewSubstitution(
  state: GameState,
  input: {
    side: GameSide;
    outgoingPlayerId: string;
    incomingPlayerId: string;
    position: BaseballPosition;
  },
): LineupChangePreview {
  const role = substitutionRole(state, input.side, input.outgoingPlayerId);
  const warnings = [
    `${role} is permanent under the current no-reentry ruleset.`,
  ];
  const body = {
    eventType: "DefensiveSubstitutionMade",
    payload: input,
  } as const satisfies LiveLineupChangeBody;
  try {
    return {
      body,
      nextState: previewEventBody(state, body),
      errors: [],
      warnings,
      label: role,
    };
  } catch (error) {
    return rejected(error, warnings);
  }
}

export function previewAlignmentSwap(
  state: GameState,
  input: {
    side: GameSide;
    firstPlayerId: string;
    secondPlayerId: string;
  },
): LineupChangePreview {
  const first = state.lineups[input.side].find(
    ({ playerId }) => playerId === input.firstPlayerId,
  );
  const second = state.lineups[input.side].find(
    ({ playerId }) => playerId === input.secondPlayerId,
  );
  if (
    !first?.active ||
    !second?.active ||
    !first.position ||
    !second.position ||
    first.playerId === second.playerId
  ) {
    return rejected(new Error("Select two active defenders."));
  }
  const body = {
    eventType: "DefensiveAlignmentChanged",
    payload: {
      side: input.side,
      assignments: [
        { playerId: first.playerId, position: second.position },
        { playerId: second.playerId, position: first.position },
      ],
      reasonCode: "POSITION_SWAP",
    },
  } as const satisfies LiveLineupChangeBody;
  try {
    return {
      body,
      nextState: previewEventBody(state, body),
      errors: [],
      warnings: [
        "This changes defensive positions only; batting order is unchanged.",
      ],
      label: "Position swap",
    };
  } catch (error) {
    return rejected(error);
  }
}

export function previewPitchingChange(
  state: GameState,
  incomingPitcherId: string,
): LineupChangePreview {
  const side = fieldingSide(state);
  const outgoingPitcherId = state.activePitcher[side];
  const inheritedRunnerIds = Object.values(state.bases).filter(
    (runnerId): runnerId is string => runnerId !== null,
  );
  const body = {
    eventType: "PitchingChangeMade",
    payload: {
      side,
      outgoingPitcherId,
      incomingPitcherId,
      inheritedRunnerIds,
    },
  } as const satisfies LiveLineupChangeBody;
  const warnings =
    inheritedRunnerIds.length > 0
      ? [
          `${inheritedRunnerIds.length} inherited runner${
            inheritedRunnerIds.length === 1 ? "" : "s"
          } remain charged to the outgoing pitcher.`,
        ]
      : ["The new pitching appearance begins with no inherited runners."];
  try {
    return {
      body,
      nextState: previewEventBody(state, body),
      errors: [],
      warnings,
      label: "Pitching change",
    };
  } catch (error) {
    return rejected(error, warnings);
  }
}
