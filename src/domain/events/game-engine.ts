import {
  EVENT_SCHEMA_VERSION,
  GameEventError,
  REDUCER_VERSION,
  parseEventBody,
  stateHash,
  type AcceptedEvent,
  type AcceptedSetup,
  type Base,
  type EventBody,
  type GameSide,
  type GameState,
  type LineupEntry,
  type RunnerMovement,
} from "./game-events";

const cloneLineup = (lineup: readonly LineupEntry[]): LineupEntry[] =>
  lineup.map((entry) => ({ ...entry }));

function validateSetupSide(
  setup: AcceptedSetup,
  side: GameSide,
): LineupEntry[] {
  const lineup = cloneLineup(setup.sides[side].lineup);
  const activePlayers = lineup.filter((entry) => entry.active);
  const batters = activePlayers
    .filter((entry) => entry.battingOrder !== null)
    .sort((left, right) => left.battingOrder! - right.battingOrder!);
  const positions = activePlayers
    .map(({ position: value }) => value)
    .filter((value) => value !== null);
  if (
    activePlayers.length === 0 ||
    new Set(lineup.map((entry) => entry.playerId)).size !== lineup.length ||
    new Set(positions).size !== positions.length ||
    batters.some((entry, index) => entry.battingOrder !== index + 1) ||
    !activePlayers.some(
      (entry) =>
        entry.playerId === setup.sides[side].startingPitcherId &&
        entry.position === "PITCHER",
    )
  ) {
    throw new GameEventError("INVALID_LINEUP", "Setup lineup is invalid.");
  }
  return lineup;
}

export function createInitialState(setup: AcceptedSetup): GameState {
  if (
    setup.status !== "READY" ||
    setup.setupRevision < 1 ||
    setup.scheduledInnings < 1
  ) {
    throw new GameEventError("SETUP_NOT_READY", "Accepted setup is not ready.");
  }

  const home = validateSetupSide(setup, "HOME");
  const away = validateSetupSide(setup, "AWAY");
  if (
    new Set([...home, ...away].map(({ playerId }) => playerId)).size !==
    home.length + away.length
  ) {
    throw new GameEventError(
      "INVALID_LINEUP",
      "A player cannot appear on both game sides.",
    );
  }
  const defenseFor = (lineup: LineupEntry[]) =>
    Object.fromEntries(
      lineup
        .filter(
          (
            entry,
          ): entry is LineupEntry & {
            position: NonNullable<LineupEntry["position"]>;
          } => entry.active && entry.position !== null,
        )
        .map((entry) => [entry.position, entry.playerId]),
    );

  return {
    accountId: setup.accountId,
    gameId: setup.gameId,
    setupSnapshotId: setup.id,
    setupRevision: setup.setupRevision,
    rulesetVersionId: setup.rulesetVersionId,
    scheduledInnings: setup.scheduledInnings,
    status: "READY",
    inning: null,
    half: null,
    outs: 0,
    score: { HOME: 0, AWAY: 0 },
    bases: { FIRST: null, SECOND: null, THIRD: null },
    battingOrderIndex: { HOME: 0, AWAY: 0 },
    lineups: { HOME: home, AWAY: away },
    participatedPlayers: {
      HOME: home.filter(({ active }) => active).map(({ playerId }) => playerId),
      AWAY: away.filter(({ active }) => active).map(({ playerId }) => playerId),
    },
    defense: { HOME: defenseFor(home), AWAY: defenseFor(away) },
    activePitcher: {
      HOME: setup.sides.HOME.startingPitcherId,
      AWAY: setup.sides.AWAY.startingPitcherId,
    },
    runnerPitcherResponsibility: {},
    sourceRevision: 0,
    lastSequence: 0,
  };
}

const battingSide = (state: GameState): GameSide =>
  state.half === "TOP" ? "AWAY" : "HOME";
const fieldingSide = (state: GameState): GameSide =>
  battingSide(state) === "HOME" ? "AWAY" : "HOME";

