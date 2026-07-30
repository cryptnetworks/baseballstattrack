import { describe, expect, it } from "vitest";

import {
  parseEventBody,
  replayGame,
  type EventBody,
  type RunnerMovement,
} from "@/domain/events/event-log";
import {
  previewRunnerPlay,
  type RunnerPlayDraft,
} from "@/features/scoring/runner-interactions";
import {
  ScoringFixtureBuilder,
  currentFixtureBatter,
  fixturePlayer,
  plateAppearance,
  routineOut,
  runnerMovement,
} from "../fixtures/scoring-fixture-builder";

type RunnerPlay = Extract<EventBody, { eventType: "RunnerPlayRecorded" }>;

function runnerPlay(
  playType: RunnerPlay["payload"]["playType"],
  movements: RunnerMovement[],
  options: Partial<Omit<RunnerPlay["payload"], "playType" | "movements">> = {},
): RunnerPlay {
  return parseEventBody({
    eventType: "RunnerPlayRecorded",
    payload: {
      playType,
      movements,
      fieldingCredits: options.fieldingCredits ?? [],
      responsibleFielderId: options.responsibleFielderId ?? null,
    },
  }) as RunnerPlay;
}

function reachFirst(
  builder: ScoringFixtureBuilder,
  outcome: "WALK" | "SINGLE",
) {
  const state = builder.state();
  const batter = currentFixtureBatter(state);
  const pitcher = state.activePitcher.HOME;
  builder.append(
    plateAppearance(
      batter,
      pitcher,
      outcome,
      [
        runnerMovement(batter, "BATTER", "FIRST", pitcher, {
          cause: outcome === "WALK" ? "FORCED_ADVANCE" : "HIT",
          forced: outcome === "WALK",
        }),
      ],
      { battedBall: outcome === "SINGLE" ? "LINE_DRIVE" : null },
    ),
  );
  return batter;
}

function defaultDraft(
  outcomes: RunnerPlayDraft["outcomes"],
  overrides: Partial<RunnerPlayDraft> = {},
): RunnerPlayDraft {
  return {
    playType: "OPTIONAL_ADVANCE",
    outcomes,
    earnedRuns: {},
    outFielderIds: [],
    errorFielderId: null,
    ...overrides,
  };
}

