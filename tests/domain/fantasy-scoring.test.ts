import { describe, expect, it } from "vitest";

import {
  type FantasyDomainAuthority,
  type FantasyLeague,
  type FantasyRosterSnapshot,
  type FantasyTeam,
} from "@/domain/fantasy-domain";
import {
  INITIAL_FANTASY_FORMAT,
  createFantasyScoringModelVersion,
  transitionFantasyScoringModel,
  type FantasyScoringModelInput,
  type FantasyScoringModelVersion,
  type FantasyStatisticSnapshot,
} from "@/domain/fantasy-rules";
import {
  calculateFantasyMatchup,
  calculateFantasyStandings,
  calculateFantasyTeamPeriodResult,
  type FantasyMatchupCalculationInput,
  type FantasyPlayerPeriodStatistics,
  type FantasyScoringPeriod,
  type FantasyStandingsCalculationInput,
  type FantasyTeamPeriodCalculationInput,
  type FantasyTeamPeriodResult,
} from "@/domain/fantasy-scoring";

const CALCULATED = "2026-08-18T12:00:00.000Z";
const CORRECTED = "2026-08-19T12:00:00.000Z";

function modelInput(
  overrides: Partial<FantasyScoringModelInput> = {},
): FantasyScoringModelInput {
  return {
    modelId: "fantasy-model-a",
    modelVersionId: "fantasy-model-a-v1",
    owner: { kind: "ACCOUNT", id: "account-a" },
    version: 1,
    name: "Weekly points",
    format: INITIAL_FANTASY_FORMAT,
    statisticRegistryVersion: "baseball-statistics:v1",
    categories: [
      {
        id: "runs",
        domain: "BATTING",
        sourceStatistic: "batting.runs",
        label: "Runs",
        milliPointsPerUnit: 1_000,
      },
      {
        id: "home-runs",
        domain: "BATTING",
        sourceStatistic: "batting.home_runs",
        label: "Home runs",
        milliPointsPerUnit: 3_000,
      },
    ],
    eligibility: {
      rosterSource: "EXACT_ACCOUNT_ROSTER_AT_LOCK",
      unknownEligibility: "INELIGIBLE",
      positionRules: [
        {
          positionCode: "OUTFIELD",
          minimumAppearances: 5,
          minimumPitchingOuts: 0,
        },
      ],
    },
    roster: {
      maximumRosterSize: 2,
      benchSlots: 1,
      lineupSlots: [
        { id: "OF", count: 1, eligiblePositionCodes: ["OUTFIELD"] },
      ],
      lineupLock: "WEEKLY_PERIOD_START",
      missingLineupBehavior: "ZERO_POINTS",
      benchScoring: "EXCLUDED",
    },
    cadence: {
      periodKind: "WEEKLY",
      boundarySource: "SEALED_UTC_INTERVALS",
      completionGraceHours: 48,
      correctionPolicy: "BEFORE_FINALIZATION_ONLY",
      regularSeasonTie: "TIE",
      playoffTieBreaker: "HIGHER_PREDECLARED_SEED",
    },
    lifecycle: "DRAFT",
    ...overrides,
  };
}

function activeModel(
  overrides: Partial<FantasyScoringModelInput> = {},
): FantasyScoringModelVersion {
  const draft = createFantasyScoringModelVersion(modelInput(overrides));
  return transitionFantasyScoringModel(
    transitionFantasyScoringModel(draft, "REVIEWED"),
    "ACTIVE",
  );
}

function league(model: FantasyScoringModelVersion): FantasyLeague {
  return {
    contractVersion: 1,
    id: "fantasy-league-a",
    accountId: "account-a",
    owner: { kind: "ACCOUNT", accountId: "account-a" },
    administrativeScope: null,
    seasonId: "season-2026",
    name: "Summer league",
    rules: {
      modelId: model.modelId,
      modelVersionId: model.modelVersionId,
      modelVersion: model.version,
      modelDigest: model.contentDigest,
      modelOwner: model.owner,
      statisticRegistryVersion: model.statisticRegistryVersion,
    },
    lifecycle: "ACTIVE",
    visibility: "PRIVATE",
    revision: 1,
    createdAt: "2026-08-01T00:00:00.000Z",
    activatedAt: "2026-08-02T00:00:00.000Z",
    completedAt: null,
    archivedAt: null,
  };
}