function activeBatters(state: GameState, side: GameSide): LineupEntry[] {
  return state.lineups[side]
    .filter((entry) => entry.active && entry.battingOrder !== null)
    .sort((left, right) => left.battingOrder! - right.battingOrder!);
}

function currentBatter(state: GameState): string {
  const side = battingSide(state);
  const lineup = activeBatters(state, side);
  const batter = lineup[state.battingOrderIndex[side] % lineup.length];
  if (!batter) {
    throw new GameEventError(
      "INTERNAL_INVARIANT_FAILURE",
      "Active batting order is empty.",
    );
  }
  return batter.playerId;
}

function requireLive(state: GameState): void {
  if (state.status !== "IN_PROGRESS") {
    throw new GameEventError(
      "INVALID_LIFECYCLE_TRANSITION",
      "Scoring requires an in-progress game.",
      { status: state.status },
    );
  }
}

function finishOuts(state: GameState, outs: number): void {
  if (outs < 0 || state.outs + outs > 3) {
    throw new GameEventError(
      "INVALID_BASEBALL_TRANSITION",
      "A play cannot produce an impossible out count.",
    );
  }
  state.outs += outs;
  if (state.outs === 3) {
    state.outs = 0;
    state.bases = { FIRST: null, SECOND: null, THIRD: null };
    state.runnerPitcherResponsibility = {};
    if (state.half === "TOP") state.half = "BOTTOM";
    else {
      state.half = "TOP";
      state.inning = (state.inning ?? 0) + 1;
    }
  }
}

const baseRank: Record<"BATTER" | Base | "HOME", number> = {
  BATTER: 0,
  FIRST: 1,
  SECOND: 2,
  THIRD: 3,
  HOME: 4,
};

function applyMovements(
  state: GameState,
  movements: readonly RunnerMovement[],
): number {
  const runners = movements.map(({ runnerId }) => runnerId);
  const origins = movements
    .filter(({ from }) => from !== "BATTER")
    .map(({ from }) => from);
  const destinations = movements
    .filter(
      (movement): movement is RunnerMovement & { to: Base } =>
        movement.to === "FIRST" ||
        movement.to === "SECOND" ||
        movement.to === "THIRD",
    )
    .map(({ to }) => to);
  if (
    new Set(runners).size !== runners.length ||
    new Set(origins).size !== origins.length ||
    new Set(destinations).size !== destinations.length
  ) {
    throw new GameEventError(
      "INVALID_RUNNER_MOVEMENT",
      "A play contains duplicate runner movement.",
    );
  }

  const beforeBases = { ...state.bases };
  const freedBases = new Set<Base>();
  for (const movement of movements) {
    if (
      movement.to !== "OUT" &&
      baseRank[movement.to] <= baseRank[movement.from]
    ) {
      throw new GameEventError(
        "INVALID_RUNNER_MOVEMENT",
        "A runner movement must advance.",
      );
    }
    if (movement.from === "BATTER") {
      if (
        movement.responsiblePitcherId !==
        state.activePitcher[fieldingSide(state)]
      ) {
        throw new GameEventError(
          "INVALID_PITCHER",
          "Batter-runner responsibility is assigned to the wrong pitcher.",
        );
      }
    } else {
      if (
        beforeBases[movement.from] !== movement.runnerId ||
        state.runnerPitcherResponsibility[movement.runnerId] !==
          movement.responsiblePitcherId
      ) {
        throw new GameEventError(
          "INVALID_RUNNER_MOVEMENT",
          "Runner origin or pitcher responsibility is invalid.",
        );
      }
      freedBases.add(movement.from);
    }
    if (
      movement.to === "OUT" &&
      movement.out!.fielders.some(
        (fielderId) =>
          !Object.values(state.defense[fieldingSide(state)]).includes(
            fielderId,
          ),
      )
    ) {
      throw new GameEventError(
        "INVALID_LINEUP",
        "Out credit references an inactive defender.",
      );
    }
  }
  for (const destination of destinations) {
    if (beforeBases[destination] !== null && !freedBases.has(destination)) {
      throw new GameEventError(
        "INVALID_RUNNER_MOVEMENT",
        "Runner destination is occupied.",
      );
    }
  }

  const outs = movements.filter(({ to }) => to === "OUT");
  const expectedOutNumbers = outs.map((_, index) => state.outs + index + 1);
  const recordedOutNumbers = outs
    .map(({ out }) => out!.outNumber)
    .sort((left, right) => left - right);
  if (
    recordedOutNumbers.some(
      (outNumber, index) => outNumber !== expectedOutNumbers[index],
    )
  ) {
    throw new GameEventError(
      "INVALID_BASEBALL_TRANSITION",
      "Recorded out order is inconsistent with game state.",
    );
  }

  for (const origin of freedBases) state.bases[origin] = null;
  for (const movement of movements) {
    if (movement.to === "HOME") {
      if (movement.runCounts) state.score[battingSide(state)] += 1;
      delete state.runnerPitcherResponsibility[movement.runnerId];
    } else if (movement.to === "OUT") {
      delete state.runnerPitcherResponsibility[movement.runnerId];
    } else {
      state.bases[movement.to] = movement.runnerId;
      state.runnerPitcherResponsibility[movement.runnerId] =
        movement.responsiblePitcherId;
    }
  }
  const originalRanks = new Map<string, number>();
  for (const [occupiedBase, runnerId] of Object.entries(beforeBases)) {
    if (runnerId !== null) {
      originalRanks.set(runnerId, baseRank[occupiedBase as Base]);
    }
  }
  for (const movement of movements) {
    if (movement.from === "BATTER") originalRanks.set(movement.runnerId, 0);
  }
  const finalRanks = new Map<string, number>();
  for (const [occupiedBase, runnerId] of Object.entries(state.bases)) {
    if (runnerId !== null) {
      finalRanks.set(runnerId, baseRank[occupiedBase as Base]);
    }
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
        throw new GameEventError(
          "INVALID_RUNNER_MOVEMENT",
          "A runner cannot pass another runner.",
        );
      }
    }
  }
  return outs.length;
}

