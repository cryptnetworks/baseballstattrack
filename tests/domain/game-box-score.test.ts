import { describe, expect, it } from "vitest";

import {
  buildGameBoxScore,
  reconcileGameStatistics,
  type BoxScorePresentation,
} from "@/domain/reports";
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

function presentation(
  builder: ScoringFixtureBuilder,
  replacements: Readonly<Record<string, string>> = {},
): BoxScorePresentation {
  return {
    season: { id: "season-1", displayName: "2026 season" },
    teams: {
      AWAY: { id: "away-team", displayName: "Visitors" },
      HOME: { id: "home-team", displayName: "Hosts" },
    },
    players: (["AWAY", "HOME"] as const).flatMap((side) =>
      builder.setup.sides[side].lineup.map((player, index) => ({
        playerId: player.playerId,
        lineupSlotId: `${side.toLowerCase()}-slot-${index + 1}`,
        side,
        displayName:
          replacements[player.playerId] ?? player.playerId.replaceAll("-", " "),
        jerseyNumber: String(index + 1),
        battingOrder: player.battingOrder,
        defensivePosition: player.position,
        startingPitcher:
          player.playerId === builder.setup.sides[side].startingPitcherId,
      })),
    ),
  };
}

function report(
  builder: ScoringFixtureBuilder,
  overrides: Partial<Parameters<typeof buildGameBoxScore>[0]> = {},
) {
  return buildGameBoxScore({
    setup: builder.setup,
    events: builder.events(),
    presentation: presentation(builder),
    privacyOverlayRevision: 0,
    generatedAt: "2026-07-30T20:00:00.000Z",
    ...overrides,
  });
}

function appendThreeOuts(builder: ScoringFixtureBuilder) {
  for (let count = 0; count < 3; count += 1) {
    const state = builder.state();
    const defense = state.half === "TOP" ? "HOME" : "AWAY";
    builder.append(routineOut(state, state.defense[defense].CATCHER!));
  }
}

function homeRun(builder: ScoringFixtureBuilder) {
  const state = builder.state();
  const batter = currentFixtureBatter(state);
  const defense = state.half === "TOP" ? "HOME" : "AWAY";
  const pitcher = state.activePitcher[defense];
  return builder.append(
    plateAppearance(batter, pitcher, "HOME_RUN", [
      runnerMovement(batter, "BATTER", "HOME", pitcher, { cause: "HIT" }),
    ]),
  );
}

function completedRegulation() {
  const builder = new ScoringFixtureBuilder(
    createScoringSetup({ scheduledInnings: 1 }),
  );
  builder.start();
  appendThreeOuts(builder);
  homeRun(builder);
  appendThreeOuts(builder);
  builder.append({
    eventType: "GameCompleted",
    payload: { reasonCode: "REGULATION", ending: "REGULATION" },
  });
  return builder;
}

