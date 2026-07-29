import {
  STATISTIC_DERIVATION_VERSION,
  STATISTIC_RULES_VERSION,
  deriveBattingRates,
  deriveFieldingRates,
  derivePitchingRates,
  type BattingCounters,
  type FieldingCounters,
  type GameStatisticsProjection,
  type PitchingCounters,
  type PlayerBattingLine,
  type PlayerFieldingLine,
  type PlayerPitchingLine,
} from "./game-statistics";
import { StatisticDerivationError } from "./statistic-values";

export type SeasonGameSelection = {
  projection: GameStatisticsProjection;
  side: "HOME" | "AWAY";
  seasonId: string;
  teamId: string;
};

export type SeasonStatisticsProjection = {
  metadata: {
    accountId: string;
    seasonId: string;
    teamId: string;
    derivationVersion: typeof STATISTIC_DERIVATION_VERSION;
    statisticRulesVersion: typeof STATISTIC_RULES_VERSION;
    includedGameIds: string[];
    excludedUnverifiedGameIds: string[];
    rulesetVersionIds: string[];
    sourceRevisions: Array<{ gameId: string; sourceRevision: number }>;
  };
  team: {
    teamId: string;
    batting: BattingCounters & ReturnType<typeof deriveBattingRates>;
    pitching: PitchingCounters & ReturnType<typeof derivePitchingRates>;
    fielding: FieldingCounters & ReturnType<typeof deriveFieldingRates>;
  };
  batting: Array<Omit<PlayerBattingLine, "side">>;
  pitching: Array<Omit<PlayerPitchingLine, "side">>;
  fielding: Array<Omit<PlayerFieldingLine, "side">>;
};

export type DeriveSeasonStatisticsInput = {
  accountId: string;
  seasonId: string;
  teamId: string;
  games: readonly SeasonGameSelection[];
  includeUnverified?: boolean;
};

const battingKeys: Array<keyof BattingCounters> = [
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
];
const pitchingKeys: Array<keyof PitchingCounters> = [
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
];
const fieldingKeys: Array<keyof FieldingCounters> = [
  "putouts",
  "assists",
  "errors",
  "doublePlays",
  "triplePlays",
];

function empty<K extends string>(keys: readonly K[]): Record<K, number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;
}

function add<T extends Record<K, number>, K extends string>(
  target: T,
  source: T,
  keys: readonly K[],
): void {
  const mutableTarget = target as Record<string, number>;
  const readableSource = source as Record<string, number>;
  for (const key of keys) {
    mutableTarget[key] = (mutableTarget[key] ?? 0) + (readableSource[key] ?? 0);
  }
}

function aggregatePlayers<
  TInput extends { playerId: string; counters: C },
  TOutput,
  C extends Record<K, number>,
  K extends string,
>(
  lines: readonly TInput[],
  keys: readonly K[],
  finish: (playerId: string, counters: C) => TOutput,
): TOutput[] {
  const countersByPlayer = new Map<string, C>();
  for (const line of lines) {
    let counters = countersByPlayer.get(line.playerId);
    if (!counters) {
      counters = empty(keys) as C;
      countersByPlayer.set(line.playerId, counters);
    }
    add(counters, line.counters, keys);
  }
  return [...countersByPlayer.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([playerId, counters]) => finish(playerId, counters));
}