function validateBatterResolution(
  outcome: Extract<
    EventBody,
    { eventType: "PlateAppearanceRecorded" }
  >["payload"]["outcome"],
  destination: RunnerMovement["to"],
): void {
  const expected: Record<typeof outcome, RunnerMovement["to"]> = {
    WALK: "FIRST",
    INTENTIONAL_WALK: "FIRST",
    HIT_BY_PITCH: "FIRST",
    STRIKEOUT_SWINGING: "OUT",
    STRIKEOUT_LOOKING: "OUT",
    SINGLE: "FIRST",
    DOUBLE: "SECOND",
    TRIPLE: "THIRD",
    HOME_RUN: "HOME",
    BATTER_OUT: "OUT",
    FIELDER_CHOICE: "FIRST",
    REACHED_ON_ERROR: "FIRST",
    SACRIFICE_BUNT: "OUT",
    SACRIFICE_FLY: "OUT",
    INTERFERENCE: "FIRST",
  };
  if (destination !== expected[outcome]) {
    throw new GameEventError(
      "INVALID_RUNNER_MOVEMENT",
      "Batter movement contradicts the recorded outcome.",
    );
  }
}

function removeDefensivePlayer(
  state: GameState,
  side: GameSide,
  playerId: string,
) {
  for (const [position, assignedPlayerId] of Object.entries(
    state.defense[side],
  )) {
    if (assignedPlayerId === playerId) {
      delete state.defense[side][
        position as keyof (typeof state.defense)[GameSide]
      ];
    }
  }
}

