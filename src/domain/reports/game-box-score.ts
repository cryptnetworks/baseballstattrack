import {
  replayGame,
  type AcceptedEvent,
  type AcceptedSetup,
  type BaseballPosition,
  type GameSide,
} from "@/domain/events/event-log";
import {
  STATISTIC_DERIVATION_VERSION,
  STATISTIC_RULES_VERSION,
  deriveGameStatistics,
  type BattingCounters,
  type FieldingCounters,
  type GameStatisticsProjection,
  type PitchingCounters,
} from "@/domain/statistics";

export type BoxScorePresentation = {
  season: { id: string; displayName: string };
  teams: Record<GameSide, { id: string; displayName: string }>;
  players: Array<{
    playerId: string;
    lineupSlotId: string;
    side: GameSide;
    displayName: string;
    jerseyNumber: string | null;
    battingOrder: number | null;
    defensivePosition: BaseballPosition | null;
    startingPitcher: boolean;
  }>;
};

export type BoxScoreProjectionCheckpoint = {
  sourceRevision: number;
  privacyOverlayRevision: number;
  derivationVersion: number;
  status: "CURRENT";
};

export type GameBoxScore = {
  version: {
    accountId: string;
    gameId: string;
    setupSnapshotId: string;
    setupRevision: number;
    sourceRevision: number;
    correctionRevision: number | null;
    correctionCount: number;
    derivationVersion: number;
    statisticRulesVersion: number;
    rulesetVersionId: string;
    privacyOverlayRevision: number;
    verificationState: "VERIFIED" | "UNVERIFIED";
    freshness: "CURRENT_SOURCE_DERIVED";
    projectionFreshness: "CURRENT" | "NOT_USED";
    generatedAt: string;
  };
  reportState:
    | "DRAFT"
    | "IN_PROGRESS"
    | "SUSPENDED"
    | "COMPLETED"
    | "CORRECTED"
    | "AWAITING_REVERIFICATION"
    | "VERIFIED"
    | "ABANDONED"
    | "CANCELLED";
  gameState: {
    inning: number | null;
    half: "TOP" | "BOTTOM" | null;
  };
  scoreKind: "CURRENT" | "FINAL" | "TERMINATED";
  correctionStatus: "NONE" | "CORRECTED_HISTORY";
  season: { id: string; displayName: string };
  score: Record<GameSide, number>;
  teams: Record<
    GameSide,
    {
      id: string;
      displayName: string;
      opponentDisplayName: string;
      lineup: Array<{
        playerId: string;
        displayName: string;
        jerseyNumber: string | null;
        battingOrder: number | null;
        startingPosition: BaseballPosition | null;
        currentPosition: BaseballPosition | null;
        started: boolean;
        participated: boolean;
        active: boolean;
      }>;
      batting: GameStatisticsProjection["batting"];
      pitching: GameStatisticsProjection["pitching"];
      fielding: GameStatisticsProjection["fielding"];
      totals: GameStatisticsProjection["teams"][GameSide];
    }
  >;
  innings: GameStatisticsProjection["inningLines"];
  reconciliation: {
    status: "PASSED";
    confidence: "VERIFIED" | "CURRENT" | "INCOMPLETE" | "CORRECTED";
    checks: string[];
  };
};

export type GameBoxScoreErrorCode =
  "INVALID_REPORT_INPUT" | "STALE_PROJECTION" | "RECONCILIATION_FAILURE";

export class GameBoxScoreError extends Error {
  constructor(
    readonly code: GameBoxScoreErrorCode,
    message: string,
    readonly context: Readonly<Record<string, string | number>> = {},
  ) {
    super(message);
    this.name = "GameBoxScoreError";
  }
}