function team(id: string): FantasyTeam {
  return {
    contractVersion: 1,
    id,
    accountId: "account-a",
    fantasyLeagueId: "fantasy-league-a",
    owner: {
      accountId: "account-a",
      accountMembershipId: `manager-${id}`,
    },
    name: id,
    lifecycle: "ACTIVE",
    revision: 1,
    createdAt: "2026-08-02T00:00:00.000Z",
    activatedAt: "2026-08-03T00:00:00.000Z",
    withdrawnAt: null,
    archivedAt: null,
  };
}

function roster(
  model: FantasyScoringModelVersion,
  teamId: string,
): FantasyRosterSnapshot {
  return {
    contractVersion: 1,
    id: `roster-${teamId}-p1`,
    accountId: "account-a",
    fantasyLeagueId: "fantasy-league-a",
    fantasyTeamId: teamId,
    revision: 3,
    previousSnapshotId: `roster-${teamId}-p0`,
    effectiveAt: "2026-08-10T00:00:00.000Z",
    rules: {
      modelId: model.modelId,
      modelVersionId: model.modelVersionId,
      modelVersion: model.version,
      modelDigest: model.contentDigest,
      modelOwner: model.owner,
      statisticRegistryVersion: model.statisticRegistryVersion,
    },
    slots: [
      {
        id: `active-${teamId}`,
        kind: "ACTIVE",
        lineupSlotRuleId: "OF",
        playerEntryId: `player-${teamId}`,
      },
      {
        id: `bench-${teamId}`,
        kind: "BENCH",
        lineupSlotRuleId: null,
        playerEntryId: null,
      },
    ],
  };
}

function authority(
  overrides: Partial<FantasyDomainAuthority> = {},
): FantasyDomainAuthority {
  return {
    accountId: "account-a",
    actorId: "scoring-worker-a",
    source: "ACCOUNT_PERMISSION",
    capability: "fantasy.scoring.calculate",
    scope: { kind: "FANTASY_LEAGUE", fantasyLeagueId: "fantasy-league-a" },
    authorityReferenceIds: ["account-membership-a"],
    authorizedAt: "2026-08-18T11:59:00.000Z",
    ...overrides,
  };
}

function period(
  sequence = 1,
  phase: FantasyScoringPeriod["phase"] = "REGULAR_SEASON",
): FantasyScoringPeriod {
  return {
    id: `period-${sequence}`,
    accountId: "account-a",
    fantasyLeagueId: "fantasy-league-a",
    sequence,
    phase,
    startsAt: "2026-08-10T00:00:00.000Z",
    endsAt: "2026-08-17T00:00:00.000Z",
    finalizationDeadline: "2026-08-19T00:00:00.000Z",
  };
}

function snapshot(
  runs: number,
  homeRuns: number,
  overrides: Partial<FantasyStatisticSnapshot> = {},
): FantasyStatisticSnapshot {
  return {
    accountId: "account-a",
    authority: {
      accountId: "account-a",
      authorityReferenceIds: ["statistics-read-a"],
      authorizedAt: "2026-08-18T11:58:00.000Z",
    },
    values: {
      "batting.runs": runs,
      "batting.home_runs": homeRuns,
    },
    lineage: {
      baseballRulesetVersionIds: ["baseball-rules-v1"],
      statisticDerivationVersion: 2,
      statisticRulesVersion: 1,
      sourceRevision: 10,
      correctionRevision: 0,
      fantasyStatisticRegistryVersion: "baseball-statistics:v1",
      lifecycle: "FINAL",
      verification: "VERIFIED",
    },
    ...overrides,
  };
}

