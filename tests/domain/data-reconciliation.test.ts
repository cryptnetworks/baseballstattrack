import { describe, expect, it } from "vitest";

import {
  reconcileGameData,
  type ReconcileGameDataInput,
} from "@/domain/data-reconciliation";
import { replayGame } from "@/domain/events/event-log";
import { buildGameBoxScore, type BoxScorePresentation } from "@/domain/reports";
import { portableGameSummary } from "@/domain/portable-data";
import {
  STATISTIC_DERIVATION_VERSION,
  deriveGameStatistics,
} from "@/domain/statistics";
import {
  ScoringFixtureBuilder,
  createScoringSetup,
  currentFixtureBatter,
  fixturePlayer,
  plateAppearance,
  routineOut,
  runnerMovement,
} from "../fixtures/scoring-fixture-builder";

function presentation(builder: ScoringFixtureBuilder): BoxScorePresentation {
  return {
    season: { id: "season-a", displayName: "2026" },
    teams: {
      AWAY: { id: "away-team", displayName: "Away" },
      HOME: { id: "home-team", displayName: "Home" },
    },
    players: (["AWAY", "HOME"] as const).flatMap((side) =>
      builder.setup.sides[side].lineup.map((player, index) => ({
        playerId: player.playerId,
        lineupSlotId: `${side.toLowerCase()}-${index}`,
        side,
        displayName: `Player ${index}`,
        jerseyNumber: null,
        battingOrder: player.battingOrder,
        defensivePosition: player.position,
        startingPitcher:
          player.playerId === builder.setup.sides[side].startingPitcherId,
      })),
    ),
  };
}

function appendThreeOuts(builder: ScoringFixtureBuilder) {
  for (let count = 0; count < 3; count += 1) {
    const state = builder.state();
    const defense = state.half === "TOP" ? "HOME" : "AWAY";
    builder.append(routineOut(state, state.defense[defense].CATCHER!));
  }
}

function completedGame() {
  const builder = new ScoringFixtureBuilder(
    createScoringSetup({ scheduledInnings: 1 }),
  );
  builder.start();
  appendThreeOuts(builder);
  const state = builder.state();
  const batter = currentFixtureBatter(state);
  const pitcher = state.activePitcher.AWAY;
  builder.append(
    plateAppearance(batter, pitcher, "HOME_RUN", [
      runnerMovement(batter, "BATTER", "HOME", pitcher, { cause: "HIT" }),
    ]),
  );
  appendThreeOuts(builder);
  builder.append({
    eventType: "GameCompleted",
    payload: { reasonCode: "REGULATION", ending: "REGULATION" },
  });
  return builder;
}

function appendHomeRun(builder: ScoringFixtureBuilder) {
  const state = builder.state();
  const batter = currentFixtureBatter(state);
  const defense = state.half === "TOP" ? "HOME" : "AWAY";
  const pitcher = state.activePitcher[defense];
  builder.append(
    plateAppearance(batter, pitcher, "HOME_RUN", [
      runnerMovement(batter, "BATTER", "HOME", pitcher, { cause: "HIT" }),
    ]),
  );
}

function input(
  builder: ScoringFixtureBuilder,
  overrides: Partial<ReconcileGameDataInput> = {},
): ReconcileGameDataInput {
  const events = builder.events();
  const sourceRevision = events.at(-1)?.acceptedRevision ?? 0;
  return {
    setup: builder.setup,
    events,
    presentation: presentation(builder),
    privacyOverlayRevision: 0,
    generatedAt: "2026-07-31T16:00:00.000Z",
    projection: {
      sourceRevision,
      privacyOverlayRevision: 0,
      derivationVersion: STATISTIC_DERIVATION_VERSION,
      status: "CURRENT",
    },
    ...overrides,
  };
}

