import { describe, expect, it } from "vitest";

import {
  buildSeasonDashboard,
  type SeasonDashboardGame,
} from "@/domain/reports";
import {
  deriveBattingRates,
  deriveFieldingRates,
  derivePitchingRates,
  type BattingCounters,
  type FieldingCounters,
  type GameStatisticsProjection,
  type PitchingCounters,
} from "@/domain/statistics";

const batting = (
  plateAppearances: number,
  atBats: number,
  hits: number,
): BattingCounters => ({
  plateAppearances,
  atBats,
  runs: 0,
  hits,
  singles: hits,
  doubles: 0,
  triples: 0,
  homeRuns: 0,
  runsBattedIn: 0,
  walks: plateAppearances - atBats,
  intentionalWalks: 0,
  hitByPitch: 0,
  strikeouts: 0,
  sacrificeFlies: 0,
  sacrificeHits: 0,
  reachedOnError: 0,
  fieldersChoices: 0,
  totalBases: hits,
  stolenBases: 0,
  caughtStealing: 0,
});

const pitching = (outsRecorded: number, earnedRuns = 0): PitchingCounters => ({
  appearances: 1,
  gamesStarted: 1,
  battersFaced: 12,
  outsRecorded,
  hitsAllowed: 2,
  runsAllowed: earnedRuns,
  earnedRuns,
  walks: 1,
  strikeouts: 3,
  hitBatters: 0,
  homeRunsAllowed: 0,
  inheritedRunners: 0,
  inheritedRunnersScored: 0,
});

const fielding = (putouts: number, errors = 0): FieldingCounters => ({
  putouts,
  assists: 0,
  errors,
  doublePlays: 0,
  triplePlays: 0,
});

function projection(input: {
  gameId: string;
  status: string;
  score: [number, number];
  outcome: GameStatisticsProjection["outcome"];
  playerId?: string;
  plateAppearances?: number;
  atBats?: number;
  hits?: number;
  sourceRevision?: number;
  accountId?: string;
}): GameStatisticsProjection {
  const playerId = input.playerId ?? "player-1";
  const battingCounters = batting(
    input.plateAppearances ?? 12,
    input.atBats ?? 10,
    input.hits ?? 4,
  );
  const pitchingCounters = pitching(12, 1);
  const fieldingCounters = fielding(5);
  const verificationStatus =
    input.status === "VERIFIED" ? "VERIFIED" : "UNVERIFIED";
  const emptyBatting = batting(0, 0, 0);
  const emptyPitching = pitching(0);
  emptyPitching.appearances = 0;
  emptyPitching.gamesStarted = 0;
  emptyPitching.battersFaced = 0;
  emptyPitching.hitsAllowed = 0;
  emptyPitching.walks = 0;
  emptyPitching.strikeouts = 0;
  const emptyFielding = fielding(0);
  return {
    metadata: {
      accountId: input.accountId ?? "account-1",
      gameId: input.gameId,
      setupSnapshotId: `setup-${input.gameId}`,
      setupRevision: 1,
      sourceRevision: input.sourceRevision ?? 4,
      privacyOverlayRevision: 2,
      rulesetVersionId: "rules-1",
      eventSchemaVersions: [3],
      derivationVersion: 2,
      statisticRulesVersion: 1,
      lifecycleStatus: input.status,
      verificationStatus,
      seasonEligibility:
        verificationStatus === "VERIFIED" ? "INCLUDED" : "EXCLUDED_UNVERIFIED",
    },
    outcome: input.outcome,
    finalScore: { HOME: input.score[0], AWAY: input.score[1] },
    inningLines: [],
    teams: {
      HOME: {
        side: "HOME",
        batting: { ...emptyBatting, ...deriveBattingRates(emptyBatting) },
        pitching: { ...emptyPitching, ...derivePitchingRates(emptyPitching) },
        fielding: { ...emptyFielding, ...deriveFieldingRates(emptyFielding) },
      },
      AWAY: {
        side: "AWAY",
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
      },
    },
    batting: [
      {
        playerId,
        side: "AWAY",
        counters: battingCounters,
        rates: deriveBattingRates(battingCounters),
      },
    ],
    pitching: [
      {
        playerId,
        side: "AWAY",
        counters: pitchingCounters,
        rates: derivePitchingRates(pitchingCounters),
      },
    ],
    fielding: [
      {
        playerId,
        side: "AWAY",
        counters: fieldingCounters,
        rates: deriveFieldingRates(fieldingCounters),
      },
    ],
  };
}

function game(
  value: GameStatisticsProjection,
  scheduledAt: string,
  playerName = "Player One",
): SeasonDashboardGame {
  return {
    projection: value,
    side: "AWAY",
    seasonId: "season-1",
    teamId: "team-1",
    setupSnapshotId: value.metadata.setupSnapshotId,
    scheduledAt,
    opponentDisplayName: "Opponent",
    playerNames: { [value.batting[0]!.playerId]: playerName },
  };
}

function build(games: SeasonDashboardGame[]) {
  return buildSeasonDashboard({
    accountId: "account-1",
    seasonId: "season-1",
    seasonDisplayName: "2026",
    teamId: "team-1",
    teamDisplayName: "Stars",
    games,
  });
}

