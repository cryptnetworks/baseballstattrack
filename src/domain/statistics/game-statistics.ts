import {
  GameEventError,
  replayGameTimeline,
  type AcceptedEvent,
  type AcceptedSetup,
  type EffectiveReplayStep,
  type EventBody,
  type GameSide,
  type RunnerMovement,
} from "@/domain/events/event-log";

import {
  StatisticDerivationError,
  addExactRates,
  exactRate,
  type ExactRate,
} from "./statistic-values";

export const STATISTIC_DERIVATION_VERSION = 2 as const;
export const STATISTIC_RULES_VERSION = 1 as const;

export type BattingCounters = {
  plateAppearances: number;
  atBats: number;
  runs: number;
  hits: number;
  singles: number;
  doubles: number;
  triples: number;
  homeRuns: number;
  runsBattedIn: number;
  walks: number;
  intentionalWalks: number;
  hitByPitch: number;
  strikeouts: number;
  sacrificeFlies: number;
  sacrificeHits: number;
  reachedOnError: number;
  fieldersChoices: number;
  totalBases: number;
  stolenBases: number;
  caughtStealing: number;
};

export type BattingRates = {
  battingAverage: ExactRate | null;
  onBasePercentage: ExactRate | null;
  sluggingPercentage: ExactRate | null;
  onBasePlusSlugging: ExactRate | null;
};

export type PitchingCounters = {
  appearances: number;
  gamesStarted: number;
  battersFaced: number;
  outsRecorded: number;
  hitsAllowed: number;
  runsAllowed: number;
  earnedRuns: number;
  walks: number;
  strikeouts: number;
  hitBatters: number;
  homeRunsAllowed: number;
  inheritedRunners: number;
  inheritedRunnersScored: number;
};

export type PitchingRates = {
  earnedRunAverage: ExactRate | null;
  walksAndHitsPerInningPitched: ExactRate | null;
};

export type FieldingCounters = {
  putouts: number;
  assists: number;
  errors: number;
  doublePlays: number;
  triplePlays: number;
};

export type FieldingRates = {
  chances: number;
  fieldingPercentage: ExactRate | null;
};

export type PlayerBattingLine = {
  playerId: string;
  side: GameSide;
  counters: BattingCounters;
  rates: BattingRates;
};

export type PlayerPitchingLine = {
  playerId: string;
  side: GameSide;
  counters: PitchingCounters;
  rates: PitchingRates;
};

export type PlayerFieldingLine = {
  playerId: string;
  side: GameSide;
  counters: FieldingCounters;
  rates: FieldingRates;
};

export type TeamStatistics = {
  side: GameSide;
  batting: BattingCounters & BattingRates;
  pitching: PitchingCounters & PitchingRates;
  fielding: FieldingCounters & FieldingRates;
};

export type InningLine = {
  inning: number;
  side: GameSide;
  runs: number;
};

export type GameStatisticsProjection = {
  metadata: {
    accountId: string;
    gameId: string;
    setupSnapshotId: string;
    setupRevision: number;
    sourceRevision: number;
    privacyOverlayRevision: number;
    rulesetVersionId: string;
    eventSchemaVersions: number[];
    derivationVersion: typeof STATISTIC_DERIVATION_VERSION;
    statisticRulesVersion: typeof STATISTIC_RULES_VERSION;
    lifecycleStatus: string;
    verificationStatus: "VERIFIED" | "UNVERIFIED";
    seasonEligibility: "INCLUDED" | "EXCLUDED_UNVERIFIED";
  };
  outcome: "HOME_WIN" | "AWAY_WIN" | "TIE" | "UNDECIDED";
  finalScore: Record<GameSide, number>;
  inningLines: InningLine[];
  teams: Record<GameSide, TeamStatistics>;
  batting: PlayerBattingLine[];
  pitching: PlayerPitchingLine[];
  fielding: PlayerFieldingLine[];
};

export type DeriveGameStatisticsInput = {
  setup: AcceptedSetup;
  events: readonly AcceptedEvent[];
  privacyOverlayRevision?: number;
  statisticRulesVersion?: number;
};