function applyBody(state: GameState, body: EventBody): void {
  switch (body.eventType) {
    case "GameStarted":
      if (state.status !== "READY") {
        throw new GameEventError(
          "INVALID_LIFECYCLE_TRANSITION",
          "Only a ready game may start.",
        );
      }
      state.status = "IN_PROGRESS";
      state.inning = 1;
      state.half = "TOP";
      return;
    case "GameSuspended":
      requireLive(state);
      state.status = "SUSPENDED";
      return;
    case "GameResumed":
      if (state.status !== "SUSPENDED") {
        throw new GameEventError(
          "INVALID_LIFECYCLE_TRANSITION",
          "Only a suspended game may resume.",
        );
      }
      state.status = "IN_PROGRESS";
      return;
    case "GameCompleted": {
      requireLive(state);
      const inning = state.inning ?? 0;
      const regulationEnding =
        state.score.HOME !== state.score.AWAY &&
        ((inning > state.scheduledInnings && state.half === "TOP") ||
          (inning >= state.scheduledInnings &&
            state.half === "BOTTOM" &&
            state.score.HOME > state.score.AWAY));
      if (
        (body.payload.ending === "REGULATION" && !regulationEnding) ||
        (body.payload.ending === "WALK_OFF" &&
          (inning < state.scheduledInnings ||
            state.half !== "BOTTOM" ||
            state.score.HOME <= state.score.AWAY))
      ) {
        throw new GameEventError(
          "INVALID_BASEBALL_TRANSITION",
          "Game ending condition is not satisfied.",
        );
      }
      state.status = "COMPLETED";
      return;
    }
    case "GameVerified":
      if (state.status !== "COMPLETED" && state.status !== "CORRECTED") {
        throw new GameEventError(
          "INVALID_LIFECYCLE_TRANSITION",
          "Only completed or corrected games may be verified.",
        );
      }
      state.status = "VERIFIED";
      return;
    case "GameReopened":
      if (state.status !== "VERIFIED") {
        throw new GameEventError(
          "INVALID_LIFECYCLE_TRANSITION",
          "Only a verified game may be reopened.",
        );
      }
      state.status = "CORRECTED";
      return;
    case "GameAbandoned":
      if (
        !["IN_PROGRESS", "SUSPENDED", "COMPLETED", "CORRECTED"].includes(
          state.status,
        )
      ) {
        throw new GameEventError(
          "INVALID_LIFECYCLE_TRANSITION",
          "Game cannot be abandoned from its current state.",
        );
      }
      state.status = "ABANDONED";
      return;
    case "GameCancelled":
      if (state.status !== "READY") {
        throw new GameEventError(
          "INVALID_LIFECYCLE_TRANSITION",
          "Only an unstarted ready game may be cancelled.",
        );
      }
      state.status = "CANCELLED";
      return;
    case "PlateAppearanceRecorded": {
      requireLive(state);
      if (body.payload.batterId !== currentBatter(state)) {
        throw new GameEventError(
          "INVALID_LINEUP",
          "Plate appearance batter is out of turn.",
        );
      }
      if (body.payload.pitcherId !== state.activePitcher[fieldingSide(state)]) {
        throw new GameEventError(
          "INVALID_PITCHER",
          "Plate appearance pitcher is not active.",
        );
      }
      const activeDefenders = Object.values(state.defense[fieldingSide(state)]);
      if (
        body.payload.fieldingCredits.some(
          ({ fielderId }) => !activeDefenders.includes(fielderId),
        ) ||
        new Set(
          body.payload.fieldingCredits.map(
            ({ credit, fielderId }) => `${fielderId}\0${credit}`,
          ),
        ).size !== body.payload.fieldingCredits.length
      ) {
        throw new GameEventError(
          "INVALID_LINEUP",
          "Fielding credit references an invalid defender.",
        );
      }
      if (
        (body.payload.outcome === "SACRIFICE_BUNT" &&
          body.payload.battedBall !== "BUNT") ||
        (body.payload.outcome === "SACRIFICE_FLY" &&
          body.payload.battedBall !== "FLY_BALL")
      ) {
        throw new GameEventError(
          "INVALID_BASEBALL_TRANSITION",
          "Sacrifice classification contradicts batted-ball judgment.",
        );
      }
      const batterMovements = body.payload.movements.filter(
        (movement) => movement.from === "BATTER",
      );
      if (
        batterMovements.length !== 1 ||
        batterMovements[0]?.runnerId !== body.payload.batterId
      ) {
        throw new GameEventError(
          "INVALID_RUNNER_MOVEMENT",
          "Plate appearance must resolve the batter exactly once.",
        );
      }
      validateBatterResolution(body.payload.outcome, batterMovements[0].to);
      const outs = applyMovements(state, body.payload.movements);
      const side = battingSide(state);
      state.battingOrderIndex[side] += 1;
      finishOuts(state, outs);
      return;
    }
    case "RunnerAdvanceRecorded":
      requireLive(state);
      if (body.payload.from === "BATTER") {
        throw new GameEventError(
          "INVALID_RUNNER_MOVEMENT",
          "Standalone advances cannot originate from the batter.",
        );
      }
      finishOuts(state, applyMovements(state, [body.payload]));
      return;
    case "RunnerOutRecorded":
      requireLive(state);
      finishOuts(
        state,
        applyMovements(state, [
          {
            runnerId: body.payload.runnerId,
            from: body.payload.from,
            to: "OUT",
            cause:
              body.payload.cause === "CAUGHT_STEALING"
                ? "CAUGHT_STEALING"
                : body.payload.cause === "PICKOFF"
                  ? "PICKOFF"
                  : "FIELDERS_CHOICE",
            forced: body.payload.force,
            responsiblePitcherId: body.payload.responsiblePitcherId,
            out: {
              outNumber: body.payload.outNumber,
              force: body.payload.force,
              fielders: body.payload.fielders,
            },
          },
        ]),
      );
      return;
    case "StolenBaseAttemptRecorded":
      requireLive(state);
      finishOuts(
        state,
        applyMovements(state, [
          body.payload.result === "CAUGHT_STEALING"
            ? {
                runnerId: body.payload.runnerId,
                from: body.payload.from,
                to: "OUT",
                cause: "CAUGHT_STEALING",
                forced: false,
                responsiblePitcherId: body.payload.responsiblePitcherId,
                out: {
                  outNumber: state.outs + 1,
                  force: false,
                  fielders: body.payload.fielders,
                },
              }
            : {
                runnerId: body.payload.runnerId,
                from: body.payload.from,
                to: body.payload.to,
                cause: "STOLEN_BASE",
                forced: false,
                responsiblePitcherId: body.payload.responsiblePitcherId,
                ...(body.payload.to === "HOME"
                  ? { runCounts: true, rbiEligible: false }
                  : {}),
              },
        ]),
      );
      return;
    case "DefensiveSubstitutionMade": {
      requireLive(state);
      if (body.payload.side !== fieldingSide(state)) {
        throw new GameEventError(
          "INVALID_LINEUP",
          "Substitution must affect the fielding side.",
        );
      }
      const lineup = state.lineups[body.payload.side];
      const outgoing = lineup.find(
        (entry) =>
          entry.active && entry.playerId === body.payload.outgoingPlayerId,
      );
      const incoming = lineup.find(
        (entry) => entry.playerId === body.payload.incomingPlayerId,
      );
      if (
        !outgoing ||
        !incoming ||
        incoming.active ||
        outgoing.playerId === state.activePitcher[body.payload.side] ||
        body.payload.position === "PITCHER" ||
        state.participatedPlayers[body.payload.side].includes(incoming.playerId)
      ) {
        throw new GameEventError("INVALID_LINEUP", "Invalid substitution.");
      }
      removeDefensivePlayer(state, body.payload.side, outgoing.playerId);
      outgoing.active = false;
      outgoing.position = null;
      incoming.active = true;
      incoming.battingOrder = outgoing.battingOrder;
      incoming.position = body.payload.position;
      state.participatedPlayers[body.payload.side].push(incoming.playerId);
      state.defense[body.payload.side][body.payload.position] =
        incoming.playerId;
      return;
    }
    case "DefensiveAlignmentChanged": {
      requireLive(state);
      if (body.payload.side !== fieldingSide(state)) {
        throw new GameEventError(
          "INVALID_LINEUP",
          "Alignment must affect the fielding side.",
        );
      }
      const players = body.payload.assignments.map(({ playerId }) => playerId);
      const positions = body.payload.assignments.map(
        ({ position: value }) => value,
      );
      if (
        new Set(players).size !== players.length ||
        new Set(positions).size !== positions.length ||
        players.some(
          (playerId) =>
            !state.lineups[body.payload.side].some(
              (entry) => entry.active && entry.playerId === playerId,
            ),
        )
      ) {
        throw new GameEventError(
          "INVALID_LINEUP",
          "Invalid defensive alignment.",
        );
      }
      for (const playerId of players) {
        removeDefensivePlayer(state, body.payload.side, playerId);
      }
      for (const assignment of body.payload.assignments) {
        state.defense[body.payload.side][assignment.position] =
          assignment.playerId;
        const entry = state.lineups[body.payload.side].find(
          ({ playerId }) => playerId === assignment.playerId,
        )!;
        entry.position = assignment.position;
      }
      const assigned = Object.values(state.defense[body.payload.side]);
      if (
        new Set(assigned).size !== assigned.length ||
        state.defense[body.payload.side].PITCHER !==
          state.activePitcher[body.payload.side]
      ) {
        throw new GameEventError(
          "INVALID_LINEUP",
          "Defensive alignment duplicates a player.",
        );
      }
      return;
    }
    case "PitchingChangeMade": {
      requireLive(state);
      const occupiedRunners = Object.values(state.bases).filter(
        (runnerId): runnerId is string => runnerId !== null,
      );
      if (
        body.payload.side !== fieldingSide(state) ||
        state.activePitcher[body.payload.side] !==
          body.payload.outgoingPitcherId ||
        !state.lineups[body.payload.side].some(
          (entry) =>
            entry.active && entry.playerId === body.payload.incomingPitcherId,
        ) ||
        [...body.payload.inheritedRunnerIds].sort().join("\0") !==
          [...occupiedRunners].sort().join("\0")
      ) {
        throw new GameEventError("INVALID_PITCHER", "Invalid pitching change.");
      }
      removeDefensivePlayer(
        state,
        body.payload.side,
        body.payload.outgoingPitcherId,
      );
      state.activePitcher[body.payload.side] = body.payload.incomingPitcherId;
      state.defense[body.payload.side].PITCHER = body.payload.incomingPitcherId;
      for (const entry of state.lineups[body.payload.side]) {
        if (entry.playerId === body.payload.outgoingPitcherId) {
          entry.position = null;
        }
        if (entry.playerId === body.payload.incomingPitcherId) {
          entry.position = "PITCHER";
        }
      }
      return;
    }
    case "CorrectionApplied":
      if (
        state.status !== "IN_PROGRESS" &&
        state.status !== "COMPLETED" &&
        state.status !== "CORRECTED"
      ) {
        throw new GameEventError(
          "INVALID_LIFECYCLE_TRANSITION",
          "Correction requires an eligible game lifecycle state.",
        );
      }
      if (state.status !== "IN_PROGRESS") state.status = "CORRECTED";
      return;
  }
}