describe("versioned game box score", () => {
  it("renders a reconciled regulation fixture with lineups and final totals", () => {
    const builder = completedRegulation();
    const box = report(builder);
    expect(box).toMatchObject({
      reportState: "COMPLETED",
      scoreKind: "FINAL",
      score: { AWAY: 0, HOME: 1 },
      correctionStatus: "NONE",
      version: {
        accountId: builder.setup.accountId,
        gameId: builder.setup.gameId,
        setupRevision: 1,
        sourceRevision: builder.state().sourceRevision,
        privacyOverlayRevision: 0,
        freshness: "CURRENT_SOURCE_DERIVED",
        verificationState: "UNVERIFIED",
      },
      reconciliation: { status: "PASSED" },
    });
    expect(box.innings).toEqual([
      { inning: 1, side: "AWAY", runs: 0 },
      { inning: 1, side: "HOME", runs: 1 },
    ]);
    expect(box.teams.HOME.lineup.some(({ started }) => started)).toBe(true);
    expect(box.teams.HOME.totals.batting.homeRuns).toBe(1);
  });

  it("supports extra innings without presenting provisional scores as final", () => {
    const builder = new ScoringFixtureBuilder(
      createScoringSetup({ scheduledInnings: 1 }),
    );
    builder.start();
    appendThreeOuts(builder);
    appendThreeOuts(builder);
    homeRun(builder);
    appendThreeOuts(builder);
    appendThreeOuts(builder);
    builder.append({
      eventType: "GameCompleted",
      payload: { reasonCode: "EXTRA_INNINGS", ending: "REGULATION" },
    });
    expect(report(builder)).toMatchObject({
      reportState: "COMPLETED",
      scoreKind: "FINAL",
      score: { AWAY: 1, HOME: 0 },
      innings: expect.arrayContaining([
        { inning: 2, side: "AWAY", runs: 1 },
        { inning: 2, side: "HOME", runs: 0 },
      ]),
    });

    const live = new ScoringFixtureBuilder();
    live.start();
    expect(report(live)).toMatchObject({
      reportState: "IN_PROGRESS",
      scoreKind: "CURRENT",
    });
  });

  it("reports pitching changes and fielding errors from effective history", () => {
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
    const pitchingBox = report(pitching);
    expect(
      pitchingBox.teams.HOME.lineup.find(
        ({ playerId }) =>
          playerId === fixturePlayer(pitching.setup, "HOME", "reliever"),
      ),
    ).toMatchObject({ active: true, currentPosition: "PITCHER" });

    const fielding = new ScoringFixtureBuilder();
    fielding.start();
    const state = fielding.state();
    const batter = currentFixtureBatter(state);
    const fielder = state.defense.HOME.FIRST_BASE!;
    fielding.append(
      plateAppearance(
        batter,
        state.activePitcher.HOME,
        "REACHED_ON_ERROR",
        [
          runnerMovement(batter, "BATTER", "FIRST", state.activePitcher.HOME, {
            cause: "ERROR",
          }),
        ],
        {
          battedBall: "GROUND_BALL",
          fieldingCredits: [
            { fielderId: fielder, credit: "ERROR", errorType: "FIELDING" },
          ],
        },
      ),
    );
    expect(report(fielding).teams.HOME.totals.fielding.errors).toBe(1);
  });

  it("labels corrected and awaiting-reverification reports", () => {
    const builder = completedRegulation();
    builder.append({ eventType: "GameVerified", payload: {} });
    builder.append({
      eventType: "GameReopened",
      payload: { reasonCode: "SCORER_REVIEW" },
    });
    const target = builder
      .events()
      .find(({ eventType }) => eventType === "PlateAppearanceRecorded")!;
    if (target.eventType !== "PlateAppearanceRecorded") {
      throw new Error("Expected plate appearance fixture.");
    }
    builder.append({
      eventType: "CorrectionApplied",
      payload: {
        policy: "REPLACE_JUDGMENT",
        targetEventIds: [target.id],
        replacements: [
          {
            id: "replacement-same-judgment",
            order: 0,
            targetEventId: target.id,
            body: {
              eventType: "PlateAppearanceRecorded",
              payload: target.payload,
            },
          },
        ],
        reasonCode: "SCORER_REVIEW",
      },
    });
    expect(report(builder)).toMatchObject({
      reportState: "AWAITING_REVERIFICATION",
      correctionStatus: "CORRECTED_HISTORY",
      version: {
        correctionCount: 1,
        verificationState: "UNVERIFIED",
      },
    });
  });

  it("identifies suspended, abandoned, cancelled, and verified states", () => {
    const suspended = new ScoringFixtureBuilder();
    suspended.start();
    suspended.append({
      eventType: "GameSuspended",
      payload: { reasonCode: "WEATHER" },
    });
    expect(report(suspended)).toMatchObject({
      reportState: "SUSPENDED",
      scoreKind: "CURRENT",
    });

    const abandoned = new ScoringFixtureBuilder();
    abandoned.start();
    abandoned.append({
      eventType: "GameAbandoned",
      payload: { reasonCode: "UNSAFE_FIELD" },
    });
    expect(report(abandoned)).toMatchObject({
      reportState: "ABANDONED",
      scoreKind: "TERMINATED",
    });

    const cancelled = new ScoringFixtureBuilder();
    cancelled.append({
      eventType: "GameCancelled",
      payload: { reasonCode: "NO_OPPONENT" },
    });
    expect(report(cancelled)).toMatchObject({
      reportState: "CANCELLED",
      scoreKind: "TERMINATED",
    });

    const verified = completedRegulation();
    verified.append({ eventType: "GameVerified", payload: {} });
    expect(report(verified)).toMatchObject({
      reportState: "VERIFIED",
      scoreKind: "FINAL",
      version: { verificationState: "VERIFIED" },
    });
  });

  it("rejects stale projection identities and reconciliation failures", () => {
    const builder = completedRegulation();
    expect(() =>
      report(builder, {
        projectionCheckpoint: {
          sourceRevision: builder.state().sourceRevision - 1,
          privacyOverlayRevision: 0,
          derivationVersion: STATISTIC_DERIVATION_VERSION,
          status: "CURRENT",
        },
      }),
    ).toThrowError(expect.objectContaining({ code: "STALE_PROJECTION" }));

    const projection = deriveGameStatistics({
      setup: builder.setup,
      events: builder.events(),
    });
    const inconsistent = structuredClone(projection);
    inconsistent.finalScore.HOME += 1;
    expect(() => reconcileGameStatistics(inconsistent)).toThrowError(
      expect.objectContaining({ code: "RECONCILIATION_FAILURE" }),
    );
  });

  it("uses privacy-overlay-resolved presentation without changing baseball totals", () => {
    const builder = completedRegulation();
    const playerId = fixturePlayer(builder.setup, "HOME", 1);
    const original = report(builder);
    const privateReport = report(builder, {
      presentation: presentation(builder, {
        [playerId]: "Protected Player",
      }),
      privacyOverlayRevision: 4,
    });
    expect(
      privateReport.teams.HOME.lineup.find(
        (player) => player.playerId === playerId,
      )?.displayName,
    ).toBe("Protected Player");
    expect(privateReport.score).toEqual(original.score);
    expect(privateReport.teams.HOME.totals).toEqual(original.teams.HOME.totals);
    expect(privateReport.version.privacyOverlayRevision).toBe(4);
  });
});