const zeroBatting = (): BattingCounters => ({
  plateAppearances: 0,
  atBats: 0,
  runs: 0,
  hits: 0,
  singles: 0,
  doubles: 0,
  triples: 0,
  homeRuns: 0,
  runsBattedIn: 0,
  walks: 0,
  intentionalWalks: 0,
  hitByPitch: 0,
  strikeouts: 0,
  sacrificeFlies: 0,
  sacrificeHits: 0,
  reachedOnError: 0,
  fieldersChoices: 0,
  totalBases: 0,
  stolenBases: 0,
  caughtStealing: 0,
});

const zeroPitching = (): PitchingCounters => ({
  appearances: 0,
  gamesStarted: 0,
  battersFaced: 0,
  outsRecorded: 0,
  hitsAllowed: 0,
  runsAllowed: 0,
  earnedRuns: 0,
  walks: 0,
  strikeouts: 0,
  hitBatters: 0,
  homeRunsAllowed: 0,
  inheritedRunners: 0,
  inheritedRunnersScored: 0,
});

const zeroFielding = (): FieldingCounters => ({
  putouts: 0,
  assists: 0,
  errors: 0,
  doublePlays: 0,
  triplePlays: 0,
});

function validateCounters(
  counters: Record<string, number>,
  kind: string,
): void {
  for (const [counter, value] of Object.entries(counters)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new StatisticDerivationError(
        "IMPOSSIBLE_COUNTER_STATE",
        `${kind} counter must be a nonnegative safe integer.`,
        { counter, value },
      );
    }
  }
}

export function deriveBattingRates(counters: BattingCounters): BattingRates {
  validateCounters(counters, "Batting");
  const hitComponents =
    counters.singles + counters.doubles + counters.triples + counters.homeRuns;
  const expectedTotalBases =
    counters.singles +
    counters.doubles * 2 +
    counters.triples * 3 +
    counters.homeRuns * 4;
  const minimumPlateAppearances =
    counters.atBats +
    counters.walks +
    counters.hitByPitch +
    counters.sacrificeFlies +
    counters.sacrificeHits;
  if (
    counters.hits !== hitComponents ||
    counters.totalBases !== expectedTotalBases ||
    counters.hits > counters.atBats ||
    counters.intentionalWalks > counters.walks ||
    counters.strikeouts > counters.atBats ||
    counters.reachedOnError + counters.fieldersChoices > counters.atBats ||
    counters.plateAppearances < minimumPlateAppearances
  ) {
    throw new StatisticDerivationError(
      "IMPOSSIBLE_COUNTER_STATE",
      "Batting counters violate a derivation invariant.",
    );
  }
  const onBaseDenominator =
    counters.atBats +
    counters.walks +
    counters.hitByPitch +
    counters.sacrificeFlies;
  const onBasePercentage = exactRate(
    counters.hits + counters.walks + counters.hitByPitch,
    onBaseDenominator,
  );
  const sluggingPercentage = exactRate(counters.totalBases, counters.atBats);
  return {
    battingAverage: exactRate(counters.hits, counters.atBats),
    onBasePercentage,
    sluggingPercentage,
    onBasePlusSlugging: addExactRates(onBasePercentage, sluggingPercentage),
  };
}

export function derivePitchingRates(counters: PitchingCounters): PitchingRates {
  validateCounters(counters, "Pitching");
  if (
    counters.earnedRuns > counters.runsAllowed ||
    counters.homeRunsAllowed > counters.hitsAllowed ||
    counters.inheritedRunnersScored > counters.inheritedRunners ||
    counters.gamesStarted > counters.appearances
  ) {
    throw new StatisticDerivationError(
      "IMPOSSIBLE_COUNTER_STATE",
      "Pitching counters violate a derivation invariant.",
    );
  }
  return {
    earnedRunAverage: exactRate(
      counters.earnedRuns * 27,
      counters.outsRecorded,
    ),
    walksAndHitsPerInningPitched: exactRate(
      (counters.walks + counters.hitsAllowed) * 3,
      counters.outsRecorded,
    ),
  };
}

export function deriveFieldingRates(counters: FieldingCounters): FieldingRates {
  validateCounters(counters, "Fielding");
  const chances = counters.putouts + counters.assists + counters.errors;
  return {
    chances,
    fieldingPercentage: exactRate(counters.putouts + counters.assists, chances),
  };
}

const opposite = (side: GameSide): GameSide =>
  side === "HOME" ? "AWAY" : "HOME";