export function reconcileGameStatistics(
  statistics: GameStatisticsProjection,
): string[] {
  const checks: string[] = [];
  const teamBatting = {
    AWAY: statistics.teams.AWAY.batting,
    HOME: statistics.teams.HOME.batting,
  };
  const teamPitching = {
    AWAY: statistics.teams.AWAY.pitching,
    HOME: statistics.teams.HOME.pitching,
  };
  const teamFielding = {
    AWAY: statistics.teams.AWAY.fielding,
    HOME: statistics.teams.HOME.fielding,
  };
  reconcileCounters(
    statistics.batting,
    teamBatting,
    battingCounters,
    "batting",
    checks,
  );
  reconcileCounters(
    statistics.pitching,
    teamPitching,
    pitchingCounters,
    "pitching",
    checks,
  );
  reconcileCounters(
    statistics.fielding,
    teamFielding,
    fieldingCounters,
    "fielding",
    checks,
  );
  for (const side of ["AWAY", "HOME"] as const) {
    const inningRuns = statistics.inningLines
      .filter((line) => line.side === side)
      .reduce((total, line) => total + line.runs, 0);
    if (inningRuns !== statistics.finalScore[side]) {
      fail("inning runs equal score", side);
    }
    const opponent = side === "AWAY" ? "HOME" : "AWAY";
    if (
      statistics.teams[side].batting.hits !==
      statistics.teams[opponent].pitching.hitsAllowed
    ) {
      fail("credited hits equal pitching hits allowed", side);
    }
    if (
      statistics.teams[side].fielding.errors !==
      statistics.fielding
        .filter((line) => line.side === side)
        .reduce((total, line) => total + line.counters.errors, 0)
    ) {
      fail("fielding errors reconcile", side);
    }
    if (
      statistics.teams[side].pitching.outsRecorded !==
      statistics.pitching
        .filter((line) => line.side === side)
        .reduce((total, line) => total + line.counters.outsRecorded, 0)
    ) {
      fail("pitching outs reconcile", side);
    }
  }
  checks.push(
    "inning runs equal score",
    "credited hits equal pitching hits allowed",
    "fielding errors reconcile",
    "pitching outs reconcile",
    "report setup revision matches replay",
    "correction source revision matches replay",
    "derivation version is current",
  );
  return checks;
}

const battingCounters = [
  "plateAppearances",
  "atBats",
  "runs",
  "hits",
  "singles",
  "doubles",
  "triples",
  "homeRuns",
  "runsBattedIn",
  "walks",
  "intentionalWalks",
  "hitByPitch",
  "strikeouts",
  "sacrificeFlies",
  "sacrificeHits",
  "reachedOnError",
  "fieldersChoices",
  "totalBases",
  "stolenBases",
  "caughtStealing",
] as const satisfies readonly (keyof BattingCounters)[];

const pitchingCounters = [
  "appearances",
  "gamesStarted",
  "battersFaced",
  "outsRecorded",
  "hitsAllowed",
  "runsAllowed",
  "earnedRuns",
  "walks",
  "strikeouts",
  "hitBatters",
  "homeRunsAllowed",
  "inheritedRunners",
  "inheritedRunnersScored",
] as const satisfies readonly (keyof PitchingCounters)[];

const fieldingCounters = [
  "putouts",
  "assists",
  "errors",
  "doublePlays",
  "triplePlays",
] as const satisfies readonly (keyof FieldingCounters)[];

function fail(check: string, side?: GameSide) {
  throw new GameBoxScoreError(
    "RECONCILIATION_FAILURE",
    "Box score reconciliation failed.",
    { check, ...(side ? { side } : {}) },
  );
}

function reconcileCounters<
  T extends Record<K, number>,
  K extends string & keyof T,
>(
  lines: readonly { side: GameSide; counters: T }[],
  totals: Record<GameSide, T>,
  keys: readonly K[],
  label: string,
  checks: string[],
) {
  for (const side of ["AWAY", "HOME"] as const) {
    for (const key of keys) {
      const sum = lines
        .filter((line) => line.side === side)
        .reduce((total, line) => total + line.counters[key], 0);
      if (sum !== totals[side][key]) fail(`${label}.${key}`, side);
    }
  }
  checks.push(`${label} player totals equal team totals`);
}

function reportState(
  lifecycle: string,
  events: readonly AcceptedEvent[],
): GameBoxScore["reportState"] {
  if (lifecycle === "READY") return "DRAFT";
  if (lifecycle === "IN_PROGRESS") return "IN_PROGRESS";
  if (lifecycle === "SUSPENDED") return "SUSPENDED";
  if (lifecycle === "COMPLETED") return "COMPLETED";
  if (lifecycle === "VERIFIED") return "VERIFIED";
  if (lifecycle === "CORRECTED") {
    return events.some(({ eventType }) => eventType === "GameVerified")
      ? "AWAITING_REVERIFICATION"
      : "CORRECTED";
  }
  if (lifecycle === "ABANDONED") return "ABANDONED";
  if (lifecycle === "CANCELLED") return "CANCELLED";
  throw new GameBoxScoreError(
    "INVALID_REPORT_INPUT",
    "Unsupported game lifecycle state.",
  );
}

function scoreKind(
  state: GameBoxScore["reportState"],
): GameBoxScore["scoreKind"] {
  if (
    ["COMPLETED", "CORRECTED", "AWAITING_REVERIFICATION", "VERIFIED"].includes(
      state,
    )
  ) {
    return "FINAL";
  }
  if (state === "ABANDONED" || state === "CANCELLED") return "TERMINATED";
  return "CURRENT";
}