function source(
  teamId: string,
  statisticSnapshot: FantasyStatisticSnapshot | null,
  overrides: Partial<FantasyPlayerPeriodStatistics> = {},
): FantasyPlayerPeriodStatistics {
  return {
    accountId: "account-a",
    fantasyLeagueId: "fantasy-league-a",
    fantasyTeamId: teamId,
    periodId: "period-1",
    rosterSnapshotId: `roster-${teamId}-p1`,
    rosterSlotId: `active-${teamId}`,
    fantasyPlayerEntryId: `player-${teamId}`,
    availability: statisticSnapshot ? "FINAL_VERIFIED" : "INCOMPLETE_GAME",
    expectedGames: 3,
    completedGames: statisticSnapshot ? 3 : 2,
    projectedCompletionAt: statisticSnapshot
      ? null
      : "2026-08-18T20:00:00.000Z",
    snapshot: statisticSnapshot,
    ...overrides,
  };
}

function teamResultInput(
  teamId: string,
  statisticSource: FantasyPlayerPeriodStatistics,
  overrides: Partial<FantasyTeamPeriodCalculationInput> = {},
): FantasyTeamPeriodCalculationInput {
  return {
    resultId: `result-${teamId}-v0`,
    auditId: `audit-${teamId}-v0`,
    accountId: "account-a",
    fantasyLeagueId: "fantasy-league-a",
    fantasyTeamId: teamId,
    period: period(),
    calculatedAt: CALCULATED,
    finalize: true,
    revision: 0,
    previousResultId: null,
    correctionReason: null,
    statistics: [statisticSource],
    ...overrides,
  };
}

function finalTeamResult(
  model: FantasyScoringModelVersion,
  teamId: string,
  runs: number,
  homeRuns = 0,
  scoringPeriod = period(),
): FantasyTeamPeriodResult {
  const statisticSource = source(teamId, snapshot(runs, homeRuns), {
    periodId: scoringPeriod.id,
  });
  return calculateFantasyTeamPeriodResult(
    teamResultInput(teamId, statisticSource, { period: scoringPeriod }),
    league(model),
    team(teamId),
    roster(model, teamId),
    model,
    authority(),
  );
}

function matchupInput(
  id: string,
  overrides: Partial<FantasyMatchupCalculationInput> = {},
): FantasyMatchupCalculationInput {
  return {
    resultId: id,
    auditId: `audit-${id}`,
    accountId: "account-a",
    fantasyLeagueId: "fantasy-league-a",
    calculatedAt: CALCULATED,
    revision: 0,
    previousResultId: null,
    correctionReason: null,
    firstPredeclaredSeed: 1,
    secondPredeclaredSeed: 2,
    ...overrides,
  };
}