function battingSide(step: EffectiveReplayStep): GameSide {
  if (step.before.half === "TOP") return "AWAY";
  if (step.before.half === "BOTTOM") return "HOME";
  throw new StatisticDerivationError(
    "INCOMPLETE_REPLAY_STATE",
    "A scoring event has no active half inning.",
    { sequence: step.sequence },
  );
}

function increment(target: Record<string, number>, key: string): void {
  target[key] = (target[key] ?? 0) + 1;
}

function playerSideIndex(setup: AcceptedSetup): Map<string, GameSide> {
  const index = new Map<string, GameSide>();
  for (const side of ["AWAY", "HOME"] as const) {
    for (const { playerId } of setup.sides[side].lineup) {
      if (index.has(playerId)) {
        throw new StatisticDerivationError(
          "MISSING_ATTRIBUTION",
          "A player appears on both game sides.",
          { playerId },
        );
      }
      index.set(playerId, side);
    }
  }
  return index;
}

function requirePlayerSide(
  index: Map<string, GameSide>,
  playerId: string,
  expectedSide?: GameSide,
): GameSide {
  const side = index.get(playerId);
  if (!side || (expectedSide !== undefined && side !== expectedSide)) {
    throw new StatisticDerivationError(
      "MISSING_ATTRIBUTION",
      "Statistic attribution references an unknown or opposing player.",
      { playerId },
    );
  }
  return side;
}

function applyPlateOutcome(
  body: Extract<EventBody, { eventType: "PlateAppearanceRecorded" }>,
  batter: BattingCounters,
  pitcher: PitchingCounters,
): void {
  const outcome = body.payload.outcome;
  if (outcome === "INTERFERENCE") {
    throw new StatisticDerivationError(
      "UNSUPPORTED_RULESET",
      "Schema version 2 does not distinguish the interference type needed for deterministic OBP treatment.",
    );
  }
  batter.plateAppearances += 1;
  pitcher.battersFaced += 1;

  const noAtBat = new Set([
    "WALK",
    "INTENTIONAL_WALK",
    "HIT_BY_PITCH",
    "SACRIFICE_BUNT",
    "SACRIFICE_FLY",
  ]);
  if (!noAtBat.has(outcome)) batter.atBats += 1;

  const bases = {
    SINGLE: 1,
    DOUBLE: 2,
    TRIPLE: 3,
    HOME_RUN: 4,
  } as const;
  if (outcome in bases) {
    const totalBases = bases[outcome as keyof typeof bases];
    batter.hits += 1;
    batter.totalBases += totalBases;
    pitcher.hitsAllowed += 1;
    if (outcome === "SINGLE") batter.singles += 1;
    if (outcome === "DOUBLE") batter.doubles += 1;
    if (outcome === "TRIPLE") batter.triples += 1;
    if (outcome === "HOME_RUN") {
      batter.homeRuns += 1;
      pitcher.homeRunsAllowed += 1;
    }
  }
  if (outcome === "WALK" || outcome === "INTENTIONAL_WALK") {
    batter.walks += 1;
    pitcher.walks += 1;
  }
  if (outcome === "INTENTIONAL_WALK") batter.intentionalWalks += 1;
  if (outcome === "HIT_BY_PITCH") {
    batter.hitByPitch += 1;
    pitcher.hitBatters += 1;
  }
  if (outcome === "STRIKEOUT_SWINGING" || outcome === "STRIKEOUT_LOOKING") {
    batter.strikeouts += 1;
    pitcher.strikeouts += 1;
  }
  if (outcome === "SACRIFICE_FLY") batter.sacrificeFlies += 1;
  if (outcome === "SACRIFICE_BUNT") batter.sacrificeHits += 1;
  if (outcome === "REACHED_ON_ERROR") batter.reachedOnError += 1;
  if (outcome === "FIELDER_CHOICE") batter.fieldersChoices += 1;
}

function assertEarnedRun(
  movement: Pick<RunnerMovement, "earnedRun">,
  schemaVersion: number,
  context: Record<string, string | number>,
): "EARNED" | "UNEARNED" {
  if (movement.earnedRun === "PENDING") {
    throw new StatisticDerivationError(
      "INCOMPLETE_REPLAY_STATE",
      "A counting run still has pending earned-run classification.",
      context,
    );
  }
  if (movement.earnedRun !== "EARNED" && movement.earnedRun !== "UNEARNED") {
    throw new StatisticDerivationError(
      schemaVersion === 1 ? "UNSUPPORTED_EVENT_VERSION" : "MISSING_ATTRIBUTION",
      schemaVersion === 1
        ? "Event schema version 1 scoring history lacks exact earned-run classification."
        : "A counting run is missing earned-run classification.",
      context,
    );
  }
  return movement.earnedRun;
}