describe("season dashboard and leaderboards", () => {
  it("uses only verified games for official record, leaders, and trends", () => {
    const dashboard = build([
      game(
        projection({
          gameId: "verified",
          status: "VERIFIED",
          score: [2, 5],
          outcome: "AWAY_WIN",
        }),
        "2026-06-01T12:00:00.000Z",
      ),
      game(
        projection({
          gameId: "in-progress",
          status: "IN_PROGRESS",
          score: [0, 10],
          outcome: "UNDECIDED",
          sourceRevision: 2,
        }),
        "2026-06-02T12:00:00.000Z",
      ),
      game(
        projection({
          gameId: "corrected",
          status: "CORRECTED",
          score: [1, 9],
          outcome: "AWAY_WIN",
          sourceRevision: 8,
        }),
        "2026-06-03T12:00:00.000Z",
      ),
    ]);

    expect(dashboard.record).toMatchObject({
      wins: 1,
      losses: 0,
      ties: 0,
      incomplete: 1,
      correctedAwaitingReverification: 1,
    });
    expect(dashboard.statistics.metadata.includedGameIds).toEqual(["verified"]);
    expect(dashboard.statistics.metadata.excludedUnverifiedGameIds).toEqual([
      "corrected",
      "in-progress",
    ]);
    expect(dashboard.trends.map(({ gameId }) => gameId)).toEqual(["verified"]);
    expect(dashboard.recentGames[0]?.status).toBe(
      "CORRECTED_AWAITING_REVERIFICATION",
    );
  });

  it("enforces visible sample minimums and stable ranking ties", () => {
    const dashboard = build([
      game(
        projection({
          gameId: "a",
          status: "VERIFIED",
          score: [1, 1],
          outcome: "TIE",
          playerId: "player-b",
          plateAppearances: 12,
          atBats: 10,
          hits: 5,
        }),
        "2026-06-01T12:00:00.000Z",
        "Beta",
      ),
      game(
        projection({
          gameId: "b",
          status: "VERIFIED",
          score: [1, 1],
          outcome: "TIE",
          playerId: "player-a",
          plateAppearances: 12,
          atBats: 10,
          hits: 5,
        }),
        "2026-06-02T12:00:00.000Z",
        "Alpha",
      ),
      game(
        projection({
          gameId: "tiny",
          status: "VERIFIED",
          score: [0, 1],
          outcome: "HOME_WIN",
          playerId: "tiny",
          plateAppearances: 1,
          atBats: 1,
          hits: 1,
        }),
        "2026-06-03T12:00:00.000Z",
        "Tiny Sample",
      ),
    ]);

    expect(dashboard.record).toMatchObject({ losses: 1, ties: 2 });
    expect(
      dashboard.leaders.batting.map(({ displayName }) => displayName),
    ).toEqual(["Alpha", "Beta"]);
    expect(
      dashboard.leaders.batting.some(({ playerId }) => playerId === "tiny"),
    ).toBe(false);
    expect(dashboard.leaders.batting[0]?.sampleSize).toBe(12);
  });

  it("supports inclusive date filters, empty seasons, and zero denominators", () => {
    const walkOnly = projection({
      gameId: "walks",
      status: "VERIFIED",
      score: [0, 0],
      outcome: "TIE",
      plateAppearances: 10,
      atBats: 0,
      hits: 0,
    });
    const dashboard = buildSeasonDashboard({
      accountId: "account-1",
      seasonId: "season-1",
      seasonDisplayName: "2026",
      teamId: "team-1",
      teamDisplayName: "Stars",
      dateFrom: "2026-06-01",
      dateTo: "2026-06-01",
      games: [game(walkOnly, "2026-06-01T20:30:00.000Z")],
    });
    expect(dashboard.recentGames).toHaveLength(1);
    expect(dashboard.leaders.batting[0]?.rate).toBeNull();

    const empty = build([]);
    expect(empty.recentGames).toEqual([]);
    expect(empty.players).toEqual([]);
    expect(empty.record.wins).toBe(0);
  });

  it("fails closed for Account and privacy revision mixing", () => {
    expect(() =>
      build([
        game(
          projection({
            gameId: "foreign",
            status: "VERIFIED",
            score: [1, 0],
            outcome: "HOME_WIN",
            accountId: "account-2",
          }),
          "2026-06-01T12:00:00.000Z",
        ),
      ]),
    ).toThrow(/Accounts/u);

    const current = game(
      projection({
        gameId: "current",
        status: "VERIFIED",
        score: [1, 0],
        outcome: "HOME_WIN",
      }),
      "2026-06-01T12:00:00.000Z",
    );
    const stale = game(
      projection({
        gameId: "stale",
        status: "VERIFIED",
        score: [1, 0],
        outcome: "HOME_WIN",
      }),
      "2026-06-02T12:00:00.000Z",
    );
    stale.projection.metadata.privacyOverlayRevision = 1;
    expect(() => build([current, stale])).toThrow(/privacy revisions/u);
  });
});
