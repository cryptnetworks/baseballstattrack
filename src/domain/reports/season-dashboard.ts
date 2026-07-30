import {
  deriveSeasonStatistics,
  type GameStatisticsProjection,
  type SeasonStatisticsProjection,
} from "@/domain/statistics";
import type { ExactRate } from "@/domain/statistics/statistic-values";

export const DEFAULT_LEADERBOARD_MINIMUMS = Object.freeze({
  battingPlateAppearances: 10,
  pitchingOutsRecorded: 9,
  fieldingChances: 5,
});

export type LeaderboardMinimums = typeof DEFAULT_LEADERBOARD_MINIMUMS;

export type SeasonDashboardGame = {
  projection: GameStatisticsProjection;
  side: "HOME" | "AWAY";
  seasonId: string;
  teamId: string;
  setupSnapshotId: string;
  scheduledAt: string | null;
  opponentDisplayName: string;
  playerNames: Readonly<Record<string, string>>;
};

export type SeasonDashboardInput = {
  accountId: string;
  seasonId: string;
  seasonDisplayName: string;
  teamId: string;
  teamDisplayName: string;
  games: readonly SeasonDashboardGame[];
  minimums?: LeaderboardMinimums;
  dateFrom?: string | null;
  dateTo?: string | null;
};

export type SeasonLeaderboardEntry = {
  playerId: string;
  displayName: string;
  sampleSize: number;
  qualified: boolean;
  rate: ExactRate | null;
  counters: Record<string, number>;
};

export type SeasonDashboard = {
  version: {
    accountId: string;
    seasonId: string;
    teamId: string;
    derivationVersion: number;
    statisticRulesVersion: number;
    rulesetVersionIds: string[];
    sourceRevisions: Array<{ gameId: string; sourceRevision: number }>;
    privacyOverlayRevision: number;
    freshness: "CURRENT_SOURCE_DERIVED";
  };
  selection: {
    seasonDisplayName: string;
    teamDisplayName: string;
    dateFrom: string | null;
    dateTo: string | null;
  };
  inclusionPolicy: {
    official: "VERIFIED_ONLY";
    recentGames: "ALL_CURRENT_LIFECYCLES";
    trends: "VERIFIED_ONLY";
    minimums: LeaderboardMinimums;
  };
  record: {
    wins: number;
    losses: number;
    ties: number;
    incomplete: number;
    abandoned: number;
    cancelled: number;
    correctedAwaitingReverification: number;
  };
  statistics: SeasonStatisticsProjection;
  recentGames: Array<{
    gameId: string;
    setupSnapshotId: string;
    scheduledAt: string | null;
    opponentDisplayName: string;
    status: string;
    verificationState: "VERIFIED" | "UNVERIFIED";
    scoreFor: number;
    scoreAgainst: number;
    result: "WIN" | "LOSS" | "TIE" | "INCOMPLETE";
    sourceRevision: number;
  }>;
  leaders: {
    batting: SeasonLeaderboardEntry[];
    pitching: SeasonLeaderboardEntry[];
    fielding: SeasonLeaderboardEntry[];
  };
  trends: Array<{
    gameId: string;
    scheduledAt: string | null;
    runsScored: number;
    runsAllowed: number;
    result: "WIN" | "LOSS" | "TIE";
  }>;
  players: Array<{
    playerId: string;
    displayName: string;
    batting: SeasonStatisticsProjection["batting"][number] | null;
    pitching: SeasonStatisticsProjection["pitching"][number] | null;
    fielding: SeasonStatisticsProjection["fielding"][number] | null;
    sourceGames: Array<{
      gameId: string;
      setupSnapshotId: string;
      scheduledAt: string | null;
      verificationState: "VERIFIED" | "UNVERIFIED";
    }>;
  }>;
};