function creditOutPath(
  fielders: readonly string[],
  side: GameSide,
  playerSides: Map<string, GameSide>,
  fieldingFor: (playerId: string, side: GameSide) => FieldingCounters,
): string[] {
  if (fielders.length === 0) {
    throw new StatisticDerivationError(
      "MISSING_ATTRIBUTION",
      "An out is missing explicit fielding attribution.",
    );
  }
  const unique = [...new Set(fielders)];
  for (const fielderId of unique) {
    requirePlayerSide(playerSides, fielderId, side);
  }
  const putout = fielders.at(-1)!;
  fieldingFor(putout, side).putouts += 1;
  for (const fielderId of [...new Set(fielders.slice(0, -1))]) {
    if (fielderId !== putout) fieldingFor(fielderId, side).assists += 1;
  }
  return unique;
}

function scoringOutcome(
  status: string,
  score: Record<GameSide, number>,
): GameStatisticsProjection["outcome"] {
  if (!["COMPLETED", "VERIFIED", "CORRECTED"].includes(status)) {
    return "UNDECIDED";
  }
  if (score.HOME === score.AWAY) return "TIE";
  return score.HOME > score.AWAY ? "HOME_WIN" : "AWAY_WIN";
}

function sumCounters<T extends Record<string, number>>(
  values: readonly T[],
  zero: () => T,
): T {
  const total: Record<string, number> = zero();
  for (const value of values) {
    for (const key of Object.keys(total)) {
      total[key] = (total[key] ?? 0) + (value[key] ?? 0);
    }
  }
  return total as T;
}

function assertEqual(
  actual: number,
  expected: number,
  invariant: string,
  side: GameSide,
): void {
  if (actual !== expected) {
    throw new StatisticDerivationError(
      "RECONCILIATION_FAILURE",
      `Statistic reconciliation failed: ${invariant}.`,
      { side, actual, expected },
    );
  }
}