function validateEventIdentity(state: GameState, event: AcceptedEvent): void {
  if (event.schemaVersion !== EVENT_SCHEMA_VERSION) {
    throw new GameEventError(
      "UNSUPPORTED_SCHEMA_VERSION",
      "Unsupported event schema version.",
    );
  }
  if (event.accountId !== state.accountId) {
    throw new GameEventError(
      "ACCOUNT_MISMATCH",
      "Event Account does not match.",
    );
  }
  if (event.gameId !== state.gameId) {
    throw new GameEventError("GAME_MISMATCH", "Event game does not match.");
  }
  if (
    event.setupSnapshotId !== state.setupSnapshotId ||
    event.setupRevision !== state.setupRevision
  ) {
    throw new GameEventError(
      "SETUP_NOT_READY",
      "Event setup snapshot does not match.",
    );
  }
  if (event.rulesetVersionId !== state.rulesetVersionId) {
    throw new GameEventError(
      "INVALID_BASEBALL_TRANSITION",
      "Event ruleset version does not match.",
    );
  }
}

function validateNextEnvelope(state: GameState, event: AcceptedEvent): void {
  validateEventIdentity(state, event);
  if (
    event.expectedRevision !== state.sourceRevision ||
    event.acceptedRevision !== state.sourceRevision + 1
  ) {
    throw new GameEventError(
      "STALE_SOURCE_REVISION",
      "Event source revision is not contiguous.",
    );
  }
  if (event.sequence !== state.lastSequence + 1) {
    throw new GameEventError(
      "SEQUENCE_CONFLICT",
      "Event sequence is not contiguous.",
    );
  }
}