describe("deterministic game data reconciliation", () => {
  it("reports verified confidence with reproducible provenance", () => {
    const builder = new ScoringFixtureBuilder();
    builder.append({
      eventType: "GameCancelled",
      payload: { reasonCode: "NO_OPPONENT" },
    });
    const first = reconcileGameData(input(builder));
    const repeated = reconcileGameData(input(builder));

    expect(first).toEqual(repeated);
    expect(first).toMatchObject({
      confidence: "CURRENT",
      freshness: "CURRENT",
      blocking: false,
      provenance: {
        sourceRevision: 1,
        effectiveEventCount: 1,
        correctionCount: 0,
      },
    });
    expect(first.findings).toEqual([
      expect.objectContaining({
        category: "VERIFICATION",
        code: "GAME_TERMINATED_UNVERIFIED",
        severity: "WARNING",
      }),
    ]);
  });

  it("distinguishes incomplete and stale derived data from integrity failure", () => {
    const builder = new ScoringFixtureBuilder();
    builder.start();
    expect(reconcileGameData(input(builder)).confidence).toBe("INCOMPLETE");
    expect(
      reconcileGameData(input(builder, { projection: null })),
    ).toMatchObject({
      confidence: "INCOMPLETE",
      freshness: "INCOMPLETE",
      findings: expect.arrayContaining([
        expect.objectContaining({ code: "PROJECTION_MISSING" }),
      ]),
    });

    const stale = reconcileGameData(
      input(builder, {
        projection: {
          sourceRevision: 0,
          privacyOverlayRevision: 0,
          derivationVersion: STATISTIC_DERIVATION_VERSION,
          status: "STALE",
        },
      }),
    );
    expect(stale).toMatchObject({
      confidence: "STALE",
      blocking: false,
      findings: expect.arrayContaining([
        expect.objectContaining({
          code: "PROJECTION_STALE",
          remediation: "REBUILD_PROJECTION",
        }),
      ]),
    });
  });

  it("distinguishes verified history from corrected history awaiting reverification", () => {
    const verified = completedGame();
    verified.append({ eventType: "GameVerified", payload: {} });
    expect(reconcileGameData(input(verified))).toMatchObject({
      confidence: "VERIFIED",
      findings: [],
    });

    verified.append({
      eventType: "GameReopened",
      payload: { reasonCode: "OFFICIAL_SCORING_REVIEW" },
    });
    const target = verified
      .events()
      .find(({ eventType }) => eventType === "PlateAppearanceRecorded");
    if (!target || target.eventType !== "PlateAppearanceRecorded") {
      throw new Error("Fixture plate appearance is missing.");
    }
    verified.append({
      eventType: "CorrectionApplied",
      payload: {
        policy: "REPLACE_JUDGMENT",
        targetEventIds: [target.id],
        replacements: [
          {
            id: "corrected-plate-appearance",
            order: 0,
            targetEventId: target.id,
            body: {
              eventType: target.eventType,
              payload: target.payload,
            },
          },
        ],
        reasonCode: "OFFICIAL_SCORING_REVIEW",
      },
    });
    expect(reconcileGameData(input(verified))).toMatchObject({
      confidence: "CORRECTED",
      blocking: false,
      findings: expect.arrayContaining([
        expect.objectContaining({
          code: "CORRECTED_HISTORY_REQUIRES_VERIFICATION",
          remediation: "REVERIFY_GAME",
        }),
      ]),
    });
  });

  it("accepts extra innings, pitching changes, and fielding errors", () => {
    const extra = new ScoringFixtureBuilder(
      createScoringSetup({ scheduledInnings: 1 }),
    );
    extra.start();
    appendThreeOuts(extra);
    appendThreeOuts(extra);
    appendHomeRun(extra);
    appendThreeOuts(extra);
    appendThreeOuts(extra);
    extra.append({
      eventType: "GameCompleted",
      payload: { reasonCode: "EXTRA_INNINGS", ending: "REGULATION" },
    });

    const pitching = new ScoringFixtureBuilder();
    pitching.start();
    pitching.append({
      eventType: "PitchingChangeMade",
      payload: {
        side: "HOME",
        outgoingPitcherId: fixturePlayer(pitching.setup, "HOME", "pitcher"),
        incomingPitcherId: fixturePlayer(pitching.setup, "HOME", "reliever"),
        inheritedRunnerIds: [],
      },
    });

    const fielding = new ScoringFixtureBuilder();
    fielding.start();
    const batter = fixturePlayer(fielding.setup, "AWAY", 1);
    const pitcher = fixturePlayer(fielding.setup, "HOME", "pitcher");
    const fielder = fixturePlayer(fielding.setup, "HOME", 1);
    fielding.append(
      plateAppearance(
        batter,
        pitcher,
        "REACHED_ON_ERROR",
        [
          runnerMovement(batter, "BATTER", "FIRST", pitcher, {
            cause: "ERROR",
          }),
        ],
        {
          fieldingCredits: [
            { fielderId: fielder, credit: "ERROR", errorType: "FIELDING" },
          ],
        },
      ),
    );

    for (const fixture of [extra, pitching, fielding]) {
      expect(reconcileGameData(input(fixture)).blocking).toBe(false);
    }
    expect(reconcileGameData(input(extra)).confidence).toBe("CURRENT");
    expect(reconcileGameData(input(pitching)).confidence).toBe("INCOMPLETE");
    expect(reconcileGameData(input(fielding)).confidence).toBe("INCOMPLETE");
  });

  it("finds score, base-out, player, team, rate, report, and export discrepancies", () => {
    const builder = new ScoringFixtureBuilder();
    builder.start();
    const batter = fixturePlayer(builder.setup, "AWAY", 1);
    const pitcher = fixturePlayer(builder.setup, "HOME", "pitcher");
    builder.append(
      plateAppearance(batter, pitcher, "SINGLE", [
        runnerMovement(batter, "BATTER", "FIRST", pitcher),
      ]),
    );
    const canonical = input(builder);
    const statistics = deriveGameStatistics({
      setup: builder.setup,
      events: builder.events(),
    });
    const observedStatistics = structuredClone(statistics);
    observedStatistics.batting[0]!.counters.hits += 1;
    observedStatistics.teams.AWAY.batting.hits += 1;
    observedStatistics.batting[0]!.rates.battingAverage = null;
    observedStatistics.finalScore.HOME += 1;
    observedStatistics.inningLines.push({ inning: 99, side: "HOME", runs: 1 });
    observedStatistics.metadata.lifecycleStatus = "SUSPENDED";
    const observedState = structuredClone(
      replayGame(builder.setup, builder.events()).state,
    );
    observedState.score.AWAY += 1;
    observedState.outs = 1;
    const observedReport = buildGameBoxScore({
      setup: builder.setup,
      events: builder.events(),
      presentation: presentation(builder),
      privacyOverlayRevision: 0,
      generatedAt: canonical.generatedAt,
    });
    observedReport.score.AWAY += 1;
    const observedExport = structuredClone(portableGameSummary(statistics));
    observedExport.finalScore.AWAY += 1;

    const result = reconcileGameData({
      ...canonical,
      observations: {
        replayState: observedState,
        statistics: observedStatistics,
        boxScore: observedReport,
        exportSummary: observedExport,
      },
    });
    expect(result.confidence).toBe("INTEGRITY_FAILURE");
    expect(result.blocking).toBe(true);
    expect(result.findings.map(({ category }) => category)).toEqual(
      expect.arrayContaining([
        "SCORE",
        "OUTS_AND_RUNNERS",
        "REPLAY_STATE",
        "PLAYER_TOTALS",
        "TEAM_TOTALS",
        "DERIVED_RATES",
        "REPORT",
        "EXPORT",
        "VERIFICATION",
      ]),
    );
    expect(result.findings.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "STATISTIC_SCORE_MISMATCH",
        "INNING_LINE_MISMATCH",
        "VERIFICATION_STATE_MISMATCH",
      ]),
    );
  });

  it("keeps report-generation failures distinct from source-history failures", () => {
    const builder = new ScoringFixtureBuilder();
    builder.start();
    const canonical = input(builder);
    const result = reconcileGameData({
      ...canonical,
      presentation: {
        ...canonical.presentation,
        teams: {
          AWAY: canonical.presentation.teams.AWAY,
        } as BoxScorePresentation["teams"],
      },
    });
    expect(result).toMatchObject({
      confidence: "INTEGRITY_FAILURE",
      freshness: "UNKNOWN",
      provenance: {
        replayStateHash: expect.stringMatching(/^sha256:v1:/),
        statisticsHash: expect.stringMatching(/^sha256:v1:/),
        reportHash: null,
      },
      findings: expect.arrayContaining([
        expect.objectContaining({
          category: "REPORT",
          code: "REPORT_GENERATION_FAILED",
        }),
      ]),
    });
    expect(
      result.findings.some(({ category }) => category === "SOURCE_HISTORY"),
    ).toBe(false);
  });

  it("fails closed on altered immutable replay evidence", () => {
    const builder = new ScoringFixtureBuilder();
    builder.start();
    const events = builder.events();
    events[0] = { ...events[0]!, postStateHash: `sha256:v1:${"0".repeat(64)}` };
    const result = reconcileGameData(input(builder, { events }));
    expect(result).toMatchObject({
      confidence: "INTEGRITY_FAILURE",
      freshness: "UNKNOWN",
      blocking: true,
      findings: [
        expect.objectContaining({
          category: "SOURCE_HISTORY",
          code: "SOURCE_EVIDENCE_INVALID",
          severity: "BLOCKING",
        }),
      ],
    });
  });
});