function validateMinimum(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a nonnegative safe integer.`);
  }
}

function parseDateBoundary(
  value: string | null | undefined,
  endOfDay = false,
): number | null {
  if (!value) return null;
  const parsed = Date.parse(
    endOfDay && /^\d{4}-\d{2}-\d{2}$/u.test(value)
      ? `${value}T23:59:59.999Z`
      : value,
  );
  if (Number.isNaN(parsed)) throw new Error("Invalid dashboard date filter.");
  return parsed;
}

function compareRate(
  left: ExactRate | null,
  right: ExactRate | null,
  direction: "ASC" | "DESC",
): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  const difference =
    left.numerator * right.denominator - right.numerator * left.denominator;
  return direction === "ASC" ? difference : -difference;
}

function displayName(
  games: readonly SeasonDashboardGame[],
  playerId: string,
): string {
  for (const game of [...games].sort((left, right) => {
    const leftRevision = left.projection.metadata.sourceRevision;
    const rightRevision = right.projection.metadata.sourceRevision;
    return rightRevision - leftRevision;
  })) {
    const name = game.playerNames[playerId];
    if (name) return name;
  }
  return "Player";
}

function outcomeFor(
  projection: GameStatisticsProjection,
  side: "HOME" | "AWAY",
): "WIN" | "LOSS" | "TIE" | "INCOMPLETE" {
  if (projection.metadata.verificationStatus !== "VERIFIED") {
    return "INCOMPLETE";
  }
  if (projection.outcome === "UNDECIDED") {
    throw new Error("A verified game cannot have an undecided outcome.");
  }
  if (projection.outcome === "TIE") return "TIE";
  if (
    (projection.outcome === "HOME_WIN" && side === "HOME") ||
    (projection.outcome === "AWAY_WIN" && side === "AWAY")
  ) {
    return "WIN";
  }
  return "LOSS";
}

function gameStatus(projection: GameStatisticsProjection): string {
  if (
    projection.metadata.lifecycleStatus === "CORRECTED" &&
    projection.metadata.verificationStatus !== "VERIFIED"
  ) {
    return "CORRECTED_AWAITING_REVERIFICATION";
  }
  return projection.metadata.lifecycleStatus;
}

export function buildSeasonDashboard(
  input: SeasonDashboardInput,
): SeasonDashboard {
  const minimums = input.minimums ?? DEFAULT_LEADERBOARD_MINIMUMS;
  validateMinimum(minimums.battingPlateAppearances, "Batting minimum");
  validateMinimum(minimums.pitchingOutsRecorded, "Pitching minimum");
  validateMinimum(minimums.fieldingChances, "Fielding minimum");
  const from = parseDateBoundary(input.dateFrom);
  const to = parseDateBoundary(input.dateTo, true);
  if (from !== null && to !== null && from > to) {
    throw new Error("Dashboard date range is inverted.");
  }

  const games = input.games.filter((game) => {
    if (game.scheduledAt === null) return from === null && to === null;
    const scheduled = Date.parse(game.scheduledAt);
    if (Number.isNaN(scheduled))
      throw new Error("Invalid scheduled game date.");
    return (
      (from === null || scheduled >= from) && (to === null || scheduled <= to)
    );
  });
  const statistics = deriveSeasonStatistics({
    accountId: input.accountId,
    seasonId: input.seasonId,
    teamId: input.teamId,
    games,
  });
  const verified = games.filter(
    ({ projection }) => projection.metadata.verificationStatus === "VERIFIED",
  );
  const latestPrivacyRevision = games.reduce(
    (revision, game) =>
      Math.max(revision, game.projection.metadata.privacyOverlayRevision),
    0,
  );
  if (
    games.some(
      ({ projection }) =>
        projection.metadata.privacyOverlayRevision !== latestPrivacyRevision,
    )
  ) {
    throw new Error("Dashboard presentation uses mixed privacy revisions.");
  }

  const recentGames = [...games]
    .sort(
      (left, right) =>
        (right.scheduledAt ?? "").localeCompare(left.scheduledAt ?? "") ||
        right.projection.metadata.gameId.localeCompare(
          left.projection.metadata.gameId,
        ),
    )
    .slice(0, 20)
    .map((game) => {
      const opponent = game.side === "HOME" ? "AWAY" : "HOME";
      return {
        gameId: game.projection.metadata.gameId,
        setupSnapshotId: game.setupSnapshotId,
        scheduledAt: game.scheduledAt,
        opponentDisplayName: game.opponentDisplayName,
        status: gameStatus(game.projection),
        verificationState: game.projection.metadata.verificationStatus,
        scoreFor: game.projection.finalScore[game.side],
        scoreAgainst: game.projection.finalScore[opponent],
        result: outcomeFor(game.projection, game.side),
        sourceRevision: game.projection.metadata.sourceRevision,
      };
    });

  const officialOutcomes = verified.map(({ projection, side }) =>
    outcomeFor(projection, side),
  );
  const record = {
    wins: officialOutcomes.filter((result) => result === "WIN").length,
    losses: officialOutcomes.filter((result) => result === "LOSS").length,
    ties: officialOutcomes.filter((result) => result === "TIE").length,
    incomplete: games.filter(({ projection }) =>
      ["READY", "IN_PROGRESS", "SUSPENDED", "COMPLETED"].includes(
        projection.metadata.lifecycleStatus,
      ),
    ).length,
    abandoned: games.filter(
      ({ projection }) => projection.metadata.lifecycleStatus === "ABANDONED",
    ).length,
    cancelled: games.filter(
      ({ projection }) => projection.metadata.lifecycleStatus === "CANCELLED",
    ).length,
    correctedAwaitingReverification: games.filter(
      ({ projection }) =>
        projection.metadata.lifecycleStatus === "CORRECTED" &&
        projection.metadata.verificationStatus !== "VERIFIED",
    ).length,
  };

  const batting = statistics.batting
    .map((line) => ({
      playerId: line.playerId,
      displayName: displayName(games, line.playerId),
      sampleSize: line.counters.plateAppearances,
      qualified:
        line.counters.plateAppearances >= minimums.battingPlateAppearances,
      rate: line.rates.battingAverage,
      counters: { ...line.counters },
    }))
    .filter(({ qualified }) => qualified)
    .sort(
      (left, right) =>
        compareRate(left.rate, right.rate, "DESC") ||
        right.sampleSize - left.sampleSize ||
        left.displayName.localeCompare(right.displayName) ||
        left.playerId.localeCompare(right.playerId),
    );
  const pitching = statistics.pitching
    .map((line) => ({
      playerId: line.playerId,
      displayName: displayName(games, line.playerId),
      sampleSize: line.counters.outsRecorded,
      qualified: line.counters.outsRecorded >= minimums.pitchingOutsRecorded,
      rate: line.rates.earnedRunAverage,
      counters: { ...line.counters },
    }))
    .filter(({ qualified }) => qualified)
    .sort(
      (left, right) =>
        compareRate(left.rate, right.rate, "ASC") ||
        right.sampleSize - left.sampleSize ||
        left.displayName.localeCompare(right.displayName) ||
        left.playerId.localeCompare(right.playerId),
    );
  const fielding = statistics.fielding
    .map((line) => ({
      playerId: line.playerId,
      displayName: displayName(games, line.playerId),
      sampleSize: line.rates.chances,
      qualified: line.rates.chances >= minimums.fieldingChances,
      rate: line.rates.fieldingPercentage,
      counters: { ...line.counters },
    }))
    .filter(({ qualified }) => qualified)
    .sort(
      (left, right) =>
        compareRate(left.rate, right.rate, "DESC") ||
        right.sampleSize - left.sampleSize ||
        left.displayName.localeCompare(right.displayName) ||
        left.playerId.localeCompare(right.playerId),
    );

  const playerIds = new Set([
    ...statistics.batting.map(({ playerId }) => playerId),
    ...statistics.pitching.map(({ playerId }) => playerId),
    ...statistics.fielding.map(({ playerId }) => playerId),
  ]);
  const players = [...playerIds]
    .map((playerId) => ({
      playerId,
      displayName: displayName(games, playerId),
      batting:
        statistics.batting.find((line) => line.playerId === playerId) ?? null,
      pitching:
        statistics.pitching.find((line) => line.playerId === playerId) ?? null,
      fielding:
        statistics.fielding.find((line) => line.playerId === playerId) ?? null,
      sourceGames: games
        .filter(
          (game) =>
            game.playerNames[playerId] !== undefined &&
            game.projection.metadata.verificationStatus === "VERIFIED",
        )
        .map((game) => ({
          gameId: game.projection.metadata.gameId,
          setupSnapshotId: game.setupSnapshotId,
          scheduledAt: game.scheduledAt,
          verificationState: game.projection.metadata.verificationStatus,
        })),
    }))
    .sort(
      (left, right) =>
        left.displayName.localeCompare(right.displayName) ||
        left.playerId.localeCompare(right.playerId),
    );

  return {
    version: {
      accountId: input.accountId,
      seasonId: input.seasonId,
      teamId: input.teamId,
      derivationVersion: statistics.metadata.derivationVersion,
      statisticRulesVersion: statistics.metadata.statisticRulesVersion,
      rulesetVersionIds: statistics.metadata.rulesetVersionIds,
      sourceRevisions: statistics.metadata.sourceRevisions,
      privacyOverlayRevision: latestPrivacyRevision,
      freshness: "CURRENT_SOURCE_DERIVED",
    },
    selection: {
      seasonDisplayName: input.seasonDisplayName,
      teamDisplayName: input.teamDisplayName,
      dateFrom: input.dateFrom ?? null,
      dateTo: input.dateTo ?? null,
    },
    inclusionPolicy: {
      official: "VERIFIED_ONLY",
      recentGames: "ALL_CURRENT_LIFECYCLES",
      trends: "VERIFIED_ONLY",
      minimums,
    },
    record,
    statistics,
    recentGames,
    leaders: { batting, pitching, fielding },
    trends: verified
      .sort(
        (left, right) =>
          (left.scheduledAt ?? "").localeCompare(right.scheduledAt ?? "") ||
          left.projection.metadata.gameId.localeCompare(
            right.projection.metadata.gameId,
          ),
      )
      .map((game) => {
        const opponent = game.side === "HOME" ? "AWAY" : "HOME";
        return {
          gameId: game.projection.metadata.gameId,
          scheduledAt: game.scheduledAt,
          runsScored: game.projection.finalScore[game.side],
          runsAllowed: game.projection.finalScore[opponent],
          result: outcomeFor(game.projection, game.side) as
            "WIN" | "LOSS" | "TIE",
        };
      }),
    players,
  };
}