export function applyEvent(
  current: GameState,
  event: AcceptedEvent,
  options: { verifyEvidence?: boolean } = {},
): GameState {
  validateNextEnvelope(current, event);
  if (event.eventType === "CorrectionApplied") {
    throw new GameEventError(
      "CORRECTION_GRAPH_INVALID",
      "Corrections must be applied with their accepted history.",
    );
  }
  if (options.verifyEvidence && event.preStateHash !== stateHash(current)) {
    throw new GameEventError(
      "IMMUTABLE_HISTORY_VIOLATION",
      "Stored pre-state evidence does not match replay.",
    );
  }
  const next = structuredClone(current);
  applyBody(
    next,
    parseEventBody({ eventType: event.eventType, payload: event.payload }),
  );
  next.sourceRevision = event.acceptedRevision;
  next.lastSequence = event.sequence;
  if (options.verifyEvidence && event.postStateHash !== stateHash(next)) {
    throw new GameEventError(
      "IMMUTABLE_HISTORY_VIOLATION",
      "Stored post-state evidence does not match replay.",
    );
  }
  return next;
}

type CorrectionResolution = {
  suppressed: Set<string>;
  replacementsByTarget: Map<
    string,
    Extract<
      EventBody,
      { eventType: "CorrectionApplied" }
    >["payload"]["replacements"]
  >;
};