export function deriveSeasonStatistics(
  input: DeriveSeasonStatisticsInput,
): SeasonStatisticsProjection {
  if (!input.accountId || !input.seasonId || !input.teamId) {
    throw new StatisticDerivationError(
      "MISSING_ATTRIBUTION",
      "Season projection requires Account, season, and team identifiers.",
    );
  }
  const unique = new Set<string>();
  for (const { projection, seasonId, teamId } of input.games) {
    if (projection.metadata.accountId !== input.accountId) {
      throw new StatisticDerivationError(
        "ACCOUNT_MISMATCH",
        "Season aggregation cannot mix Accounts.",
        { gameId: projection.metadata.gameId },
      );
    }
    if (
      projection.metadata.derivationVersion !== STATISTIC_DERIVATION_VERSION ||
      projection.metadata.statisticRulesVersion !== STATISTIC_RULES_VERSION
    ) {
      throw new StatisticDerivationError(
        "UNSUPPORTED_RULESET",
        "Season aggregation cannot mix statistic derivation semantics.",
        { gameId: projection.metadata.gameId },
      );
    }
    if (seasonId !== input.seasonId || teamId !== input.teamId) {
      throw new StatisticDerivationError(
        "MISSING_ATTRIBUTION",
        "Season aggregation contains a game outside the selected team-season.",
        { gameId: projection.metadata.gameId },
      );
    }
    const key = projection.metadata.gameId;
    if (unique.has(key)) {
      throw new StatisticDerivationError(
        "RECONCILIATION_FAILURE",
        "Season aggregation contains a duplicate game side.",
        { gameId: projection.metadata.gameId },
      );
    }
    unique.add(key);
  }

  const excluded = input.games
    .filter(
      ({ projection }) =>
        input.includeUnverified !== true &&
        projection.metadata.verificationStatus !== "VERIFIED",
    )
    .map(({ projection }) => projection.metadata.gameId)
    .sort();
  const included = input.games
    .filter(
      ({ projection }) =>
        input.includeUnverified === true ||
        projection.metadata.verificationStatus === "VERIFIED",
    )
    .sort((left, right) => {
      const a = left.projection.metadata.gameId;
      const b = right.projection.metadata.gameId;
      return a < b ? -1 : a > b ? 1 : left.side < right.side ? -1 : 1;
    });

  const battingLines = aggregatePlayers(
    included.flatMap(({ projection, side }) =>
      projection.batting.filter((line) => line.side === side),
    ),
    battingKeys,
    (playerId, counters) => ({
      playerId,
      counters,
      rates: deriveBattingRates(counters),
    }),
  );
  const pitchingLines = aggregatePlayers(
    included.flatMap(({ projection, side }) =>
      projection.pitching.filter((line) => line.side === side),
    ),
    pitchingKeys,
    (playerId, counters) => ({
      playerId,
      counters,
      rates: derivePitchingRates(counters),
    }),
  );
  const fieldingLines = aggregatePlayers(
    included.flatMap(({ projection, side }) =>
      projection.fielding.filter((line) => line.side === side),
    ),
    fieldingKeys,
    (playerId, counters) => ({
      playerId,
      counters,
      rates: deriveFieldingRates(counters),
    }),
  );

  const batting = empty(battingKeys);
  for (const line of battingLines) add(batting, line.counters, battingKeys);
  const pitching = empty(pitchingKeys);
  for (const line of pitchingLines) {
    add(pitching, line.counters, pitchingKeys);
  }
  const fielding = empty(fieldingKeys);
  for (const line of fieldingLines) {
    add(fielding, line.counters, fieldingKeys);
  }

  return {
    metadata: {
      accountId: input.accountId,
      seasonId: input.seasonId,
      teamId: input.teamId,
      derivationVersion: STATISTIC_DERIVATION_VERSION,
      statisticRulesVersion: STATISTIC_RULES_VERSION,
      includedGameIds: included.map(
        ({ projection }) => projection.metadata.gameId,
      ),
      excludedUnverifiedGameIds: excluded,
      rulesetVersionIds: [
        ...new Set(
          included.map(
            ({ projection }) => projection.metadata.rulesetVersionId,
          ),
        ),
      ].sort(),
      sourceRevisions: included.map(({ projection }) => ({
        gameId: projection.metadata.gameId,
        sourceRevision: projection.metadata.sourceRevision,
      })),
    },
    team: {
      teamId: input.teamId,
      batting: { ...batting, ...deriveBattingRates(batting) },
      pitching: { ...pitching, ...derivePitchingRates(pitching) },
      fielding: { ...fielding, ...deriveFieldingRates(fielding) },
    },
    batting: battingLines,
    pitching: pitchingLines,
    fielding: fieldingLines,
  };
}