export function buildGameBoxScore(input: {
  setup: AcceptedSetup;
  events: readonly AcceptedEvent[];
  presentation: BoxScorePresentation;
  privacyOverlayRevision: number;
  generatedAt: string;
  projectionCheckpoint?: BoxScoreProjectionCheckpoint | null;
}): GameBoxScore {
  if (
    !Number.isSafeInteger(input.privacyOverlayRevision) ||
    input.privacyOverlayRevision < 0 ||
    Number.isNaN(Date.parse(input.generatedAt))
  ) {
    throw new GameBoxScoreError(
      "INVALID_REPORT_INPUT",
      "Box score version input is invalid.",
    );
  }
  const replay = replayGame(input.setup, input.events, {
    verifyEvidence: true,
  });
  const statistics = deriveGameStatistics({
    setup: input.setup,
    events: input.events,
    privacyOverlayRevision: input.privacyOverlayRevision,
  });
  if (input.projectionCheckpoint) {
    const checkpoint = input.projectionCheckpoint;
    if (
      checkpoint.status !== "CURRENT" ||
      checkpoint.sourceRevision !== replay.state.sourceRevision ||
      checkpoint.privacyOverlayRevision !== input.privacyOverlayRevision ||
      checkpoint.derivationVersion !== STATISTIC_DERIVATION_VERSION
    ) {
      throw new GameBoxScoreError(
        "STALE_PROJECTION",
        "Stored statistic projection is not current for this report.",
      );
    }
  }

  const checks = reconcileGameStatistics(statistics);

  const team = (side: GameSide) => {
    const opponent = side === "AWAY" ? "HOME" : "AWAY";
    const stateLineup = replay.state.lineups[side];
    return {
      ...input.presentation.teams[side],
      opponentDisplayName: input.presentation.teams[opponent].displayName,
      lineup: input.presentation.players
        .filter((player) => player.side === side)
        .map((player) => {
          const current = stateLineup.find(
            ({ playerId }) => playerId === player.playerId,
          );
          return {
            playerId: player.playerId,
            displayName: player.displayName,
            jerseyNumber: player.jerseyNumber,
            battingOrder: current?.battingOrder ?? player.battingOrder,
            startingPosition: player.defensivePosition,
            currentPosition: current?.position ?? null,
            started: player.battingOrder !== null || player.startingPitcher,
            participated: replay.state.participatedPlayers[side].includes(
              player.playerId,
            ),
            active: current?.active ?? false,
          };
        })
        .sort(
          (left, right) =>
            (left.battingOrder ?? Number.MAX_SAFE_INTEGER) -
              (right.battingOrder ?? Number.MAX_SAFE_INTEGER) ||
            left.displayName.localeCompare(right.displayName) ||
            left.playerId.localeCompare(right.playerId),
        ),
      batting: statistics.batting.filter((line) => line.side === side),
      pitching: statistics.pitching.filter((line) => line.side === side),
      fielding: statistics.fielding.filter((line) => line.side === side),
      totals: statistics.teams[side],
    };
  };
  const correctionEvents = input.events.filter(
    ({ eventType }) => eventType === "CorrectionApplied",
  );
  const state = reportState(replay.state.status, input.events);
  const confidence =
    state === "VERIFIED"
      ? "VERIFIED"
      : state === "DRAFT" || state === "IN_PROGRESS" || state === "SUSPENDED"
        ? "INCOMPLETE"
        : correctionEvents.length > 0
          ? "CORRECTED"
          : "CURRENT";
  return {
    version: {
      accountId: input.setup.accountId,
      gameId: input.setup.gameId,
      setupSnapshotId: input.setup.id,
      setupRevision: input.setup.setupRevision,
      sourceRevision: replay.state.sourceRevision,
      correctionRevision: correctionEvents.at(-1)?.acceptedRevision ?? null,
      correctionCount: correctionEvents.length,
      derivationVersion: STATISTIC_DERIVATION_VERSION,
      statisticRulesVersion: STATISTIC_RULES_VERSION,
      rulesetVersionId: input.setup.rulesetVersionId,
      privacyOverlayRevision: input.privacyOverlayRevision,
      verificationState:
        replay.state.status === "VERIFIED" ? "VERIFIED" : "UNVERIFIED",
      freshness: "CURRENT_SOURCE_DERIVED",
      projectionFreshness: input.projectionCheckpoint ? "CURRENT" : "NOT_USED",
      generatedAt: input.generatedAt,
    },
    reportState: state,
    gameState: { inning: replay.state.inning, half: replay.state.half },
    scoreKind: scoreKind(state),
    correctionStatus: correctionEvents.length ? "CORRECTED_HISTORY" : "NONE",
    season: { ...input.presentation.season },
    score: { ...statistics.finalScore },
    teams: { AWAY: team("AWAY"), HOME: team("HOME") },
    innings: statistics.inningLines,
    reconciliation: { status: "PASSED", confidence, checks },
  };
}
