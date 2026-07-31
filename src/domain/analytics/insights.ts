import type {
  AcceptedEvent,
  AcceptedSetup,
  GameSide,
} from "@/domain/events/event-log";
import type { GameStatisticsProjection } from "@/domain/statistics";

export const ANALYTICS_FEATURE_VERSION = 1 as const;

export const ANALYTICS_THRESHOLDS = Object.freeze({
  trend: { limitedGames: 3, supportedGames: 5 },
  lineup: { limitedInstances: 3, supportedInstances: 5, supportedGames: 10 },
  matchup: { limitedPlateAppearances: 10, supportedPlateAppearances: 25 },
});

export type AnalyticsGame = {
  projection: GameStatisticsProjection;
  setup: AcceptedSetup;
  events: readonly AcceptedEvent[];
  side: GameSide;
  seasonId: string;
  teamId: string;
  scheduledAt: string | null;
  opponentDisplayName: string;
  playerNames: Readonly<Record<string, string>>;
};

export type AnalyticsConfidence = "INSUFFICIENT" | "LIMITED" | "SUPPORTED";

export type AnalyticsInsight = {
  id: string;
  type: "LINEUP" | "MATCHUP" | "TREND";
  title: string;
  summary: string;
  accountScope: string;
  teamScope: string;
  seasonScope: string;
  sourceGames: string[];
  sourcePlayers: string[];
  sourceRevision: Array<{ gameId: string; sourceRevision: number }>;
  derivationVersion: number;
  rulesetVersion: string[];
  featureVersion: typeof ANALYTICS_FEATURE_VERSION;
  sampleSize: {
    games: number;
    opportunities: number;
    denominator: number;
    missingObservations: number;
  };
  confidence: AnalyticsConfidence;
  limitations: string[];
  generatedFrom: "CURRENT_EFFECTIVE_HISTORY";
  correctionState: "CURRENT";
  verificationState: "VERIFIED_ONLY";
  freshness: "CURRENT_SOURCE_DERIVED";
  details: Readonly<Record<string, string | number | string[]>>;
};

type VerifiedGame = AnalyticsGame & {
  projection: AnalyticsGame["projection"] & {
    metadata: { verificationStatus: "VERIFIED" };
  };
};

const hitOutcomes = new Set(["SINGLE", "DOUBLE", "TRIPLE", "HOME_RUN"]);

function verifiedGames(games: readonly AnalyticsGame[]): VerifiedGame[] {
  return games.filter(
    (game): game is VerifiedGame =>
      game.projection.metadata.verificationStatus === "VERIFIED",
  );
}

function confidence(
  sample: number,
  limited: number,
  supported: number,
): AnalyticsConfidence {
  if (sample < limited) return "INSUFFICIENT";
  if (sample < supported) return "LIMITED";
  return "SUPPORTED";
}

function confidenceForLineup(
  instances: number,
  games: number,
): AnalyticsConfidence {
  if (instances < ANALYTICS_THRESHOLDS.lineup.limitedInstances) {
    return "INSUFFICIENT";
  }
  if (
    instances < ANALYTICS_THRESHOLDS.lineup.supportedInstances ||
    games < ANALYTICS_THRESHOLDS.lineup.supportedGames
  ) {
    return "LIMITED";
  }
  return "SUPPORTED";
}

function playerName(game: AnalyticsGame, playerId: string): string {
  return game.playerNames[playerId] ?? "Player";
}

function sourceRevision(games: readonly AnalyticsGame[]) {
  return games
    .map(({ projection }) => ({
      gameId: projection.metadata.gameId,
      sourceRevision: projection.metadata.sourceRevision,
    }))
    .sort((left, right) => left.gameId.localeCompare(right.gameId));
}