const replaceableEventTypes = new Set<AcceptedEvent["eventType"]>([
  "PlateAppearanceRecorded",
  "RunnerAdvanceRecorded",
  "RunnerOutRecorded",
  "StolenBaseAttemptRecorded",
  "DefensiveSubstitutionMade",
  "DefensiveAlignmentChanged",
  "PitchingChangeMade",
]);

function resolveCorrections(
  events: readonly AcceptedEvent[],
): CorrectionResolution {
  const ordered = [...events].sort(
    (left, right) => left.sequence - right.sequence,
  );
  const byId = new Map(ordered.map((event) => [event.id, event]));
  if (byId.size !== events.length) {
    throw new GameEventError(
      "CORRECTION_GRAPH_INVALID",
      "Duplicate accepted event identifier.",
    );
  }
  const suppressed = new Set<string>();
  const targetOwner = new Map<string, string>();
  const replacementsByTarget = new Map<
    string,
    Extract<
      EventBody,
      { eventType: "CorrectionApplied" }
    >["payload"]["replacements"]
  >();
  const replacementIds = new Set<string>();

  for (const event of [...ordered].reverse()) {
    if (event.eventType !== "CorrectionApplied" || suppressed.has(event.id)) {
      continue;
    }
    const body = parseEventBody({
      eventType: event.eventType,
      payload: event.payload,
    });
    if (body.eventType !== "CorrectionApplied") continue;
    for (const targetId of body.payload.targetEventIds) {
      const target = byId.get(targetId);
      if (!target) {
        throw new GameEventError(
          "CORRECTION_TARGET_MISSING",
          "Correction target is missing.",
        );
      }
      if (
        target.sequence >= event.sequence ||
        target.accountId !== event.accountId ||
        target.gameId !== event.gameId
      ) {
        throw new GameEventError(
          "CORRECTION_GRAPH_INVALID",
          "Correction target must be prior history in the same game.",
        );
      }
      if (
        target.eventType === "CorrectionApplied" &&
        body.payload.policy !== "REVERSE_EVENTS"
      ) {
        throw new GameEventError(
          "CORRECTION_GRAPH_INVALID",
          "A correction may supersede another correction only by reversal.",
        );
      }
      if (
        body.payload.policy !== "REVERSE_EVENTS" &&
        !replaceableEventTypes.has(target.eventType)
      ) {
        throw new GameEventError(
          "CORRECTION_GRAPH_INVALID",
          "Correction policy cannot replace this event type.",
        );
      }
      const owner = targetOwner.get(targetId);
      if (owner) {
        throw new GameEventError(
          "CORRECTION_GRAPH_INVALID",
          "Multiple active corrections target the same event.",
        );
      }
      targetOwner.set(targetId, event.id);
      suppressed.add(targetId);
    }
    if (body.payload.replacements.length > 0) {
      const insertionTarget = [...body.payload.targetEventIds]
        .map((targetId) => byId.get(targetId)!)
        .sort((left, right) => left.sequence - right.sequence)[0]!.id;
      for (const replacement of body.payload.replacements) {
        if (byId.has(replacement.id) || replacementIds.has(replacement.id)) {
          throw new GameEventError(
            "CORRECTION_GRAPH_INVALID",
            "Correction replacement identifier is not unique.",
          );
        }
        replacementIds.add(replacement.id);
      }
      replacementsByTarget.set(
        insertionTarget,
        [...body.payload.replacements].sort(
          (left, right) => left.order - right.order,
        ),
      );
    }
  }
  return { suppressed, replacementsByTarget };
}