export function deriveGameStatistics(
  input: DeriveGameStatisticsInput,
): GameStatisticsProjection {
  if (
    (input.statisticRulesVersion ?? STATISTIC_RULES_VERSION) !==
    STATISTIC_RULES_VERSION
  ) {
    throw new StatisticDerivationError(
      "UNSUPPORTED_RULESET",
      "Unsupported statistic rules version.",
    );
  }
  const privacyOverlayRevision = input.privacyOverlayRevision ?? 0;
  if (
    !Number.isSafeInteger(privacyOverlayRevision) ||
    privacyOverlayRevision < 0
  ) {
    throw new StatisticDerivationError(
      "IMPOSSIBLE_COUNTER_STATE",
      "Privacy-overlay revision must be a nonnegative safe integer.",
    );
  }

  let replay: ReturnType<typeof replayGameTimeline>;
  try {
    replay = replayGameTimeline(input.setup, input.events);
  } catch (error) {
    if (error instanceof GameEventError) {
      const correctionCodes = new Set([
        "CORRECTION_TARGET_MISSING",
        "CORRECTION_GRAPH_INVALID",
      ]);
      throw new StatisticDerivationError(
        correctionCodes.has(error.code)
          ? "INVALID_CORRECTION_GRAPH"
          : error.code === "ACCOUNT_MISMATCH"
            ? "ACCOUNT_MISMATCH"
            : error.code === "UNSUPPORTED_SCHEMA_VERSION"
              ? "UNSUPPORTED_EVENT_VERSION"
              : error.code === "UNSUPPORTED_EVENT_TYPE"
                ? "UNSUPPORTED_EVENT_TYPE"
                : "INCOMPLETE_REPLAY_STATE",
        "Authoritative event replay failed before statistic derivation.",
        error.context,
      );
    }
    throw error;
  }

  const playerSides = playerSideIndex(input.setup);
  const batting = new Map<string, BattingCounters>();
  const pitching = new Map<string, PitchingCounters>();
  const fielding = new Map<string, FieldingCounters>();
  const battingFor = (playerId: string, side: GameSide) => {
    requirePlayerSide(playerSides, playerId, side);
    let counters = batting.get(playerId);
    if (!counters) {
      counters = zeroBatting();
      batting.set(playerId, counters);
    }
    return counters;
  };
  const pitchingFor = (playerId: string, side: GameSide) => {
    requirePlayerSide(playerSides, playerId, side);
    let counters = pitching.get(playerId);
    if (!counters) {
      counters = zeroPitching();
      pitching.set(playerId, counters);
    }
    return counters;
  };
  const fieldingFor = (playerId: string, side: GameSide) => {
    requirePlayerSide(playerSides, playerId, side);
    let counters = fielding.get(playerId);
    if (!counters) {
      counters = zeroFielding();
      fielding.set(playerId, counters);
    }
    return counters;
  };
  const inningRuns: Record<string, number> = {};

  const recordInning = (step: EffectiveReplayStep, side: GameSide) => {
    const inning = step.before.inning;
    if (inning === null) {
      throw new StatisticDerivationError(
        "INCOMPLETE_REPLAY_STATE",
        "A scoring fact has no inning attribution.",
      );
    }
    const key = `${inning}:${side}`;
    if (inningRuns[key] === undefined) inningRuns[key] = 0;
    return { inning, key };
  };

  const applyCountingRun = (
    step: EffectiveReplayStep,
    movement: RunnerMovement,
    side: GameSide,
    batterId: string | null,
  ) => {
    if (movement.to !== "HOME" || movement.runCounts !== true) return;
    const classification = assertEarnedRun(movement, step.schemaVersion, {
      sequence: step.sequence,
      runnerId: movement.runnerId,
    });
    requirePlayerSide(playerSides, movement.runnerId, side);
    battingFor(movement.runnerId, side).runs += 1;
    const pitcherSide = opposite(side);
    const responsible = pitchingFor(movement.responsiblePitcherId, pitcherSide);
    responsible.runsAllowed += 1;
    if (classification === "EARNED") responsible.earnedRuns += 1;
    const activePitcher = step.before.activePitcher[pitcherSide];
    if (activePitcher !== movement.responsiblePitcherId) {
      pitchingFor(activePitcher, pitcherSide).inheritedRunnersScored += 1;
    }
    if (movement.rbiEligible) {
      if (batterId === null) {
        throw new StatisticDerivationError(
          "MISSING_ATTRIBUTION",
          "A standalone scoring movement cannot award an RBI without a batter reference.",
          { sequence: step.sequence },
        );
      }
      battingFor(batterId, side).runsBattedIn += 1;
    }
    const { key } = recordInning(step, side);
    increment(inningRuns, key);
  };

  for (const step of replay.steps) {
    const body = step.body;
    switch (body.eventType) {
      case "GameStarted":
        for (const side of ["AWAY", "HOME"] as const) {
          const pitcherId = input.setup.sides[side].startingPitcherId;
          const counters = pitchingFor(pitcherId, side);
          counters.appearances += 1;
          counters.gamesStarted += 1;
        }
        break;
      case "PlateAppearanceRecorded": {
        const side = battingSide(step);
        const defense = opposite(side);
        recordInning(step, side);
        const batter = battingFor(body.payload.batterId, side);
        const pitcher = pitchingFor(body.payload.pitcherId, defense);
        applyPlateOutcome(body, batter, pitcher);
        for (const movement of body.payload.movements) {
          applyCountingRun(step, movement, side, body.payload.batterId);
        }
        const outs = body.payload.movements.filter(
          (movement) => movement.to === "OUT",
        );
        pitcher.outsRecorded += outs.length;

        const participants = new Set<string>();
        if (body.payload.fieldingCredits.length > 0) {
          for (const credit of body.payload.fieldingCredits) {
            const counters = fieldingFor(credit.fielderId, defense);
            if (credit.credit !== "ERROR") {
              participants.add(credit.fielderId);
            }
            if (credit.credit === "PUTOUT") counters.putouts += 1;
            if (credit.credit === "ASSIST") counters.assists += 1;
            if (credit.credit === "ERROR") counters.errors += 1;
          }
        } else {
          for (const movement of outs) {
            for (const fielderId of creditOutPath(
              movement.out!.fielders,
              defense,
              playerSides,
              fieldingFor,
            )) {
              participants.add(fielderId);
            }
          }
        }
        if (outs.length === 2 || outs.length === 3) {
          for (const playerId of participants) {
            const counters = fieldingFor(playerId, defense);
            if (outs.length === 2) counters.doublePlays += 1;
            else counters.triplePlays += 1;
          }
        }
        break;
      }
      case "RunnerAdvanceRecorded": {
        const side = battingSide(step);
        recordInning(step, side);
        applyCountingRun(step, body.payload, side, null);
        break;
      }
      case "RunnerOutRecorded": {
        const side = battingSide(step);
        const defense = opposite(side);
        recordInning(step, side);
        pitchingFor(step.before.activePitcher[defense], defense).outsRecorded +=
          1;
        creditOutPath(body.payload.fielders, defense, playerSides, fieldingFor);
        if (body.payload.cause === "CAUGHT_STEALING") {
          battingFor(body.payload.runnerId, side).caughtStealing += 1;
        }
        break;
      }
      case "StolenBaseAttemptRecorded": {
        const side = battingSide(step);
        const defense = opposite(side);
        recordInning(step, side);
        if (body.payload.result === "STOLEN_BASE") {
          battingFor(body.payload.runnerId, side).stolenBases += 1;
          if (body.payload.to === "HOME") {
            applyCountingRun(
              step,
              {
                runnerId: body.payload.runnerId,
                from: body.payload.from,
                to: "HOME",
                cause: "STOLEN_BASE",
                forced: false,
                responsiblePitcherId: body.payload.responsiblePitcherId,
                runCounts: true,
                rbiEligible: false,
                earnedRun: body.payload.earnedRun,
              },
              side,
              null,
            );
          }
        } else {
          battingFor(body.payload.runnerId, side).caughtStealing += 1;
          pitchingFor(
            step.before.activePitcher[defense],
            defense,
          ).outsRecorded += 1;
          creditOutPath(
            body.payload.fielders,
            defense,
            playerSides,
            fieldingFor,
          );
        }
        break;
      }
      case "RunnerPlayRecorded": {
        const side = battingSide(step);
        const defense = opposite(side);
        recordInning(step, side);
        for (const movement of body.payload.movements) {
          applyCountingRun(step, movement, side, null);
          if (body.payload.playType === "STOLEN_BASE") {
            battingFor(movement.runnerId, side).stolenBases += 1;
          }
          if (
            body.payload.playType === "CAUGHT_STEALING" &&
            movement.to === "OUT"
          ) {
            battingFor(movement.runnerId, side).caughtStealing += 1;
          }
        }
        const outs = body.payload.movements.filter(({ to }) => to === "OUT");
        pitchingFor(step.before.activePitcher[defense], defense).outsRecorded +=
          outs.length;
        if (body.payload.fieldingCredits.length > 0) {
          for (const credit of body.payload.fieldingCredits) {
            const counters = fieldingFor(credit.fielderId, defense);
            if (credit.credit === "PUTOUT") counters.putouts += 1;
            if (credit.credit === "ASSIST") counters.assists += 1;
            if (credit.credit === "ERROR") counters.errors += 1;
          }
        } else {
          for (const movement of outs) {
            creditOutPath(
              movement.out!.fielders,
              defense,
              playerSides,
              fieldingFor,
            );
          }
        }
        break;
      }
      case "PitchingChangeMade": {
        const counters = pitchingFor(
          body.payload.incomingPitcherId,
          body.payload.side,
        );
        counters.appearances += 1;
        counters.inheritedRunners += body.payload.inheritedRunnerIds.length;
        break;
      }
      case "CorrectionApplied":
      case "DefensiveSubstitutionMade":
      case "DefensiveAlignmentChanged":
      case "GameSuspended":
      case "GameResumed":
      case "GameCompleted":
      case "GameVerified":
      case "GameReopened":
      case "GameAbandoned":
      case "GameCancelled":
        break;
      default: {
        const exhaustive: never = body;
        throw new StatisticDerivationError(
          "UNSUPPORTED_EVENT_TYPE",
          "Unsupported effective event type.",
          { eventType: (exhaustive as EventBody).eventType },
        );
      }
    }
  }

  const battingLines = [...batting.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([playerId, counters]): PlayerBattingLine => ({
      playerId,
      side: requirePlayerSide(playerSides, playerId),
      counters,
      rates: deriveBattingRates(counters),
    }));
  const pitchingLines = [...pitching.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([playerId, counters]): PlayerPitchingLine => ({
      playerId,
      side: requirePlayerSide(playerSides, playerId),
      counters,
      rates: derivePitchingRates(counters),
    }));
  const fieldingLines = [...fielding.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([playerId, counters]): PlayerFieldingLine => ({
      playerId,
      side: requirePlayerSide(playerSides, playerId),
      counters,
      rates: deriveFieldingRates(counters),
    }));

  const team = (side: GameSide): TeamStatistics => {
    const battingCounters = sumCounters(
      battingLines
        .filter((line) => line.side === side)
        .map((line) => line.counters),
      zeroBatting,
    );
    const pitchingCounters = sumCounters(
      pitchingLines
        .filter((line) => line.side === side)
        .map((line) => line.counters),
      zeroPitching,
    );
    const fieldingCounters = sumCounters(
      fieldingLines
        .filter((line) => line.side === side)
        .map((line) => line.counters),
      zeroFielding,
    );
    return {
      side,
      batting: {
        ...battingCounters,
        ...deriveBattingRates(battingCounters),
      },
      pitching: {
        ...pitchingCounters,
        ...derivePitchingRates(pitchingCounters),
      },
      fielding: {
        ...fieldingCounters,
        ...deriveFieldingRates(fieldingCounters),
      },
    };
  };
  const teams = { AWAY: team("AWAY"), HOME: team("HOME") };

  for (const side of ["AWAY", "HOME"] as const) {
    const fieldingSide = opposite(side);
    assertEqual(
      teams[side].batting.runs,
      replay.state.score[side],
      "team batting runs equal replay score",
      side,
    );
    assertEqual(
      teams[side].batting.totalBases,
      teams[side].batting.singles +
        teams[side].batting.doubles * 2 +
        teams[side].batting.triples * 3 +
        teams[side].batting.homeRuns * 4,
      "total bases equal hit components",
      side,
    );
    const inningTotal = Object.entries(inningRuns)
      .filter(([key]) => key.endsWith(`:${side}`))
      .reduce((sum, [, runs]) => sum + runs, 0);
    assertEqual(
      inningTotal,
      replay.state.score[side],
      "inning runs equal final score",
      side,
    );
    const fieldingOuts = fieldingLines
      .filter((line) => line.side === fieldingSide)
      .reduce((sum, line) => sum + line.counters.putouts, 0);
    assertEqual(
      teams[fieldingSide].pitching.outsRecorded,
      fieldingOuts,
      "pitcher outs equal credited defensive putouts",
      fieldingSide,
    );
    assertEqual(
      teams[fieldingSide].pitching.hitsAllowed,
      teams[side].batting.hits,
      "pitcher hits allowed equal opponent batting hits",
      fieldingSide,
    );
    assertEqual(
      teams[fieldingSide].pitching.runsAllowed,
      teams[side].batting.runs,
      "pitcher runs allowed equal opponent batting runs",
      fieldingSide,
    );
  }

  const inningLines = Object.entries(inningRuns)
    .map(([key, runs]): InningLine => {
      const [inning, side] = key.split(":");
      return {
        inning: Number(inning),
        side: side as GameSide,
        runs,
      };
    })
    .sort(
      (left, right) =>
        left.inning - right.inning ||
        (left.side === "AWAY" ? -1 : right.side === "AWAY" ? 1 : 0),
    );
  const versions = [
    ...new Set(input.events.map(({ schemaVersion }) => schemaVersion)),
  ].sort((left, right) => left - right);
  const verified = replay.state.status === "VERIFIED";

  return {
    metadata: {
      accountId: input.setup.accountId,
      gameId: input.setup.gameId,
      setupSnapshotId: input.setup.id,
      setupRevision: input.setup.setupRevision,
      sourceRevision: replay.state.sourceRevision,
      privacyOverlayRevision,
      rulesetVersionId: input.setup.rulesetVersionId,
      eventSchemaVersions: versions,
      derivationVersion: STATISTIC_DERIVATION_VERSION,
      statisticRulesVersion: STATISTIC_RULES_VERSION,
      lifecycleStatus: replay.state.status,
      verificationStatus: verified ? "VERIFIED" : "UNVERIFIED",
      seasonEligibility: verified ? "INCLUDED" : "EXCLUDED_UNVERIFIED",
    },
    outcome: scoringOutcome(replay.state.status, replay.state.score),
    finalScore: { ...replay.state.score },
    inningLines,
    teams,
    batting: battingLines,
    pitching: pitchingLines,
    fielding: fieldingLines,
  };
}