function baseInsight(
  game: AnalyticsGame | undefined,
  games: readonly AnalyticsGame[],
  type: AnalyticsInsight["type"],
  title: string,
  summary: string,
  sourcePlayers: string[],
  sampleSize: AnalyticsInsight["sampleSize"],
  insightConfidence: AnalyticsConfidence,
  details: AnalyticsInsight["details"],
): AnalyticsInsight {
  if (!game) throw new Error("Analytics requires at least one selected game.");
  const current = verifiedGames(games);
  return {
    id: `analytics:${type.toLowerCase()}:${game.teamId}:${game.seasonId}`,
    type,
    title,
    summary,
    accountScope: game.projection.metadata.accountId,
    teamScope: game.teamId,
    seasonScope: game.seasonId,
    sourceGames: current.map(({ projection }) => projection.metadata.gameId),
    sourcePlayers,
    sourceRevision: sourceRevision(current),
    derivationVersion: game.projection.metadata.derivationVersion,
    rulesetVersion: [
      ...new Set(
        current.map(({ projection }) => projection.metadata.rulesetVersionId),
      ),
    ].sort(),
    featureVersion: ANALYTICS_FEATURE_VERSION,
    sampleSize,
    confidence: insightConfidence,
    limitations: [
      "Descriptive evidence only; association is not causation or a coaching recommendation.",
      "Only verified games are included and missing observations remain unknown.",
    ],
    generatedFrom: "CURRENT_EFFECTIVE_HISTORY",
    correctionState: "CURRENT",
    verificationState: "VERIFIED_ONLY",
    freshness: "CURRENT_SOURCE_DERIVED",
    details,
  };
}

function lineupInsight(games: readonly VerifiedGame[]): AnalyticsInsight {
  const first = games[0];
  if (!first) throw new Error("Lineup insight requires a selected game.");
  const groups = new Map<
    string,
    { players: string[]; games: VerifiedGame[] }
  >();
  for (const game of games) {
    const players = game.setup.sides[game.side].lineup
      .filter(({ active, battingOrder }) => active && battingOrder !== null)
      .sort((left, right) => left.battingOrder! - right.battingOrder!)
      .map(({ playerId }) => playerId);
    const key = players.join(",");
    const group = groups.get(key) ?? { players, games: [] };
    group.games.push(game);
    groups.set(key, group);
  }
  const selected = [...groups.values()].sort(
    (left, right) =>
      right.games.length - left.games.length ||
      left.players.join(",").localeCompare(right.players.join(",")),
  )[0] ?? { players: [], games: [] };
  const runs = selected.games.map(
    (game) => game.projection.finalScore[game.side],
  );
  const averageRuns = runs.length
    ? Number(
        (runs.reduce((sum, value) => sum + value, 0) / runs.length).toFixed(2),
      )
    : 0;
  const confidenceValue = confidenceForLineup(
    selected.games.length,
    games.length,
  );
  const names = selected.players.map((id) =>
    playerName(selected.games[0] ?? first, id),
  );
  const summary = selected.games.length
    ? `${names.join(", ")} appeared together in ${selected.games.length} verified game${selected.games.length === 1 ? "" : "s"}, averaging ${averageRuns} runs.`
    : "No verified batting-order instances are available.";
  return baseInsight(
    first,
    games,
    "LINEUP",
    "Most observed batting order",
    summary,
    selected.players,
    {
      games: games.length,
      opportunities: selected.games.length,
      denominator: games.length,
      missingObservations: Math.max(0, games.length - selected.games.length),
    },
    confidenceValue,
    {
      lineup: names,
      lineupInstances: selected.games.length,
      averageRuns,
      verifiedGames: games.length,
    },
  );
}