export function resolveEffectiveEvents(
  events: readonly AcceptedEvent[],
): AcceptedEvent[] {
  const { suppressed } = resolveCorrections(events);
  return [...events]
    .sort((left, right) => left.sequence - right.sequence)
    .filter((event) => !suppressed.has(event.id));
}

function replayEffective(
  setup: AcceptedSetup,
  events: readonly AcceptedEvent[],
): GameState {
  const ordered = [...events].sort(
    (left, right) => left.sequence - right.sequence,
  );
  const { suppressed, replacementsByTarget } = resolveCorrections(ordered);
  const state = createInitialState(setup);
  for (const event of ordered) {
    validateNextEnvelope(state, event);
    const replacements = replacementsByTarget.get(event.id) ?? [];
    for (const replacement of replacements) {
      applyBody(state, replacement.body);
    }
    if (!suppressed.has(event.id)) {
      applyBody(
        state,
        parseEventBody({ eventType: event.eventType, payload: event.payload }),
      );
    }
    state.sourceRevision = event.acceptedRevision;
    state.lastSequence = event.sequence;
  }
  return state;
}

export function deriveEventStates(
  setup: AcceptedSetup,
  history: readonly AcceptedEvent[],
  proposed: AcceptedEvent,
): { before: GameState; after: GameState } {
  const before = replayEffective(setup, history);
  validateNextEnvelope(before, proposed);
  const after = replayEffective(setup, [...history, proposed]);
  return { before, after };
}

export function replayGame(
  setup: AcceptedSetup,
  events: readonly AcceptedEvent[],
  options: { verifyEvidence?: boolean } = {},
) {
  const ordered = [...events].sort(
    (left, right) => left.sequence - right.sequence,
  );
  if (options.verifyEvidence) {
    for (let index = 0; index < ordered.length; index += 1) {
      const event = ordered[index]!;
      const { before, after } = deriveEventStates(
        setup,
        ordered.slice(0, index),
        event,
      );
      if (
        event.preStateHash !== stateHash(before) ||
        event.postStateHash !== stateHash(after)
      ) {
        throw new GameEventError(
          "IMMUTABLE_HISTORY_VIOLATION",
          "Stored state evidence does not match replay.",
        );
      }
    }
  }
  const state = replayEffective(setup, ordered);
  return {
    state,
    metadata: {
      accountId: setup.accountId,
      gameId: setup.gameId,
      setupSnapshotId: setup.id,
      setupRevision: setup.setupRevision,
      finalSourceRevision: state.sourceRevision,
      eventCount: events.length,
      effectiveEventCount: resolveEffectiveEvents(events).length,
      correctionCount: events.filter(
        (event) => event.eventType === "CorrectionApplied",
      ).length,
      rulesetVersionId: setup.rulesetVersionId,
      reducerVersion: REDUCER_VERSION,
      verificationStatus:
        state.status === "VERIFIED" ? "VERIFIED" : "UNVERIFIED",
    },
  };
}