describe("fantasy team period scoring", () => {
  it("deterministically aggregates active-player category and point totals with full lineage", () => {
    const model = activeModel();
    const input = teamResultInput("team-a", source("team-a", snapshot(2, 1)));
    const first = calculateFantasyTeamPeriodResult(
      input,
      league(model),
      team("team-a"),
      roster(model, "team-a"),
      model,
      authority(),
    );
    const replay = calculateFantasyTeamPeriodResult(
      input,
      league(model),
      team("team-a"),
      roster(model, "team-a"),
      model,
      authority(),
    );

    expect(first).toEqual(replay);
    expect(first).toMatchObject({
      status: "FINAL",
      totalMilliPoints: 5_000,
      expectedSourceCount: 1,
      completedSourceCount: 1,
      uncertainties: [],
    });
    expect(first.categoryTotals).toEqual([
      {
        categoryId: "runs",
        sourceStatistic: "batting.runs",
        units: 2,
        milliPoints: 2_000,
      },
      {
        categoryId: "home-runs",
        sourceStatistic: "batting.home_runs",
        units: 1,
        milliPoints: 3_000,
      },
    ]);
    expect(first.lineage).toMatchObject({
      fantasyModelVersionId: "fantasy-model-a-v1",
      fantasyModelVersion: 1,
      baseballRulesetVersionIds: ["baseball-rules-v1"],
      statisticDerivationVersions: [2],
      sourceRevisions: [10],
    });
    expect(Object.isFrozen(first)).toBe(true);
  });

  it("keeps incomplete, unverified, and insufficient samples visible", () => {
    const model = activeModel();
    for (const availability of [
      "INCOMPLETE_GAME",
      "UNVERIFIED",
      "INSUFFICIENT_SAMPLE",
    ] as const) {
      const statisticSource = source("team-a", null, { availability });
      const result = calculateFantasyTeamPeriodResult(
        teamResultInput("team-a", statisticSource, {
          calculatedAt: "2026-08-18T00:00:00.000Z",
          finalize: false,
        }),
        league(model),
        team("team-a"),
        roster(model, "team-a"),
        model,
        authority(),
      );
      expect(result.status).toBe("AWAITING_FINAL_DATA");
      expect(result.totalMilliPoints).toBe(0);
      expect(result.uncertainties[0]).toMatchObject({
        fantasyPlayerEntryId: "player-team-a",
      });
      expect(result.projectedCompletionAt).toBe("2026-08-18T20:00:00.000Z");
    }
  });

  it("does not finalize unresolved statistics before the declared grace deadline", () => {
    const model = activeModel();
    expect(() =>
      calculateFantasyTeamPeriodResult(
        teamResultInput("team-a", source("team-a", null), {
          calculatedAt: "2026-08-18T00:00:00.000Z",
        }),
        league(model),
        team("team-a"),
        roster(model, "team-a"),
        model,
        authority(),
      ),
    ).toThrowError(expect.objectContaining({ code: "RESULT_NOT_READY" }));
  });

  it("advances provisional results to final without mislabeling normal completion as a correction", () => {
    const model = activeModel();
    const provisional = calculateFantasyTeamPeriodResult(
      teamResultInput("team-a", source("team-a", null), {
        resultId: "result-team-a-provisional",
        auditId: "audit-team-a-provisional",
        calculatedAt: "2026-08-18T00:00:00.000Z",
        finalize: false,
      }),
      league(model),
      team("team-a"),
      roster(model, "team-a"),
      model,
      authority(),
    );
    const final = calculateFantasyTeamPeriodResult(
      teamResultInput("team-a", source("team-a", snapshot(2, 0)), {
        resultId: "result-team-a-final",
        auditId: "audit-team-a-final",
        calculatedAt: "2026-08-18T01:00:00.000Z",
        revision: 1,
        previousResultId: provisional.id,
      }),
      league(model),
      team("team-a"),
      roster(model, "team-a"),
      model,
      authority(),
      provisional,
    );

    expect(final).toMatchObject({
      status: "FINAL",
      totalMilliPoints: 2_000,
      revision: 1,
      correction: null,
      audit: { action: "FINALIZE", correctionReason: null },
    });
  });

  it("allows a declared empty active slot to finalize as visible zero", () => {
    const model = activeModel();
    const emptyRoster: FantasyRosterSnapshot = {
      ...roster(model, "team-a"),
      slots: [
        {
          id: "active-team-a",
          kind: "ACTIVE",
          lineupSlotRuleId: "OF",
          playerEntryId: null,
        },
      ],
    };
    const result = calculateFantasyTeamPeriodResult(
      teamResultInput("team-a", source("team-a", snapshot(1, 0)), {
        statistics: [],
      }),
      league(model),
      team("team-a"),
      emptyRoster,
      model,
      authority(),
    );

    expect(result).toMatchObject({
      status: "FINAL",
      totalMilliPoints: 0,
      expectedSourceCount: 0,
      uncertainties: [{ code: "EMPTY_LINEUP_SLOT" }],
    });
  });

  it("appends a corrected result revision without changing the original", () => {
    const model = activeModel();
    const original = finalTeamResult(model, "team-a", 2, 0);
    const correctedSnapshot = snapshot(4, 1, {
      lineage: {
        ...snapshot(4, 1).lineage,
        sourceRevision: 11,
        correctionRevision: 1,
      },
    });
    const correctedSource = source("team-a", correctedSnapshot, {
      availability: "CORRECTED_FINAL",
    });
    const corrected = calculateFantasyTeamPeriodResult(
      teamResultInput("team-a", correctedSource, {
        resultId: "result-team-a-v1",
        auditId: "audit-team-a-v1",
        calculatedAt: CORRECTED,
        revision: 1,
        previousResultId: original.id,
        correctionReason: "Accepted official scoring correction",
      }),
      league(model),
      team("team-a"),
      roster(model, "team-a"),
      model,
      authority(),
      original,
    );

    expect(original.totalMilliPoints).toBe(2_000);
    expect(corrected.totalMilliPoints).toBe(7_000);
    expect(corrected).toMatchObject({
      revision: 1,
      previousResultId: original.id,
      status: "FINAL",
      correction: {
        reason: "Accepted official scoring correction",
        previousResultId: original.id,
        previousResultDigest: original.resultDigest,
      },
    });
    expect(corrected.lineage).toMatchObject({
      sourceRevisions: [11],
      correctionRevisions: [1],
    });
  });

  it("preserves exact model versions and rejects mismatched league bindings", () => {
    const modelV1 = activeModel();
    const modelV2 = activeModel({
      modelVersionId: "fantasy-model-a-v2",
      version: 2,
      name: "Weekly points v2",
    });
    const resultV2 = finalTeamResult(modelV2, "team-a", 1);
    expect(resultV2.lineage).toMatchObject({
      fantasyModelVersionId: "fantasy-model-a-v2",
      fantasyModelVersion: 2,
    });
    expect(() =>
      calculateFantasyTeamPeriodResult(
        teamResultInput("team-a", source("team-a", snapshot(1, 0))),
        league(modelV1),
        team("team-a"),
        roster(modelV1, "team-a"),
        modelV2,
        authority(),
      ),
    ).toThrowError(expect.objectContaining({ code: "RULES_MISMATCH" }));
  });

  it("denies forged permissions, sibling Accounts, leagues, and roster sources", () => {
    const model = activeModel();
    const input = teamResultInput("team-a", source("team-a", snapshot(1, 0)));
    expect(() =>
      calculateFantasyTeamPeriodResult(
        input,
        league(model),
        team("team-a"),
        roster(model, "team-a"),
        model,
        authority({ capability: "fantasy.roster.manage" }),
      ),
    ).toThrowError(expect.objectContaining({ code: "AUTHORIZATION_REQUIRED" }));
    expect(() =>
      calculateFantasyTeamPeriodResult(
        { ...input, accountId: "account-b" },
        league(model),
        team("team-a"),
        roster(model, "team-a"),
        model,
        authority({ accountId: "account-b" }),
      ),
    ).toThrowError(expect.objectContaining({ code: "ACCOUNT_MISMATCH" }));
    expect(() =>
      calculateFantasyTeamPeriodResult(
        {
          ...input,
          statistics: [
            { ...input.statistics[0]!, fantasyLeagueId: "fantasy-league-b" },
          ],
        },
        league(model),
        team("team-a"),
        roster(model, "team-a"),
        model,
        authority(),
      ),
    ).toThrowError(expect.objectContaining({ code: "SOURCE_CONFLICT" }));
  });
});