function matchupInsight(games: readonly VerifiedGame[]): AnalyticsInsight {
  const first = games[0];
  if (!first) throw new Error("Matchup insight requires a selected game.");
  const groups = new Map<
    string,
    {
      batterId: string;
      pitcherId: string;
      games: Set<string>;
      pa: number;
      hits: number;
    }
  >();
  for (const game of games) {
    const teamPlayers = new Set(
      game.setup.sides[game.side].lineup.map(({ playerId }) => playerId),
    );
    for (const event of game.events) {
      if (event.eventType !== "PlateAppearanceRecorded") continue;
      const { batterId, pitcherId, outcome } = event.payload;
      if (!teamPlayers.has(batterId) || teamPlayers.has(pitcherId)) continue;
      const key = `${batterId}:${pitcherId}`;
      const group = groups.get(key) ?? {
        batterId,
        pitcherId,
        games: new Set<string>(),
        pa: 0,
        hits: 0,
      };
      group.games.add(game.projection.metadata.gameId);
      group.pa += 1;
      if (hitOutcomes.has(outcome)) group.hits += 1;
      groups.set(key, group);
    }
  }
  const selected = [...groups.values()].sort(
    (left, right) =>
      right.pa - left.pa ||
      right.hits - left.hits ||
      left.batterId.localeCompare(right.batterId),
  )[0];
  const pa = selected?.pa ?? 0;
  const hits = selected?.hits ?? 0;
  const average = pa ? Number((hits / pa).toFixed(3)) : 0;
  const confidenceValue = confidence(
    pa,
    ANALYTICS_THRESHOLDS.matchup.limitedPlateAppearances,
    ANALYTICS_THRESHOLDS.matchup.supportedPlateAppearances,
  );
  const batter = selected ? playerName(first, selected.batterId) : "No batter";
  const pitcher = selected
    ? playerName(first, selected.pitcherId)
    : "No pitcher";
  return baseInsight(
    first,
    games,
    "MATCHUP",
    "Most observed batter–pitcher matchup",
    selected
      ? `${batter} recorded ${hits} hit${hits === 1 ? "" : "s"} in ${pa} plate appearance${pa === 1 ? "" : "s"} against ${pitcher}.`
      : "No verified batter–pitcher plate appearances are available.",
    selected ? [selected.batterId, selected.pitcherId] : [],
    {
      games: selected?.games.size ?? 0,
      opportunities: pa,
      denominator: pa,
      missingObservations: 0,
    },
    confidenceValue,
    {
      batter,
      pitcher,
      plateAppearances: pa,
      hits,
      battingAverage: average,
    },
  );
}

function trendInsight(games: readonly VerifiedGame[]): AnalyticsInsight {
  const first = games[0];
  if (!first) throw new Error("Trend insight requires a selected game.");
  const ordered = [...games].sort((left, right) =>
    (left.scheduledAt ?? left.projection.metadata.gameId).localeCompare(
      right.scheduledAt ?? right.projection.metadata.gameId,
    ),
  );
  const recent = ordered.slice(-3);
  const prior = ordered.slice(Math.max(0, ordered.length - 6), -3);
  const average = (values: readonly VerifiedGame[]) =>
    values.length
      ? Number(
          (
            values.reduce(
              (sum, game) => sum + game.projection.finalScore[game.side],
              0,
            ) / values.length
          ).toFixed(2),
        )
      : 0;
  const recentAverage = average(recent);
  const priorAverage = average(prior);
  const direction =
    recentAverage > priorAverage
      ? "up"
      : recentAverage < priorAverage
        ? "down"
        : "flat";
  const confidenceValue = confidence(
    games.length,
    ANALYTICS_THRESHOLDS.trend.limitedGames,
    ANALYTICS_THRESHOLDS.trend.supportedGames,
  );
  return baseInsight(
    first,
    games,
    "TREND",
    "Recent scoring trend",
    games.length < ANALYTICS_THRESHOLDS.trend.limitedGames
      ? "Not enough verified games to describe a trend."
      : `The latest ${recent.length} verified game${recent.length === 1 ? "" : "s"} average ${recentAverage} runs, compared with ${prior.length ? `${priorAverage} across the preceding games` : "no earlier comparison"}.`,
    [],
    {
      games: games.length,
      opportunities: recent.length,
      denominator: games.length,
      missingObservations: 0,
    },
    confidenceValue,
    {
      recentAverageRuns: recentAverage,
      priorAverageRuns: priorAverage,
      direction,
      recentGames: recent.map(({ projection }) => projection.metadata.gameId),
    },
  );
}

export function buildAnalyticsInsights(
  input: Readonly<{
    accountId: string;
    teamId: string;
    seasonId: string;
    games: readonly AnalyticsGame[];
  }>,
): AnalyticsInsight[] {
  const selected = verifiedGames(input.games);
  if (selected.length === 0) return [];
  return [
    lineupInsight(selected),
    matchupInsight(selected),
    trendInsight(selected),
  ].map((insight) => ({
    ...insight,
    accountScope: input.accountId,
    teamScope: input.teamId,
    seasonScope: input.seasonId,
  }));
}
