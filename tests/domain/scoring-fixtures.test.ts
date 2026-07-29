import { describe, expect, it } from "vitest";

import {
  GameEventError,
  replayGame,
  type AcceptedEvent,
  type EventBody,
  type GameState,
  type RunnerMovement,
} from "@/domain/events/event-log";

import {
  ScoringFixtureBuilder,
  createScoringSetup,
  currentFixtureBatter,
  fixturePlayer,
  plateAppearance,
  routineOut,
  runnerMovement,
} from "../fixtures/scoring-fixture-builder";

const start = { eventType: "GameStarted", payload: {} } satisfies EventBody;

function expectGameError(action: () => unknown, code: GameEventError["code"]) {
  expect(action).toThrowError(
    expect.objectContaining({ name: "GameEventError", code }),
  );
}

function batterOut(
  state: GameState,
  putout: string,
  overrides: Partial<RunnerMovement> = {},
): EventBody {
  const batterId = currentFixtureBatter(state);
  const fieldingSide = state.half === "TOP" ? "HOME" : "AWAY";
  const pitcherId = state.activePitcher[fieldingSide];
  return plateAppearance(
    batterId,
    pitcherId,
    "BATTER_OUT",
    [
      runnerMovement(batterId, "BATTER", "OUT", pitcherId, {
        out: {
          outNumber: state.outs + 1,
          force: false,
          fielders: [putout],
        },
        ...overrides,
      }),
    ],
    {
      fieldingCredits: [
        { fielderId: putout, credit: "PUTOUT", errorType: null },
      ],
    },
  );
}

function appendThreeOuts(builder: ScoringFixtureBuilder): void {
  for (let index = 0; index < 3; index += 1) {
    const state = builder.state();
    const side = state.half === "TOP" ? "HOME" : "AWAY";
    builder.append(
      routineOut(state, fixturePlayer(builder.setup, side, 1)),
      `${state.inning}-${state.half}-out-${index + 1}`,
    );
  }
}

function battingLine(builder: ScoringFixtureBuilder, playerId: string) {
  const line = builder
    .statistics()
    .batting.find((candidate) => candidate.playerId === playerId);
  if (!line) throw new Error(`Missing batting line for ${playerId}.`);
  return line;
}

function pitchingLine(builder: ScoringFixtureBuilder, playerId: string) {
  const line = builder
    .statistics()
    .pitching.find((candidate) => candidate.playerId === playerId);
  if (!line) throw new Error(`Missing pitching line for ${playerId}.`);
  return line;
}