describe("runner and base-out interactions", () => {
  it("requires schema version 3 for the atomic runner-play vocabulary", () => {
    const body = {
      eventType: "RunnerPlayRecorded",
      payload: {
        playType: "OPTIONAL_ADVANCE",
        movements: [
          {
            runnerId: "runner",
            from: "FIRST",
            to: "SECOND",
            cause: "OPTIONAL_ADVANCE",
            forced: false,
            responsiblePitcherId: "pitcher",
          },
        ],
        fieldingCredits: [],
        responsibleFielderId: null,
      },
    };
    expect(() => parseEventBody(body, 2)).toThrowError(
      expect.objectContaining({ code: "INVALID_PAYLOAD" }),
    );
    expect(parseEventBody(body, 3).eventType).toBe("RunnerPlayRecorded");
  });

  it("resolves a forced walk chain and a single with optional advancement", () => {
    const builder = new ScoringFixtureBuilder();
    builder.start();
    const first = reachFirst(builder, "WALK");
    const state = builder.state();
    const second = currentFixtureBatter(state);
    const pitcher = state.activePitcher.HOME;
    builder.append(
      plateAppearance(second, pitcher, "WALK", [
        runnerMovement(second, "BATTER", "FIRST", pitcher, {
          cause: "FORCED_ADVANCE",
          forced: true,
        }),
        runnerMovement(first, "FIRST", "SECOND", pitcher, {
          cause: "FORCED_ADVANCE",
          forced: true,
        }),
      ]),
    );
    expect(builder.state().bases).toEqual({
      FIRST: second,
      SECOND: first,
      THIRD: null,
    });

    const third = currentFixtureBatter(builder.state());
    builder.append(
      plateAppearance(third, pitcher, "DOUBLE", [
        runnerMovement(third, "BATTER", "SECOND", pitcher, { cause: "HIT" }),
        runnerMovement(first, "SECOND", "HOME", pitcher, {
          cause: "OPTIONAL_ADVANCE",
          runCounts: true,
          rbiEligible: true,
          earnedRun: "EARNED",
        }),
        runnerMovement(second, "FIRST", "THIRD", pitcher, {
          cause: "OPTIONAL_ADVANCE",
        }),
      ]),
    );
    expect(builder.state()).toMatchObject({
      score: { AWAY: 1, HOME: 0 },
      bases: { FIRST: null, SECOND: third, THIRD: second },
    });
  });

  it("records atomic steals, caught stealing, pickoffs, wild pitches, passed balls, and errors", () => {
    const builder = new ScoringFixtureBuilder();
    builder.start();
    const runner = reachFirst(builder, "SINGLE");
    const pitcher = builder.state().activePitcher.HOME;
    const catcher = fixturePlayer(builder.setup, "HOME", 1);

    builder.append(
      runnerPlay("STOLEN_BASE", [
        runnerMovement(runner, "FIRST", "SECOND", pitcher, {
          cause: "STOLEN_BASE",
        }),
      ]),
    );
    builder.append(
      runnerPlay(
        "PASSED_BALL",
        [
          runnerMovement(runner, "SECOND", "THIRD", pitcher, {
            cause: "PASSED_BALL",
          }),
        ],
        { responsibleFielderId: catcher },
      ),
    );
    builder.append(
      runnerPlay(
        "ERROR",
        [
          runnerMovement(runner, "THIRD", "HOME", pitcher, {
            cause: "ERROR",
            runCounts: true,
            rbiEligible: false,
            earnedRun: "UNEARNED",
          }),
        ],
        {
          fieldingCredits: [
            {
              fielderId: catcher,
              credit: "ERROR",
              errorType: "THROWING",
            },
          ],
        },
      ),
    );
    expect(builder.state().score.AWAY).toBe(1);

    const secondRunner = reachFirst(builder, "SINGLE");
    builder.append(
      runnerPlay("WILD_PITCH", [
        runnerMovement(secondRunner, "FIRST", "SECOND", pitcher, {
          cause: "WILD_PITCH",
        }),
      ]),
    );
    builder.append(
      runnerPlay("PICKOFF", [
        runnerMovement(secondRunner, "SECOND", "OUT", pitcher, {
          cause: "PICKOFF",
          out: {
            outNumber: 1,
            force: false,
            fielders: [catcher],
          },
        }),
      ]),
    );
    const thirdRunner = reachFirst(builder, "SINGLE");
    builder.append(
      runnerPlay("CAUGHT_STEALING", [
        runnerMovement(thirdRunner, "FIRST", "OUT", pitcher, {
          cause: "CAUGHT_STEALING",
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
      bases: { FIRST: null, SECOND: null, THIRD: null },
    });
    const stats = builder.statistics();
    expect(
      stats.batting.find(({ playerId }) => playerId === runner)?.counters
        .stolenBases,
    ).toBe(1);
    expect(
      stats.batting.find(({ playerId }) => playerId === thirdRunner)?.counters
        .caughtStealing,
    ).toBe(1);
    expect(
      stats.fielding.find(({ playerId }) => playerId === catcher)?.counters
        .errors,
    ).toBe(1);
  });

  it("records a general runner out and lets the reducer end the half inning", () => {
    const builder = new ScoringFixtureBuilder();
    builder.start();
    const runner = reachFirst(builder, "SINGLE");
    const pitcher = builder.state().activePitcher.HOME;
    const putout = fixturePlayer(builder.setup, "HOME", 1);
    builder.append(routineOut(builder.state(), putout));
    builder.append(routineOut(builder.state(), putout));
    builder.append(
      runnerPlay("RUNNER_OUT", [
        runnerMovement(runner, "FIRST", "OUT", pitcher, {
          cause: "RUNNER_OUT",
          out: {
            outNumber: 3,
            force: false,
            fielders: [putout],
          },
        }),
      ]),
    );
    expect(builder.state()).toMatchObject({
      inning: 1,
      half: "BOTTOM",
      outs: 0,
      bases: { FIRST: null, SECOND: null, THIRD: null },
    });
  });

  it("rejects occupied destinations, absent runners, fourth outs, and partial atomic plays", () => {
    const builder = new ScoringFixtureBuilder();
    builder.start();
    const first = reachFirst(builder, "SINGLE");
    const pitcher = builder.state().activePitcher.HOME;
    const second = currentFixtureBatter(builder.state());
    builder.append(
      plateAppearance(second, pitcher, "SINGLE", [
        runnerMovement(first, "FIRST", "SECOND", pitcher, {
          cause: "OPTIONAL_ADVANCE",
        }),
        runnerMovement(second, "BATTER", "FIRST", pitcher, { cause: "HIT" }),
      ]),
    );
    const before = builder.state();
    expect(() =>
      builder.append(
        runnerPlay("OPTIONAL_ADVANCE", [
          runnerMovement(first, "SECOND", "THIRD", pitcher),
          runnerMovement(second, "FIRST", "THIRD", pitcher),
        ]),
      ),
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_RUNNER_MOVEMENT" }),
    );
    expect(builder.state()).toEqual(before);

    expect(() =>
      builder.append(
        runnerPlay("PICKOFF", [
          runnerMovement("absent", "THIRD", "OUT", pitcher, {
            cause: "PICKOFF",
            out: { outNumber: 1, force: false, fielders: [] },
          }),
        ]),
      ),
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_RUNNER_MOVEMENT" }),
    );

    const outs = new ScoringFixtureBuilder();
    outs.start();
    const putout = fixturePlayer(outs.setup, "HOME", 1);
    outs.append(routineOut(outs.state(), putout));
    outs.append(routineOut(outs.state(), putout));
    const outRunner = reachFirst(outs, "SINGLE");
    const outPitcher = outs.state().activePitcher.HOME;
    expect(() =>
      outs.append(
        plateAppearance(
          currentFixtureBatter(outs.state()),
          outPitcher,
          "BATTER_OUT",
          [
            runnerMovement(outRunner, "FIRST", "OUT", outPitcher, {
              out: {
                outNumber: 3,
                force: false,
                fielders: [putout],
              },
            }),
            runnerMovement(
              currentFixtureBatter(outs.state()),
              "BATTER",
              "OUT",
              outPitcher,
              {
                out: {
                  outNumber: 4,
                  force: false,
                  fielders: [putout],
                },
              },
            ),
          ],
        ),
      ),
    ).toThrowError(expect.objectContaining({ code: "INVALID_PAYLOAD" }));
  });

  it("rejects a counting run on a force third out and invalid forced advancement", () => {
    const builder = new ScoringFixtureBuilder();
    builder.start();
    const first = reachFirst(builder, "SINGLE");
    const pitcher = builder.state().activePitcher.HOME;
    const putout = fixturePlayer(builder.setup, "HOME", 1);
    builder.append(routineOut(builder.state(), putout));
    const second = currentFixtureBatter(builder.state());
    builder.append(
      plateAppearance(second, pitcher, "SINGLE", [
        runnerMovement(first, "FIRST", "THIRD", pitcher),
        runnerMovement(second, "BATTER", "FIRST", pitcher, { cause: "HIT" }),
      ]),
    );
    builder.append(routineOut(builder.state(), putout));
    const batter = currentFixtureBatter(builder.state());
    expect(() =>
      builder.append(
        plateAppearance(batter, pitcher, "FIELDER_CHOICE", [
          runnerMovement(batter, "BATTER", "FIRST", pitcher, {
            cause: "FIELDERS_CHOICE",
          }),
          runnerMovement(second, "FIRST", "OUT", pitcher, {
            cause: "FIELDERS_CHOICE",
            forced: true,
            out: { outNumber: 3, force: true, fielders: [putout] },
          }),
          runnerMovement(first, "THIRD", "HOME", pitcher, {
            runCounts: true,
            rbiEligible: false,
            earnedRun: "EARNED",
          }),
        ]),
      ),
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_BASEBALL_TRANSITION" }),
    );

    const forced = new ScoringFixtureBuilder();
    forced.start();
    const forcedRunner = reachFirst(forced, "SINGLE");
    const forcedPitcher = forced.state().activePitcher.HOME;
    expect(() =>
      forced.append(
        runnerPlay("OPTIONAL_ADVANCE", [
          runnerMovement(forcedRunner, "FIRST", "SECOND", forcedPitcher, {
            forced: true,
          }),
        ]),
      ),
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_RUNNER_MOVEMENT" }),
    );
  });

  it("previews accessible announcements and reconciles from replayed server state", () => {
    const builder = new ScoringFixtureBuilder();
    builder.start();
    const runner = reachFirst(builder, "SINGLE");
    const state = builder.state();
    const preview = previewRunnerPlay(state, defaultDraft({ FIRST: "SECOND" }));
    expect(preview.errors).toEqual([]);
    expect(preview.announcements).toContain(`${runner} now on second`);
    expect(preview.bases.SECOND).toBe(runner);

    builder.append(preview.body!);
    const reloaded = replayGame(builder.setup, builder.events(), {
      verifyEvidence: true,
    }).state;
    expect(reloaded.sourceRevision).toBe(state.sourceRevision + 1);
    expect(reloaded.bases).toEqual(preview.bases);
  });

  it("uses scheduled innings for extra innings and validates a runner-play walk-off", () => {
    const builder = new ScoringFixtureBuilder();
    const oneInning = new ScoringFixtureBuilder({
      ...builder.setup,
      scheduledInnings: 1,
    });
    oneInning.start();
    const homePutout = fixturePlayer(oneInning.setup, "HOME", 1);
    const awayPutout = fixturePlayer(oneInning.setup, "AWAY", 1);
    for (let index = 0; index < 3; index += 1) {
      oneInning.append(routineOut(oneInning.state(), homePutout));
    }
    for (let index = 0; index < 3; index += 1) {
      oneInning.append(routineOut(oneInning.state(), awayPutout));
    }
    expect(oneInning.state()).toMatchObject({
      inning: 2,
      half: "TOP",
      outs: 0,
      status: "IN_PROGRESS",
    });

    const walkOff = new ScoringFixtureBuilder({
      ...builder.setup,
      gameId: "walk-off-runner-game",
      scheduledInnings: 1,
    });
    walkOff.start();
    const walkOffHomePutout = fixturePlayer(walkOff.setup, "HOME", 1);
    for (let index = 0; index < 3; index += 1) {
      walkOff.append(routineOut(walkOff.state(), walkOffHomePutout));
    }
    const state = walkOff.state();
    const runner = currentFixtureBatter(state);
    const pitcher = state.activePitcher.AWAY;
    walkOff.append(
      plateAppearance(runner, pitcher, "TRIPLE", [
        runnerMovement(runner, "BATTER", "THIRD", pitcher, { cause: "HIT" }),
      ]),
    );
    walkOff.append(
      runnerPlay("WILD_PITCH", [
        runnerMovement(runner, "THIRD", "HOME", pitcher, {
          cause: "WILD_PITCH",
          runCounts: true,
          rbiEligible: false,
          earnedRun: "EARNED",
        }),
      ]),
    );
    expect(walkOff.state()).toMatchObject({
      inning: 1,
      half: "BOTTOM",
      score: { AWAY: 0, HOME: 1 },
      status: "IN_PROGRESS",
    });
    walkOff.append({
      eventType: "GameCompleted",
      payload: { reasonCode: "walk-off", ending: "WALK_OFF" },
    });
    expect(walkOff.state().status).toBe("COMPLETED");
  });
});