describe("fantasy matchup and standings calculations", () => {
  it("calculates points matchups, regular-season ties, and playoff seed ties", () => {
    const model = activeModel();
    const first = finalTeamResult(model, "team-a", 2);
    const second = finalTeamResult(model, "team-b", 2);
    const regular = calculateFantasyMatchup(
      matchupInput("matchup-regular"),
      first,
      second,
      authority(),
    );
    expect(regular).toMatchObject({
      status: "FINAL",
      outcome: "TIE",
      winnerTeamId: null,
      tieBreak: "NONE",
      lineage: {
        fantasyModelVersionId: "fantasy-model-a-v1",
        baseballRulesetVersionIds: ["baseball-rules-v1"],
        statisticDerivationVersions: [2],
        sourceRevisions: [10],
      },
    });

    const playoffPeriod = period(2, "PLAYOFF");
    const playoffFirst = finalTeamResult(model, "team-a", 2, 0, playoffPeriod);
    const playoffSecond = finalTeamResult(model, "team-b", 2, 0, playoffPeriod);
    const playoff = calculateFantasyMatchup(
      matchupInput("matchup-playoff", {
        firstPredeclaredSeed: 3,
        secondPredeclaredSeed: 1,
      }),
      playoffFirst,
      playoffSecond,
      authority(),
    );
    expect(playoff).toMatchObject({
      outcome: "SECOND_WIN",
      winnerTeamId: "team-b",
      tieBreak: "HIGHER_PREDECLARED_SEED",
    });
  });

  it("replays standings deterministically with totals, streaks, and qualification", () => {
    const model = activeModel();
    const first = finalTeamResult(model, "team-a", 4);
    const second = finalTeamResult(model, "team-b", 1);
    const matchup = calculateFantasyMatchup(
      matchupInput("matchup-1"),
      first,
      second,
      authority(),
    );
    const standingsInput: FantasyStandingsCalculationInput = {
      resultId: "standings-v0",
      auditId: "audit-standings-v0",
      accountId: "account-a",
      fantasyLeagueId: "fantasy-league-a",
      calculatedAt: CALCULATED,
      revision: 0,
      previousResultId: null,
      correctionReason: null,
      regularSeasonComplete: true,
      playoffTeamCount: 1,
      teams: [
        { fantasyTeamId: "team-a", predeclaredSeed: 2 },
        { fantasyTeamId: "team-b", predeclaredSeed: 1 },
      ],
    };
    const firstStandings = calculateFantasyStandings(
      standingsInput,
      [matchup],
      authority(),
    );
    const replay = calculateFantasyStandings(
      standingsInput,
      [matchup],
      authority(),
    );
    expect(firstStandings).toEqual(replay);
    expect(firstStandings).toMatchObject({
      status: "FINAL",
      completedMatchupCount: 1,
      pendingMatchupCount: 0,
      lineage: {
        fantasyModelVersionId: "fantasy-model-a-v1",
        baseballRulesetVersionIds: ["baseball-rules-v1"],
        statisticDerivationVersions: [2],
        sourceRevisions: [10],
      },
    });
    expect(firstStandings.records[0]).toMatchObject({
      rank: 1,
      fantasyTeamId: "team-a",
      wins: 1,
      currentStreak: "W1",
      playoffQualification: "QUALIFIED",
    });
    expect(firstStandings.records[1]).toMatchObject({
      rank: 2,
      fantasyTeamId: "team-b",
      losses: 1,
      currentStreak: "L1",
      playoffQualification: "NOT_QUALIFIED",
    });
  });

  it("propagates corrected result versions through matchup and standings revisions", () => {
    const model = activeModel();
    const originalFirst = finalTeamResult(model, "team-a", 3);
    const second = finalTeamResult(model, "team-b", 2);
    const originalMatchup = calculateFantasyMatchup(
      matchupInput("matchup-v0"),
      originalFirst,
      second,
      authority(),
    );
    const originalStandings = calculateFantasyStandings(
      {
        resultId: "standings-v0",
        auditId: "audit-standings-v0",
        accountId: "account-a",
        fantasyLeagueId: "fantasy-league-a",
        calculatedAt: CALCULATED,
        revision: 0,
        previousResultId: null,
        correctionReason: null,
        regularSeasonComplete: true,
        playoffTeamCount: 1,
        teams: [
          { fantasyTeamId: "team-a", predeclaredSeed: 1 },
          { fantasyTeamId: "team-b", predeclaredSeed: 2 },
        ],
      },
      [originalMatchup],
      authority(),
    );

    const correctedSnapshot = snapshot(1, 0, {
      lineage: {
        ...snapshot(1, 0).lineage,
        sourceRevision: 12,
        correctionRevision: 1,
      },
    });
    const correctedFirst = calculateFantasyTeamPeriodResult(
      teamResultInput(
        "team-a",
        source("team-a", correctedSnapshot, {
          availability: "CORRECTED_FINAL",
        }),
        {
          resultId: "result-team-a-v1",
          auditId: "audit-team-a-v1",
          calculatedAt: CORRECTED,
          revision: 1,
          previousResultId: originalFirst.id,
          correctionReason: "Official statistic correction",
        },
      ),
      league(model),
      team("team-a"),
      roster(model, "team-a"),
      model,
      authority(),
      originalFirst,
    );
    const correctedMatchup = calculateFantasyMatchup(
      matchupInput("matchup-v1", {
        auditId: "audit-matchup-v1",
        calculatedAt: CORRECTED,
        revision: 1,
        previousResultId: originalMatchup.id,
        correctionReason: "Official statistic correction",
      }),
      correctedFirst,
      second,
      authority(),
      originalMatchup,
    );
    const correctedStandings = calculateFantasyStandings(
      {
        resultId: "standings-v1",
        auditId: "audit-standings-v1",
        accountId: "account-a",
        fantasyLeagueId: "fantasy-league-a",
        calculatedAt: CORRECTED,
        revision: 1,
        previousResultId: originalStandings.id,
        correctionReason: "Official statistic correction",
        regularSeasonComplete: true,
        playoffTeamCount: 1,
        teams: [
          { fantasyTeamId: "team-a", predeclaredSeed: 1 },
          { fantasyTeamId: "team-b", predeclaredSeed: 2 },
        ],
      },
      [correctedMatchup],
      authority(),
      originalStandings,
    );

    expect(originalMatchup.winnerTeamId).toBe("team-a");
    expect(correctedMatchup).toMatchObject({
      revision: 1,
      winnerTeamId: "team-b",
      correction: { previousResultId: originalMatchup.id },
      lineage: { sourceRevisions: [10, 12], correctionRevisions: [0, 1] },
    });
    expect(originalStandings.records[0]!.fantasyTeamId).toBe("team-a");
    expect(correctedStandings.records[0]).toMatchObject({
      fantasyTeamId: "team-b",
      playoffQualification: "QUALIFIED",
    });
    expect(correctedStandings.correction).toMatchObject({
      previousResultId: originalStandings.id,
    });
    expect(correctedStandings.lineage).toMatchObject({
      fantasyModelVersionId: "fantasy-model-a-v1",
      sourceRevisions: [10, 12],
      correctionRevisions: [0, 1],
    });
  });

  it("rejects cross-Account matchups and malformed standings", () => {
    const model = activeModel();
    const first = finalTeamResult(model, "team-a", 1);
    const second = finalTeamResult(model, "team-b", 2);
    expect(() =>
      calculateFantasyMatchup(
        matchupInput("matchup-invalid", { accountId: "account-b" }),
        first,
        second,
        authority({ accountId: "account-b" }),
      ),
    ).toThrowError(expect.objectContaining({ code: "ACCOUNT_MISMATCH" }));

    const otherModel = activeModel({
      modelVersionId: "fantasy-model-a-v2",
      version: 2,
      name: "Weekly points v2",
    });
    expect(() =>
      calculateFantasyMatchup(
        matchupInput("matchup-rules-mismatch"),
        first,
        finalTeamResult(otherModel, "team-b", 2),
        authority(),
      ),
    ).toThrowError(expect.objectContaining({ code: "MATCHUP_INVALID" }));

    const matchup = calculateFantasyMatchup(
      matchupInput("matchup-valid"),
      first,
      second,
      authority(),
    );
    expect(() =>
      calculateFantasyStandings(
        {
          resultId: "standings-invalid",
          auditId: "audit-standings-invalid",
          accountId: "account-a",
          fantasyLeagueId: "fantasy-league-a",
          calculatedAt: CALCULATED,
          revision: 0,
          previousResultId: null,
          correctionReason: null,
          regularSeasonComplete: true,
          playoffTeamCount: 1,
          teams: [
            { fantasyTeamId: "team-a", predeclaredSeed: 1 },
            { fantasyTeamId: "team-a", predeclaredSeed: 2 },
          ],
        },
        [matchup],
        authority(),
      ),
    ).toThrowError(expect.objectContaining({ code: "STANDINGS_INVALID" }));
  });
});