describe("representative scoring fixtures", () => {
  it("plays a multi-inning regulation game with reconciled box and player lines", () => {
    const builder = new ScoringFixtureBuilder();
    const awayPitcher = fixturePlayer(builder.setup, "AWAY", "pitcher");
    const homePitcher = fixturePlayer(builder.setup, "HOME", "pitcher");
    const awayFour = fixturePlayer(builder.setup, "AWAY", 4);
    const homeFour = fixturePlayer(builder.setup, "HOME", 4);
    const homeFive = fixturePlayer(builder.setup, "HOME", 5);

    builder.start();
    appendThreeOuts(builder);
    appendThreeOuts(builder);
    expect(builder.state()).toMatchObject({
      inning: 2,
      half: "TOP",
      outs: 0,
      battingOrderIndex: { AWAY: 3, HOME: 3 },
      score: { AWAY: 0, HOME: 0 },
    });

    builder.append(
      plateAppearance(awayFour, homePitcher, "HOME_RUN", [
        runnerMovement(awayFour, "BATTER", "HOME", homePitcher),
      ]),
      "away-go-ahead-home-run",
    );
    appendThreeOuts(builder);
    builder.append(
      plateAppearance(homeFour, awayPitcher, "WALK", [
        runnerMovement(homeFour, "BATTER", "FIRST", awayPitcher, {
          cause: "AWARD",
          forced: true,
        }),
      ]),
      "home-walk",
    );
    builder.append(
      plateAppearance(homeFive, awayPitcher, "HOME_RUN", [
        runnerMovement(homeFour, "FIRST", "HOME", awayPitcher),
        runnerMovement(homeFive, "BATTER", "HOME", awayPitcher),
      ]),
      "home-two-run-home-run",
    );
    builder.append({
      eventType: "GameCompleted",
      payload: { ending: "REGULATION", reasonCode: "regulation-complete" },
    });

    const state = builder.state();
    const statistics = builder.statistics();
    expect(state).toMatchObject({
      status: "COMPLETED",
      inning: 2,
      half: "BOTTOM",
      outs: 0,
      score: { AWAY: 1, HOME: 2 },
      bases: { FIRST: null, SECOND: null, THIRD: null },
      sourceRevision: 14,
    });
    expect(statistics.finalScore).toEqual({ AWAY: 1, HOME: 2 });
    expect(statistics.outcome).toBe("HOME_WIN");
    expect(statistics.inningLines).toEqual([
      { inning: 1, side: "AWAY", runs: 0 },
      { inning: 1, side: "HOME", runs: 0 },
      { inning: 2, side: "AWAY", runs: 1 },
      { inning: 2, side: "HOME", runs: 2 },
    ]);
    expect(statistics.teams.AWAY.batting).toMatchObject({
      runs: 1,
      hits: 1,
      homeRuns: 1,
    });
    expect(statistics.teams.HOME.batting).toMatchObject({
      runs: 2,
      hits: 1,
      homeRuns: 1,
      walks: 1,
    });
    expect(battingLine(builder, homeFive).counters).toMatchObject({
      plateAppearances: 1,
      atBats: 1,
      homeRuns: 1,
      runs: 1,
      runsBattedIn: 2,
    });
    expect(pitchingLine(builder, awayPitcher).counters).toMatchObject({
      outsRecorded: 3,
      hitsAllowed: 1,
      runsAllowed: 2,
      earnedRuns: 2,
      walks: 1,
    });
  });

  it("distinguishes walk and strikeout PA/AB treatment and preserves inning state", () => {
    const builder = new ScoringFixtureBuilder();
    const batterOne = fixturePlayer(builder.setup, "AWAY", 1);
    const batterTwo = fixturePlayer(builder.setup, "AWAY", 2);
    const pitcher = fixturePlayer(builder.setup, "HOME", "pitcher");
    const catcher = fixturePlayer(builder.setup, "HOME", 1);
    builder.start();
    builder.append(
      plateAppearance(batterOne, pitcher, "WALK", [
        runnerMovement(batterOne, "BATTER", "FIRST", pitcher, {
          cause: "AWARD",
          forced: true,
        }),
      ]),
      "walk",
    );
    builder.append(
      routineOut(builder.state(), catcher, "STRIKEOUT_LOOKING"),
      "strikeout",
    );

    expect(builder.checkpoint("walk")).toMatchObject({
      inning: 1,
      half: "TOP",
      outs: 0,
      bases: { FIRST: batterOne, SECOND: null, THIRD: null },
      sourceRevision: 2,
    });
    expect(builder.state()).toMatchObject({
      outs: 1,
      bases: { FIRST: batterOne, SECOND: null, THIRD: null },
      battingOrderIndex: { AWAY: 2, HOME: 0 },
    });
    expect(battingLine(builder, batterOne)).toMatchObject({
      counters: { plateAppearances: 1, atBats: 0, walks: 1 },
      rates: {
        battingAverage: null,
        onBasePercentage: { numerator: 1, denominator: 1 },
      },
    });
    expect(battingLine(builder, batterTwo).counters).toMatchObject({
      plateAppearances: 1,
      atBats: 1,
      strikeouts: 1,
    });
    expect(pitchingLine(builder, pitcher).counters).toMatchObject({
      battersFaced: 2,
      walks: 1,
      strikeouts: 1,
      outsRecorded: 1,
    });
  });

  it("records reach-on-error, unearned advancement, and explicit fielding attribution", () => {
    const builder = new ScoringFixtureBuilder();
    const batterOne = fixturePlayer(builder.setup, "AWAY", 1);
    const batterTwo = fixturePlayer(builder.setup, "AWAY", 2);
    const pitcher = fixturePlayer(builder.setup, "HOME", "pitcher");
    const fielder = fixturePlayer(builder.setup, "HOME", 1);
    builder.start();
    builder.append(
      plateAppearance(
        batterOne,
        pitcher,
        "REACHED_ON_ERROR",
        [
          runnerMovement(batterOne, "BATTER", "FIRST", pitcher, {
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
    builder.append(
      plateAppearance(batterTwo, pitcher, "DOUBLE", [
        runnerMovement(batterOne, "FIRST", "HOME", pitcher, {
          rbiEligible: false,
          earnedRun: "UNEARNED",
        }),
        runnerMovement(batterTwo, "BATTER", "SECOND", pitcher),
      ]),
    );

    const statistics = builder.statistics();
    expect(builder.state()).toMatchObject({
      score: { AWAY: 1, HOME: 0 },
      bases: { FIRST: null, SECOND: batterTwo, THIRD: null },
    });
    expect(statistics.teams.AWAY.batting).toMatchObject({
      runs: 1,
      hits: 1,
      doubles: 1,
      reachedOnError: 1,
    });
    expect(statistics.teams.HOME.fielding.errors).toBe(1);
    expect(pitchingLine(builder, pitcher).counters).toMatchObject({
      hitsAllowed: 1,
      runsAllowed: 1,
      earnedRuns: 0,
    });
    expect(battingLine(builder, batterTwo).counters.runsBattedIn).toBe(0);
  });

  it("scores sacrifice fly and bunt without charging at-bats", () => {
    const builder = new ScoringFixtureBuilder();
    const [one, two, three, four] = [1, 2, 3, 4].map((order) =>
      fixturePlayer(builder.setup, "AWAY", order),
    );
    const pitcher = fixturePlayer(builder.setup, "HOME", "pitcher");
    const catcher = fixturePlayer(builder.setup, "HOME", 1);
    builder.start();
    builder.append(
      plateAppearance(one!, pitcher, "TRIPLE", [
        runnerMovement(one!, "BATTER", "THIRD", pitcher),
      ]),
    );
    builder.append(
      plateAppearance(two!, pitcher, "SACRIFICE_FLY", [
        runnerMovement(one!, "THIRD", "HOME", pitcher, {
          cause: "SACRIFICE",
        }),
        runnerMovement(two!, "BATTER", "OUT", pitcher, {
          cause: "SACRIFICE",
          out: {
            outNumber: 1,
            force: false,
            fielders: [catcher],
          },
        }),
      ]),
    );
    builder.append(
      plateAppearance(three!, pitcher, "SINGLE", [
        runnerMovement(three!, "BATTER", "FIRST", pitcher),
      ]),
    );
    builder.append(
      plateAppearance(four!, pitcher, "SACRIFICE_BUNT", [
        runnerMovement(three!, "FIRST", "SECOND", pitcher, {
          cause: "SACRIFICE",
        }),
        runnerMovement(four!, "BATTER", "OUT", pitcher, {
          cause: "SACRIFICE",
          out: {
            outNumber: 2,
            force: false,
            fielders: [catcher],
          },
        }),
      ]),
    );

    expect(builder.state()).toMatchObject({
      outs: 2,
      score: { AWAY: 1, HOME: 0 },
      bases: { FIRST: null, SECOND: three, THIRD: null },
    });
    expect(battingLine(builder, two!).counters).toMatchObject({
      plateAppearances: 1,
      atBats: 0,
      sacrificeFlies: 1,
      runsBattedIn: 1,
    });
    expect(battingLine(builder, four!).counters).toMatchObject({
      plateAppearances: 1,
      atBats: 0,
      sacrificeHits: 1,
    });
  });

  it("tracks stolen bases and caught stealing with base, out, and player attribution", () => {
    const builder = new ScoringFixtureBuilder();
    const runner = fixturePlayer(builder.setup, "AWAY", 1);
    const pitcher = fixturePlayer(builder.setup, "HOME", "pitcher");
    const catcher = fixturePlayer(builder.setup, "HOME", 1);
    builder.start();
    builder.append(
      plateAppearance(runner, pitcher, "SINGLE", [
        runnerMovement(runner, "BATTER", "FIRST", pitcher),
      ]),
    );
    builder.append({
      eventType: "StolenBaseAttemptRecorded",
      payload: {
        runnerId: runner,
        from: "FIRST",
        to: "SECOND",
        result: "STOLEN_BASE",
        responsiblePitcherId: pitcher,
        fielders: [],
      },
    });
    builder.append({
      eventType: "StolenBaseAttemptRecorded",
      payload: {
        runnerId: runner,
        from: "SECOND",
        to: "THIRD",
        result: "STOLEN_BASE",
        responsiblePitcherId: pitcher,
        fielders: [],
      },
    });
    builder.append({
      eventType: "StolenBaseAttemptRecorded",
      payload: {
        runnerId: runner,
        from: "THIRD",
        to: "HOME",
        result: "CAUGHT_STEALING",
        responsiblePitcherId: pitcher,
        fielders: [catcher],
      },
    });

    expect(builder.state()).toMatchObject({
      outs: 1,
      score: { AWAY: 0, HOME: 0 },
      bases: { FIRST: null, SECOND: null, THIRD: null },
    });
    expect(battingLine(builder, runner).counters).toMatchObject({
      hits: 1,
      stolenBases: 2,
      caughtStealing: 1,
    });
    expect(pitchingLine(builder, pitcher).counters.outsRecorded).toBe(1);
    expect(
      builder.statistics().fielding.find(({ playerId }) => playerId === catcher)
        ?.counters.putouts,
    ).toBe(1);
  });

  it("treats an inning-ending double play as one atomic event", () => {
    const builder = new ScoringFixtureBuilder();
    const runner = fixturePlayer(builder.setup, "AWAY", 1);
    const batter = fixturePlayer(builder.setup, "AWAY", 3);
    const pitcher = fixturePlayer(builder.setup, "HOME", "pitcher");
    const catcher = fixturePlayer(builder.setup, "HOME", 1);
    const firstBase = fixturePlayer(builder.setup, "HOME", 2);
    const secondBase = fixturePlayer(builder.setup, "HOME", 3);
    builder.start();
    builder.append(
      plateAppearance(runner, pitcher, "SINGLE", [
        runnerMovement(runner, "BATTER", "FIRST", pitcher),
      ]),
    );
    builder.append(batterOut(builder.state(), catcher));
    builder.append(
      plateAppearance(batter, pitcher, "BATTER_OUT", [
        runnerMovement(runner, "FIRST", "OUT", pitcher, {
          cause: "FIELDERS_CHOICE",
          forced: true,
          out: {
            outNumber: 2,
            force: true,
            fielders: [secondBase],
          },
        }),
        runnerMovement(batter, "BATTER", "OUT", pitcher, {
          out: {
            outNumber: 3,
            force: true,
            fielders: [secondBase, firstBase],
          },
        }),
      ]),
      "double-play",
    );

    expect(builder.checkpoint("double-play")).toMatchObject({
      inning: 1,
      half: "BOTTOM",
      outs: 0,
      bases: { FIRST: null, SECOND: null, THIRD: null },
    });
    const statistics = builder.statistics();
    expect(statistics.teams.HOME.pitching.outsRecorded).toBe(3);
    expect(statistics.teams.HOME.fielding).toMatchObject({
      putouts: 3,
      assists: 1,
      doublePlays: 2,
    });
  });

  it("attributes an inherited runner to the removed pitcher and the score to the reliever appearance", () => {
    const builder = new ScoringFixtureBuilder();
    const runner = fixturePlayer(builder.setup, "AWAY", 1);
    const batter = fixturePlayer(builder.setup, "AWAY", 2);
    const starter = fixturePlayer(builder.setup, "HOME", "pitcher");
    const reliever = fixturePlayer(builder.setup, "HOME", "reliever");
    builder.start();
    builder.append(
      plateAppearance(runner, starter, "WALK", [
        runnerMovement(runner, "BATTER", "FIRST", starter, {
          cause: "AWARD",
          forced: true,
        }),
      ]),
    );
    builder.append(
      {
        eventType: "PitchingChangeMade",
        payload: {
          side: "HOME",
          outgoingPitcherId: starter,
          incomingPitcherId: reliever,
          inheritedRunnerIds: [runner],
        },
      },
      "pitching-change",
    );
    builder.append(
      plateAppearance(batter, reliever, "DOUBLE", [
        runnerMovement(runner, "FIRST", "HOME", starter),
        runnerMovement(batter, "BATTER", "SECOND", reliever),
      ]),
    );

    expect(builder.checkpoint("pitching-change")).toMatchObject({
      activePitcher: { HOME: reliever, AWAY: expect.any(String) },
      bases: { FIRST: runner, SECOND: null, THIRD: null },
    });
    expect(pitchingLine(builder, starter).counters).toMatchObject({
      appearances: 1,
      battersFaced: 1,
      runsAllowed: 1,
      earnedRuns: 1,
    });
    expect(pitchingLine(builder, reliever).counters).toMatchObject({
      appearances: 1,
      battersFaced: 1,
      hitsAllowed: 1,
      inheritedRunners: 1,
      inheritedRunnersScored: 1,
      runsAllowed: 0,
      outsRecorded: 0,
    });
  });

  it("continues both lineups into extra innings and completes without a nine-inning assumption", () => {
    const builder = new ScoringFixtureBuilder(
      createScoringSetup({ scheduledInnings: 1 }),
    );
    const homePitcher = fixturePlayer(builder.setup, "HOME", "pitcher");
    const awayFour = fixturePlayer(builder.setup, "AWAY", 4);
    builder.start();
    appendThreeOuts(builder);
    appendThreeOuts(builder);
    expect(currentFixtureBatter(builder.state())).toBe(awayFour);
    builder.append(
      plateAppearance(awayFour, homePitcher, "HOME_RUN", [
        runnerMovement(awayFour, "BATTER", "HOME", homePitcher),
      ]),
    );
    appendThreeOuts(builder);
    appendThreeOuts(builder);
    builder.append({
      eventType: "GameCompleted",
      payload: { ending: "REGULATION", reasonCode: "extra-inning-complete" },
    });

    expect(builder.state()).toMatchObject({
      status: "COMPLETED",
      inning: 3,
      half: "TOP",
      score: { AWAY: 1, HOME: 0 },
      battingOrderIndex: { AWAY: 7, HOME: 6 },
    });
    expect(builder.statistics()).toMatchObject({
      outcome: "AWAY_WIN",
      finalScore: { AWAY: 1, HOME: 0 },
    });
  });

  it("keeps accepted history immutable while correction replay changes state and statistics deterministically", () => {
    const builder = new ScoringFixtureBuilder();
    const batter = fixturePlayer(builder.setup, "AWAY", 1);
    const pitcher = fixturePlayer(builder.setup, "HOME", "pitcher");
    const fielder = fixturePlayer(builder.setup, "HOME", 1);
    builder.start();
    const original = builder.append(
      plateAppearance(batter, pitcher, "SINGLE", [
        runnerMovement(batter, "BATTER", "FIRST", pitcher),
      ]),
      "original-hit",
    );
    const immutableOriginal = structuredClone(original);
    const before = builder.statistics();
    builder.append(
      {
        eventType: "CorrectionApplied",
        payload: {
          policy: "REPLACE_JUDGMENT",
          targetEventIds: [original.id],
          replacements: [
            {
              id: `${builder.setup.gameId}-replacement-error`,
              order: 0,
              targetEventId: original.id,
              body: plateAppearance(
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
                    {
                      fielderId: fielder,
                      credit: "ERROR",
                      errorType: "FIELDING",
                    },
                  ],
                },
              ),
            },
          ],
          reasonCode: "official-scoring-change",
        },
      },
      "hit-to-error-correction",
    );
    const after = builder.statistics();
    const repeated = builder.statistics();

    expect(builder.events()[1]).toEqual(immutableOriginal);
    expect(before.teams.AWAY.batting.hits).toBe(1);
    expect(before.metadata.sourceRevision).toBe(2);
    expect(after.teams.AWAY.batting).toMatchObject({
      hits: 0,
      reachedOnError: 1,
    });
    expect(after.teams.HOME.fielding.errors).toBe(1);
    expect(after.metadata.sourceRevision).toBe(3);
    expect(repeated).toEqual(after);
    expect(replayGame(builder.setup, builder.events()).state).toEqual(
      builder.state(),
    );
  });
});

describe("lifecycle fixtures", () => {
  it("covers suspend/resume, substitution, defensive alignment, and abandonment", () => {
    const builder = new ScoringFixtureBuilder();
    const outgoing = fixturePlayer(builder.setup, "HOME", 5);
    const incoming = fixturePlayer(builder.setup, "HOME", "bench");
    const catcher = fixturePlayer(builder.setup, "HOME", 1);
    const firstBase = fixturePlayer(builder.setup, "HOME", 2);
    builder.start();
    builder.append({
      eventType: "GameSuspended",
      payload: { reasonCode: "weather" },
    });
    expect(builder.state().status).toBe("SUSPENDED");
    builder.append({ eventType: "GameResumed", payload: {} });
    builder.append({
      eventType: "DefensiveSubstitutionMade",
      payload: {
        side: "HOME",
        outgoingPlayerId: outgoing,
        incomingPlayerId: incoming,
        position: "LEFT_FIELD",
      },
    });
    builder.append({
      eventType: "DefensiveAlignmentChanged",
      payload: {
        side: "HOME",
        assignments: [
          { playerId: catcher, position: "FIRST_BASE" },
          { playerId: firstBase, position: "CATCHER" },
        ],
        reasonCode: "defensive-swap",
      },
    });
    builder.append({
      eventType: "GameAbandoned",
      payload: { reasonCode: "field-unplayable" },
    });

    expect(builder.state()).toMatchObject({
      status: "ABANDONED",
      defense: {
        HOME: {
          LEFT_FIELD: incoming,
          FIRST_BASE: catcher,
          CATCHER: firstBase,
        },
      },
      sourceRevision: 6,
    });
    expect(
      builder
        .state()
        .lineups.HOME.find(({ playerId }) => playerId === incoming),
    ).toMatchObject({ active: true, battingOrder: 5, position: "LEFT_FIELD" });
  });

  it("covers cancellation, walk-off completion, and verified correction requiring reverification", () => {
    const cancelled = new ScoringFixtureBuilder();
    cancelled.append({
      eventType: "GameCancelled",
      payload: { reasonCode: "facility-unavailable" },
    });
    expect(cancelled.state().status).toBe("CANCELLED");

    const walkoff = new ScoringFixtureBuilder(
      createScoringSetup({ scheduledInnings: 1 }),
    );
    walkoff.start();
    appendThreeOuts(walkoff);
    const homeBatter = fixturePlayer(walkoff.setup, "HOME", 1);
    const awayPitcher = fixturePlayer(walkoff.setup, "AWAY", "pitcher");
    const walkoffBody = plateAppearance(homeBatter, awayPitcher, "HOME_RUN", [
      runnerMovement(homeBatter, "BATTER", "HOME", awayPitcher),
    ]);
    const walkoffEvent = walkoff.append(walkoffBody);
    walkoff.append({
      eventType: "GameCompleted",
      payload: { ending: "WALK_OFF", reasonCode: "walk-off" },
    });
    walkoff.append({ eventType: "GameVerified", payload: {} });
    walkoff.append({
      eventType: "GameReopened",
      payload: { reasonCode: "official-review" },
    });
    expect(walkoff.state().status).toBe("CORRECTED");
    walkoff.append({
      eventType: "CorrectionApplied",
      payload: {
        policy: "REPLACE_JUDGMENT",
        targetEventIds: [walkoffEvent.id],
        replacements: [
          {
            id: `${walkoff.setup.gameId}-reviewed-walkoff`,
            order: 0,
            targetEventId: walkoffEvent.id,
            body: walkoffBody,
          },
        ],
        reasonCode: "review-confirmed-home-run",
      },
    });
    expect(walkoff.state().status).toBe("CORRECTED");
    walkoff.append({ eventType: "GameVerified", payload: {} });
    expect(walkoff.state().status).toBe("VERIFIED");
    expect(walkoff.statistics().metadata.seasonEligibility).toBe("INCLUDED");
  });
});

describe("negative scoring fixtures", () => {
  it("rejects wrong batters, impossible bases, fourth-out plays, and partial atomic plays", () => {
    const wrongBatter = new ScoringFixtureBuilder();
    wrongBatter.start();
    const pitcher = fixturePlayer(wrongBatter.setup, "HOME", "pitcher");
    const secondBatter = fixturePlayer(wrongBatter.setup, "AWAY", 2);
    expectGameError(
      () =>
        wrongBatter.append(
          plateAppearance(secondBatter, pitcher, "SINGLE", [
            runnerMovement(secondBatter, "BATTER", "FIRST", pitcher),
          ]),
        ),
      "INVALID_LINEUP",
    );

    const occupied = new ScoringFixtureBuilder();
    occupied.start();
    const first = fixturePlayer(occupied.setup, "AWAY", 1);
    occupied.append(
      plateAppearance(first, pitcher, "SINGLE", [
        runnerMovement(first, "BATTER", "FIRST", pitcher),
      ]),
    );
    const second = fixturePlayer(occupied.setup, "AWAY", 2);
    expectGameError(
      () =>
        occupied.append(
          plateAppearance(second, pitcher, "WALK", [
            runnerMovement(second, "BATTER", "FIRST", pitcher, {
              cause: "AWARD",
              forced: true,
            }),
          ]),
        ),
      "INVALID_RUNNER_MOVEMENT",
    );

    const tooManyOuts = new ScoringFixtureBuilder();
    tooManyOuts.start();
    const catcher = fixturePlayer(tooManyOuts.setup, "HOME", 1);
    const firstRunner = fixturePlayer(tooManyOuts.setup, "AWAY", 1);
    tooManyOuts.append(
      plateAppearance(firstRunner, pitcher, "SINGLE", [
        runnerMovement(firstRunner, "BATTER", "FIRST", pitcher),
      ]),
    );
    tooManyOuts.append(batterOut(tooManyOuts.state(), catcher));
    tooManyOuts.append(batterOut(tooManyOuts.state(), catcher));
    const batter = currentFixtureBatter(tooManyOuts.state());
    expectGameError(
      () =>
        tooManyOuts.append(
          plateAppearance(batter, pitcher, "BATTER_OUT", [
            runnerMovement(batter, "BATTER", "OUT", pitcher, {
              out: {
                outNumber: 2,
                force: false,
                fielders: [catcher],
              },
            }),
            runnerMovement(firstRunner, "FIRST", "OUT", pitcher, {
              out: {
                outNumber: 3,
                force: false,
                fielders: [catcher],
              },
            }),
          ]),
        ),
      "INVALID_BASEBALL_TRANSITION",
    );
  });

  it("rejects invalid substitutions and scoring in terminal or suspended states", () => {
    const suspended = new ScoringFixtureBuilder();
    suspended.start();
    suspended.append({
      eventType: "GameSuspended",
      payload: { reasonCode: "weather" },
    });
    expectGameError(
      () =>
        suspended.append(
          routineOut(
            suspended.state(),
            fixturePlayer(suspended.setup, "HOME", 1),
          ),
        ),
      "INVALID_LIFECYCLE_TRANSITION",
    );

    const cancelled = new ScoringFixtureBuilder();
    cancelled.append({
      eventType: "GameCancelled",
      payload: { reasonCode: "cancelled" },
    });
    expectGameError(
      () => cancelled.append(start),
      "INVALID_LIFECYCLE_TRANSITION",
    );

    const completed = new ScoringFixtureBuilder(
      createScoringSetup({ scheduledInnings: 1 }),
    );
    completed.start();
    appendThreeOuts(completed);
    const homeBatter = fixturePlayer(completed.setup, "HOME", 1);
    const awayPitcher = fixturePlayer(completed.setup, "AWAY", "pitcher");
    completed.append(
      plateAppearance(homeBatter, awayPitcher, "HOME_RUN", [
        runnerMovement(homeBatter, "BATTER", "HOME", awayPitcher),
      ]),
    );
    completed.append({
      eventType: "GameCompleted",
      payload: { ending: "WALK_OFF", reasonCode: "complete" },
    });
    expectGameError(
      () =>
        completed.append(
          routineOut(
            completed.state(),
            fixturePlayer(completed.setup, "AWAY", 1),
          ),
        ),
      "INVALID_LIFECYCLE_TRANSITION",
    );

    const substitution = new ScoringFixtureBuilder();
    substitution.start();
    expectGameError(
      () =>
        substitution.append({
          eventType: "DefensiveSubstitutionMade",
          payload: {
            side: "AWAY",
            outgoingPlayerId: fixturePlayer(substitution.setup, "AWAY", 1),
            incomingPlayerId: fixturePlayer(
              substitution.setup,
              "AWAY",
              "bench",
            ),
            position: "CATCHER",
          },
        }),
      "INVALID_LINEUP",
    );
  });

  it("rejects Account/game/version/revision violations and malformed correction graphs", () => {
    const builder = new ScoringFixtureBuilder();
    builder.start();
    const accepted = builder.events()[0]!;

    expectGameError(
      () =>
        replayGame(builder.setup, [
          { ...accepted, accountId: "different-account" },
        ]),
      "ACCOUNT_MISMATCH",
    );
    expectGameError(
      () =>
        replayGame(builder.setup, [{ ...accepted, gameId: "different-game" }]),
      "GAME_MISMATCH",
    );
    expectGameError(
      () =>
        replayGame(builder.setup, [
          { ...accepted, schemaVersion: 999 } as unknown as AcceptedEvent,
        ]),
      "UNSUPPORTED_SCHEMA_VERSION",
    );
    expectGameError(
      () =>
        replayGame(builder.setup, [
          { ...accepted, expectedRevision: 1, acceptedRevision: 2 },
        ]),
      "STALE_SOURCE_REVISION",
    );

    const crossGame = new ScoringFixtureBuilder();
    crossGame.start();
    expectGameError(
      () =>
        crossGame.append({
          eventType: "CorrectionApplied",
          payload: {
            policy: "REVERSE_EVENTS",
            targetEventIds: ["other-game-event"],
            replacements: [],
            reasonCode: "invalid-cross-game-target",
          },
        }),
      "CORRECTION_TARGET_MISSING",
    );

    const correction = new ScoringFixtureBuilder();
    correction.start();
    const pitcher = fixturePlayer(correction.setup, "HOME", "pitcher");
    const batter = fixturePlayer(correction.setup, "AWAY", 1);
    const target = correction.append(
      plateAppearance(batter, pitcher, "SINGLE", [
        runnerMovement(batter, "BATTER", "FIRST", pitcher),
      ]),
    );
    const firstCorrection = correction.append({
      eventType: "CorrectionApplied",
      payload: {
        policy: "REVERSE_EVENTS",
        targetEventIds: [target.id],
        replacements: [],
        reasonCode: "reverse-target",
      },
    });
    expectGameError(
      () =>
        correction.append({
          eventType: "CorrectionApplied",
          payload: {
            policy: "REPLACE_PLAY",
            targetEventIds: [firstCorrection.id],
            replacements: [
              {
                id: "invalid-correction-cycle-replacement",
                order: 0,
                targetEventId: firstCorrection.id,
                body: plateAppearance(batter, pitcher, "SINGLE", [
                  runnerMovement(batter, "BATTER", "FIRST", pitcher),
                ]),
              },
            ],
            reasonCode: "invalid-correction-cycle",
          },
        }),
      "CORRECTION_GRAPH_INVALID",
    );
  });
});
