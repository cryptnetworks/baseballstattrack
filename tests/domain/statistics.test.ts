import { describe, expect, it } from "vitest";

import {
  EVENT_SCHEMA_VERSION,
  deriveEventStates,
  replayGame,
  stateHash,
  type AcceptedEvent,
  type AcceptedSetup,
  type EventBody,
  type RunnerMovement,
} from "@/domain/events/event-log";
import {
  STATISTIC_DERIVATION_VERSION,
  StatisticDerivationError,
  deriveBattingRates,
  deriveFieldingRates,
  deriveGameStatistics,
  derivePitchingRates,
  deriveSeasonStatistics,
  exactRate,
  formatExactRate,
  formatInningsPitched,
  type BattingCounters,
  type FieldingCounters,
  type PitchingCounters,
} from "@/domain/statistics";

const setup: AcceptedSetup = {
  id: "stats-setup",
  accountId: "account-a",
  gameId: "game-a",
  setupRevision: 1,
  rulesetVersionId: "ruleset-a",
  scheduledInnings: 1,
  status: "READY",
  sides: {
    AWAY: {
      startingPitcherId: "away-pitcher",
      lineup: [
        {
          playerId: "away-one",
          battingOrder: 1,
          position: "SHORTSTOP",
          active: true,
        },
        {
          playerId: "away-two",
          battingOrder: 2,
          position: "CATCHER",
          active: true,
        },
        {
          playerId: "away-three",
          battingOrder: 3,
          position: "FIRST_BASE",
          active: true,
        },
        {
          playerId: "away-pitcher",
          battingOrder: null,
          position: "PITCHER",
          active: true,
        },
        {
          playerId: "away-reliever",
          battingOrder: null,
          position: "CENTER_FIELD",
          active: true,
        },
      ],
    },
    HOME: {
      startingPitcherId: "home-pitcher",
      lineup: [
        {
          playerId: "home-one",
          battingOrder: 1,
          position: "SHORTSTOP",
          active: true,
        },
        {
          playerId: "home-two",
          battingOrder: 2,
          position: "CATCHER",
          active: true,
        },
        {
          playerId: "home-three",
          battingOrder: 3,
          position: "FIRST_BASE",
          active: true,
        },
        {
          playerId: "home-pitcher",
          battingOrder: null,
          position: "PITCHER",
          active: true,
        },
        {
          playerId: "home-reliever",
          battingOrder: null,
          position: "CENTER_FIELD",
          active: true,
        },
      ],
    },
  },
};

const start = {
  eventType: "GameStarted",
  payload: {},
} satisfies EventBody;

function movement(
  runnerId: string,
  from: RunnerMovement["from"],
  to: RunnerMovement["to"],
  responsiblePitcherId = "home-pitcher",
  overrides: Partial<RunnerMovement> = {},
): RunnerMovement {
  return {
    runnerId,
    from,
    to,
    cause: from === "BATTER" ? "BATTER_RESULT" : "OPTIONAL_ADVANCE",
    forced: false,
    responsiblePitcherId,
    ...(to === "HOME"
      ? {
          runCounts: true,
          rbiEligible: true,
          earnedRun: "EARNED" as const,
        }
      : {}),
    ...(to === "OUT"
      ? {
          out: {
            outNumber: 1,
            force: false,
            fielders: ["home-two"],
          },
        }
      : {}),
    ...overrides,
  } as RunnerMovement;
}

function plate(
  batterId: string,
  outcome: Extract<
    EventBody,
    { eventType: "PlateAppearanceRecorded" }
  >["payload"]["outcome"],
  movements: RunnerMovement[],
  options: {
    pitcherId?: string;
    fieldingCredits?: Extract<
      EventBody,
      { eventType: "PlateAppearanceRecorded" }
    >["payload"]["fieldingCredits"];
  } = {},
): Extract<EventBody, { eventType: "PlateAppearanceRecorded" }> {
  return {
    eventType: "PlateAppearanceRecorded",
    payload: {
      batterId,
      pitcherId: options.pitcherId ?? "home-pitcher",
      outcome,
      battedBall:
        outcome === "SACRIFICE_BUNT"
          ? "BUNT"
          : outcome === "SACRIFICE_FLY"
            ? "FLY_BALL"
            : null,
      movements,
      fieldingCredits: options.fieldingCredits ?? [],
    },
  };
}

function buildEvent(
  acceptedSetup: AcceptedSetup,
  history: readonly AcceptedEvent[],
  body: EventBody,
  id = `event-${history.length + 1}`,
): AcceptedEvent {
  const current = replayGame(acceptedSetup, history).state;
  const partial = {
    id,
    accountId: acceptedSetup.accountId,
    gameId: acceptedSetup.gameId,
    setupSnapshotId: acceptedSetup.id,
    setupRevision: acceptedSetup.setupRevision,
    sequence: current.lastSequence + 1,
    schemaVersion: EVENT_SCHEMA_VERSION,
    rulesetVersionId: acceptedSetup.rulesetVersionId,
    playTransactionId: `play-${history.length + 1}`,
    componentOrder: 0,
    clientSubmissionId: `submission-${history.length + 1}`,
    expectedRevision: current.sourceRevision,
    acceptedRevision: current.sourceRevision + 1,
    actor: { kind: "USER" as const, id: "actor-a", userId: "user-a" },
    recordedAt: "2026-07-29T18:00:00.000Z",
    acceptedAt: "2026-07-29T18:00:01.000Z",
    ...body,
    preStateHash: stateHash(current),
    postStateHash: `sha256:v1:${"0".repeat(64)}`,
  } satisfies AcceptedEvent;
  const { before, after } = deriveEventStates(acceptedSetup, history, partial);
  return {
    ...partial,
    preStateHash: stateHash(before),
    postStateHash: stateHash(after),
  };
}

function append(
  history: AcceptedEvent[],
  body: EventBody,
  id?: string,
): AcceptedEvent {
  const event = buildEvent(setup, history, body, id);
  history.push(event);
  return event;
}

const emptyBatting = (): BattingCounters => ({
  plateAppearances: 0,
  atBats: 0,
  runs: 0,
  hits: 0,
  singles: 0,
  doubles: 0,
  triples: 0,
  homeRuns: 0,
  runsBattedIn: 0,
  walks: 0,
  intentionalWalks: 0,
  hitByPitch: 0,
  strikeouts: 0,
  sacrificeFlies: 0,
  sacrificeHits: 0,
  reachedOnError: 0,
  fieldersChoices: 0,
  totalBases: 0,
  stolenBases: 0,
  caughtStealing: 0,
});
const emptyPitching = (): PitchingCounters => ({
  appearances: 0,
  gamesStarted: 0,
  battersFaced: 0,
  outsRecorded: 0,
  hitsAllowed: 0,
  runsAllowed: 0,
  earnedRuns: 0,
  walks: 0,
  strikeouts: 0,
  hitBatters: 0,
  homeRunsAllowed: 0,
  inheritedRunners: 0,
  inheritedRunnersScored: 0,
});
const emptyFielding = (): FieldingCounters => ({
  putouts: 0,
  assists: 0,
  errors: 0,
  doublePlays: 0,
  triplePlays: 0,
});

describe("exact statistic formulas and display boundary", () => {
  it("computes batting rates from exact integer counters", () => {
    const counters = {
      ...emptyBatting(),
      plateAppearances: 11,
      atBats: 7,
      hits: 3,
      singles: 2,
      doubles: 1,
      walks: 2,
      hitByPitch: 1,
      sacrificeFlies: 1,
      totalBases: 4,
    };
    expect(deriveBattingRates(counters)).toEqual({
      battingAverage: { numerator: 3, denominator: 7 },
      // (3 H + 2 BB + 1 HBP) / (7 AB + 2 BB + 1 HBP + 1 SF)
      onBasePercentage: { numerator: 6, denominator: 11 },
      sluggingPercentage: { numerator: 4, denominator: 7 },
      onBasePlusSlugging: { numerator: 86, denominator: 77 },
    });
  });

  it("computes ERA, WHIP, fielding percentage, and partial innings exactly", () => {
    expect(
      derivePitchingRates({
        ...emptyPitching(),
        outsRecorded: 20,
        runsAllowed: 3,
        earnedRuns: 3,
        walks: 2,
        hitsAllowed: 5,
      }),
    ).toEqual({
      earnedRunAverage: { numerator: 81, denominator: 20 },
      walksAndHitsPerInningPitched: { numerator: 21, denominator: 20 },
    });
    expect(
      deriveFieldingRates({
        ...emptyFielding(),
        putouts: 7,
        assists: 2,
        errors: 1,
      }),
    ).toEqual({
      chances: 10,
      fieldingPercentage: { numerator: 9, denominator: 10 },
    });
    expect(formatInningsPitched(20)).toBe("6.2");
    expect(formatInningsPitched(1)).toBe("0.1");
    expect(formatInningsPitched(2)).toBe("0.2");
  });

  it("defines zero denominators, leading zeros, and half-up rounding", () => {
    expect(deriveBattingRates(emptyBatting())).toEqual({
      battingAverage: null,
      onBasePercentage: null,
      sluggingPercentage: null,
      onBasePlusSlugging: null,
    });
    expect(derivePitchingRates(emptyPitching())).toEqual({
      earnedRunAverage: null,
      walksAndHitsPerInningPitched: null,
    });
    expect(deriveFieldingRates(emptyFielding())).toEqual({
      chances: 0,
      fieldingPercentage: null,
    });
    expect(formatExactRate(exactRate(1, 3), { omitLeadingZero: true })).toBe(
      ".333",
    );
    expect(formatExactRate(exactRate(1, 8), { omitLeadingZero: true })).toBe(
      ".125",
    );
    expect(formatExactRate(exactRate(2, 3), { precision: 2 })).toBe("0.67");
    expect(
      formatExactRate(
        exactRate(Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER),
        {
          precision: 6,
        },
      ),
    ).toBe("1.000000");
    expect(formatExactRate(null)).toBeNull();
    expect(() =>
      deriveBattingRates({ ...emptyBatting(), hits: 1 }),
    ).toThrowError(
      expect.objectContaining({ code: "IMPOSSIBLE_COUNTER_STATE" }),
    );
  });
});

describe("event facts, aggregation, and reconciliation", () => {
  const cases = [
    ["WALK", "walks", 1, "atBats", 0],
    ["INTENTIONAL_WALK", "intentionalWalks", 1, "walks", 1],
    ["HIT_BY_PITCH", "hitByPitch", 1, "atBats", 0],
    ["SINGLE", "singles", 1, "totalBases", 1],
    ["DOUBLE", "doubles", 1, "totalBases", 2],
    ["TRIPLE", "triples", 1, "totalBases", 3],
    ["REACHED_ON_ERROR", "reachedOnError", 1, "hits", 0],
    ["FIELDER_CHOICE", "fieldersChoices", 1, "hits", 0],
    ["SACRIFICE_FLY", "sacrificeFlies", 1, "atBats", 0],
    ["SACRIFICE_BUNT", "sacrificeHits", 1, "atBats", 0],
  ] as const;

  it.each(cases)(
    "maps %s to exact batter counters",
    (outcome, firstKey, firstValue, secondKey, secondValue) => {
      const history: AcceptedEvent[] = [];
      append(history, start);
      const destination =
        outcome === "DOUBLE"
          ? "SECOND"
          : outcome === "TRIPLE"
            ? "THIRD"
            : outcome === "SACRIFICE_FLY" || outcome === "SACRIFICE_BUNT"
              ? "OUT"
              : "FIRST";
      const fieldingCredits =
        outcome === "REACHED_ON_ERROR"
          ? [
              {
                fielderId: "home-one",
                credit: "ERROR" as const,
                errorType: "FIELDING",
              },
            ]
          : destination === "OUT"
            ? [
                {
                  fielderId: "home-two",
                  credit: "PUTOUT" as const,
                  errorType: null,
                },
              ]
            : [];
      append(
        history,
        plate(
          "away-one",
          outcome,
          [
            movement(
              "away-one",
              "BATTER",
              destination,
              "home-pitcher",
              destination === "OUT"
                ? {
                    out: {
                      outNumber: 1,
                      force: false,
                      fielders: ["home-two"],
                    },
                  }
                : {},
            ),
          ],
          { fieldingCredits },
        ),
      );
      const projection = deriveGameStatistics({ setup, events: history });
      const line = projection.batting.find(
        ({ playerId }) => playerId === "away-one",
      )!;
      expect(line.counters[firstKey]).toBe(firstValue);
      expect(line.counters[secondKey]).toBe(secondValue);
      expect(line.counters.plateAppearances).toBe(1);
    },
  );

  it("derives a home run, RBI, run, earned run, inning line, and team totals", () => {
    const history: AcceptedEvent[] = [];
    append(history, start);
    append(
      history,
      plate("away-one", "HOME_RUN", [movement("away-one", "BATTER", "HOME")]),
    );
    const projection = deriveGameStatistics({ setup, events: history });
    expect(projection.finalScore).toEqual({ AWAY: 1, HOME: 0 });
    expect(projection.inningLines).toEqual([
      { inning: 1, side: "AWAY", runs: 1 },
    ]);
    expect(projection.teams.AWAY.batting).toMatchObject({
      hits: 1,
      homeRuns: 1,
      runs: 1,
      runsBattedIn: 1,
      totalBases: 4,
    });
    expect(projection.teams.HOME.pitching).toMatchObject({
      hitsAllowed: 1,
      homeRunsAllowed: 1,
      runsAllowed: 1,
      earnedRuns: 1,
    });
  });

  it("derives double-play fielding participation and pitcher outs", () => {
    const history: AcceptedEvent[] = [];
    append(history, start);
    append(
      history,
      plate("away-one", "SINGLE", [movement("away-one", "BATTER", "FIRST")]),
    );
    append(
      history,
      plate(
        "away-two",
        "BATTER_OUT",
        [
          movement("away-one", "FIRST", "OUT", "home-pitcher", {
            out: {
              outNumber: 1,
              force: true,
              fielders: ["home-one"],
            },
          }),
          movement("away-two", "BATTER", "OUT", "home-pitcher", {
            out: {
              outNumber: 2,
              force: true,
              fielders: ["home-three"],
            },
          }),
        ],
        {
          fieldingCredits: [
            {
              fielderId: "home-one",
              credit: "PUTOUT",
              errorType: null,
            },
            {
              fielderId: "home-three",
              credit: "PUTOUT",
              errorType: null,
            },
          ],
        },
      ),
    );
    const projection = deriveGameStatistics({ setup, events: history });
    expect(projection.teams.HOME.pitching.outsRecorded).toBe(2);
    expect(
      projection.fielding
        .filter(({ side }) => side === "HOME")
        .map(({ counters }) => counters.doublePlays),
    ).toEqual([1, 1]);
  });

  it("assigns inherited runs to the responsible pitcher after a pitching change", () => {
    const history: AcceptedEvent[] = [];
    append(history, start);
    append(
      history,
      plate("away-one", "WALK", [movement("away-one", "BATTER", "FIRST")]),
    );
    append(history, {
      eventType: "PitchingChangeMade",
      payload: {
        side: "HOME",
        outgoingPitcherId: "home-pitcher",
        incomingPitcherId: "home-reliever",
        inheritedRunnerIds: ["away-one"],
      },
    });
    append(
      history,
      plate(
        "away-two",
        "SINGLE",
        [
          movement("away-one", "FIRST", "HOME", "home-pitcher"),
          movement("away-two", "BATTER", "FIRST", "home-reliever"),
        ],
        { pitcherId: "home-reliever" },
      ),
    );
    const projection = deriveGameStatistics({ setup, events: history });
    const starter = projection.pitching.find(
      ({ playerId }) => playerId === "home-pitcher",
    )!;
    const reliever = projection.pitching.find(
      ({ playerId }) => playerId === "home-reliever",
    )!;
    expect(starter.counters).toMatchObject({
      appearances: 1,
      gamesStarted: 1,
      runsAllowed: 1,
      earnedRuns: 1,
    });
    expect(reliever.counters).toMatchObject({
      appearances: 1,
      inheritedRunners: 1,
      inheritedRunnersScored: 1,
      hitsAllowed: 1,
    });
  });

  it("counts stolen bases and caught stealing from standalone attempts", () => {
    const history: AcceptedEvent[] = [];
    append(history, start);
    append(
      history,
      plate("away-one", "SINGLE", [movement("away-one", "BATTER", "FIRST")]),
    );
    append(history, {
      eventType: "StolenBaseAttemptRecorded",
      payload: {
        runnerId: "away-one",
        from: "FIRST",
        to: "SECOND",
        result: "STOLEN_BASE",
        responsiblePitcherId: "home-pitcher",
        fielders: [],
      },
    });
    append(history, {
      eventType: "StolenBaseAttemptRecorded",
      payload: {
        runnerId: "away-one",
        from: "SECOND",
        to: "THIRD",
        result: "CAUGHT_STEALING",
        responsiblePitcherId: "home-pitcher",
        fielders: ["home-two"],
      },
    });
    const projection = deriveGameStatistics({ setup, events: history });
    expect(
      projection.batting.find(({ playerId }) => playerId === "away-one")!
        .counters,
    ).toMatchObject({ stolenBases: 1, caughtStealing: 1 });
    expect(projection.teams.HOME.pitching.outsRecorded).toBe(1);
  });
});

describe("corrections, determinism, lifecycle, and season boundaries", () => {
  it("rebuilds a corrected hit as an error and restores it when correction is reversed", () => {
    const history: AcceptedEvent[] = [];
    append(history, start);
    const hit = append(
      history,
      plate("away-one", "SINGLE", [movement("away-one", "BATTER", "FIRST")]),
      "hit",
    );
    const replacement = plate(
      "away-one",
      "REACHED_ON_ERROR",
      [movement("away-one", "BATTER", "FIRST")],
      {
        fieldingCredits: [
          {
            fielderId: "home-one",
            credit: "ERROR",
            errorType: "FIELDING",
          },
        ],
      },
    );
    const correction = append(
      history,
      {
        eventType: "CorrectionApplied",
        payload: {
          policy: "REPLACE_JUDGMENT",
          targetEventIds: [hit.id],
          replacements: [
            {
              id: "replacement-error",
              order: 0,
              targetEventId: hit.id,
              body: replacement,
            },
          ],
          reasonCode: "SCORER_REVIEW",
        },
      },
      "correction",
    );
    const corrected = deriveGameStatistics({ setup, events: history });
    expect(corrected.teams.AWAY.batting.hits).toBe(0);
    expect(corrected.teams.AWAY.batting.reachedOnError).toBe(1);
    expect(corrected.teams.HOME.fielding.errors).toBe(1);
    expect(corrected.metadata.sourceRevision).toBe(3);

    append(history, {
      eventType: "CorrectionApplied",
      payload: {
        policy: "REVERSE_EVENTS",
        targetEventIds: [correction.id],
        replacements: [],
        reasonCode: "REVIEW_REVERSED",
      },
    });
    const restored = deriveGameStatistics({ setup, events: history });
    expect(restored.teams.AWAY.batting.hits).toBe(1);
    expect(restored.teams.HOME.fielding.errors).toBe(0);
  });

  it("rebuilds an error as a hit and changes RBI judgment without mutating history", () => {
    const history: AcceptedEvent[] = [];
    append(history, start);
    const error = append(
      history,
      plate(
        "away-one",
        "REACHED_ON_ERROR",
        [movement("away-one", "BATTER", "FIRST")],
        {
          fieldingCredits: [
            {
              fielderId: "home-one",
              credit: "ERROR",
              errorType: "FIELDING",
            },
          ],
        },
      ),
      "error",
    );
    append(history, {
      eventType: "CorrectionApplied",
      payload: {
        policy: "REPLACE_JUDGMENT",
        targetEventIds: [error.id],
        replacements: [
          {
            id: "replacement-hit",
            order: 0,
            targetEventId: error.id,
            body: plate("away-one", "SINGLE", [
              movement("away-one", "BATTER", "FIRST"),
            ]),
          },
        ],
        reasonCode: "HIT_ON_REVIEW",
      },
    });
    expect(
      deriveGameStatistics({ setup, events: history }).teams,
    ).toMatchObject({
      AWAY: { batting: { hits: 1, reachedOnError: 0 } },
      HOME: { fielding: { errors: 0 } },
    });

    const scoringHistory: AcceptedEvent[] = [];
    append(scoringHistory, start);
    append(
      scoringHistory,
      plate("away-one", "WALK", [movement("away-one", "BATTER", "FIRST")]),
    );
    const scoringHit = append(
      scoringHistory,
      plate("away-two", "SINGLE", [
        movement("away-one", "FIRST", "HOME"),
        movement("away-two", "BATTER", "FIRST"),
      ]),
      "scoring-hit",
    );
    expect(
      deriveGameStatistics({ setup, events: scoringHistory }).teams.AWAY.batting
        .runsBattedIn,
    ).toBe(1);
    append(scoringHistory, {
      eventType: "CorrectionApplied",
      payload: {
        policy: "REPLACE_JUDGMENT",
        targetEventIds: [scoringHit.id],
        replacements: [
          {
            id: "replacement-no-rbi",
            order: 0,
            targetEventId: scoringHit.id,
            body: plate("away-two", "SINGLE", [
              movement("away-one", "FIRST", "HOME", "home-pitcher", {
                rbiEligible: false,
              }),
              movement("away-two", "BATTER", "FIRST"),
            ]),
          },
        ],
        reasonCode: "NO_RBI_ON_REVIEW",
      },
    });
    const noRbi = deriveGameStatistics({
      setup,
      events: scoringHistory,
    });
    expect(noRbi.teams.AWAY.batting).toMatchObject({
      runs: 1,
      runsBattedIn: 0,
    });
  });

  it("rebuilds a corrected pitching-change range and runner responsibility", () => {
    const history: AcceptedEvent[] = [];
    append(history, start);
    const reach = append(
      history,
      plate("away-one", "WALK", [movement("away-one", "BATTER", "FIRST")]),
      "reach",
    );
    const change = append(
      history,
      {
        eventType: "PitchingChangeMade",
        payload: {
          side: "HOME",
          outgoingPitcherId: "home-pitcher",
          incomingPitcherId: "home-reliever",
          inheritedRunnerIds: ["away-one"],
        },
      },
      "change",
    );
    const scoring = append(
      history,
      plate(
        "away-two",
        "SINGLE",
        [
          movement("away-one", "FIRST", "HOME", "home-pitcher"),
          movement("away-two", "BATTER", "FIRST", "home-reliever"),
        ],
        { pitcherId: "home-reliever" },
      ),
      "scoring",
    );
    expect(
      deriveGameStatistics({ setup, events: history }).pitching.find(
        ({ playerId }) => playerId === "home-pitcher",
      )!.counters.runsAllowed,
    ).toBe(1);

    append(history, {
      eventType: "CorrectionApplied",
      payload: {
        policy: "REPLACE_EVENT_RANGE",
        targetEventIds: [reach.id, change.id, scoring.id],
        replacements: [
          {
            id: "change-before-reach",
            order: 0,
            targetEventId: reach.id,
            body: {
              eventType: "PitchingChangeMade",
              payload: {
                side: "HOME",
                outgoingPitcherId: "home-pitcher",
                incomingPitcherId: "home-reliever",
                inheritedRunnerIds: [],
              },
            },
          },
          {
            id: "reach-against-reliever",
            order: 1,
            targetEventId: change.id,
            body: plate(
              "away-one",
              "WALK",
              [movement("away-one", "BATTER", "FIRST", "home-reliever")],
              { pitcherId: "home-reliever" },
            ),
          },
          {
            id: "score-charged-to-reliever",
            order: 2,
            targetEventId: scoring.id,
            body: plate(
              "away-two",
              "SINGLE",
              [
                movement("away-one", "FIRST", "HOME", "home-reliever"),
                movement("away-two", "BATTER", "FIRST", "home-reliever"),
              ],
              { pitcherId: "home-reliever" },
            ),
          },
        ],
        reasonCode: "PITCHER_CHANGE_ORDER",
      },
    });
    const corrected = deriveGameStatistics({ setup, events: history });
    expect(
      corrected.pitching.find(({ playerId }) => playerId === "home-pitcher")!
        .counters.runsAllowed,
    ).toBe(0);
    expect(
      corrected.pitching.find(({ playerId }) => playerId === "home-reliever")!
        .counters,
    ).toMatchObject({
      battersFaced: 2,
      runsAllowed: 1,
      inheritedRunners: 0,
      inheritedRunnersScored: 0,
    });
  });

  it("derives an extra-inning walk-off outcome from the effective inning ledger", () => {
    const history: AcceptedEvent[] = [];
    append(history, start);
    const out = (batterId: string, pitcherId: string, fielderId: string) =>
      append(
        history,
        plate(
          batterId,
          "BATTER_OUT",
          [
            movement(batterId, "BATTER", "OUT", pitcherId, {
              out: {
                outNumber: replayGame(setup, history).state.outs + 1,
                force: false,
                fielders: [fielderId],
              },
            }),
          ],
          {
            pitcherId,
            fieldingCredits: [
              {
                fielderId,
                credit: "PUTOUT",
                errorType: null,
              },
            ],
          },
        ),
      );
    for (const [batterId, pitcherId, fielderId] of [
      ["away-one", "home-pitcher", "home-two"],
      ["away-two", "home-pitcher", "home-two"],
      ["away-three", "home-pitcher", "home-two"],
      ["home-one", "away-pitcher", "away-two"],
      ["home-two", "away-pitcher", "away-two"],
      ["home-three", "away-pitcher", "away-two"],
      ["away-one", "home-pitcher", "home-two"],
      ["away-two", "home-pitcher", "home-two"],
      ["away-three", "home-pitcher", "home-two"],
    ] as const) {
      out(batterId, pitcherId, fielderId);
    }
    append(
      history,
      plate(
        "home-one",
        "HOME_RUN",
        [movement("home-one", "BATTER", "HOME", "away-pitcher")],
        { pitcherId: "away-pitcher" },
      ),
    );
    append(history, {
      eventType: "GameCompleted",
      payload: { reasonCode: "WALK_OFF", ending: "WALK_OFF" },
    });
    const projection = deriveGameStatistics({ setup, events: history });
    expect(projection.outcome).toBe("HOME_WIN");
    expect(projection.finalScore).toEqual({ AWAY: 0, HOME: 1 });
    expect(projection.inningLines.at(-1)).toEqual({
      inning: 2,
      side: "HOME",
      runs: 1,
    });
  });

  it("is stable across repeated rebuild, JSON round trip, and retrieval order", () => {
    const history: AcceptedEvent[] = [];
    append(history, start);
    append(
      history,
      plate("away-one", "DOUBLE", [movement("away-one", "BATTER", "SECOND")]),
    );
    const first = deriveGameStatistics({ setup, events: history });
    const second = deriveGameStatistics({ setup, events: [...history] });
    const serialized = deriveGameStatistics({
      setup: JSON.parse(JSON.stringify(setup)) as AcceptedSetup,
      events: JSON.parse(JSON.stringify(history)) as AcceptedEvent[],
    });
    const shuffled = deriveGameStatistics({
      setup,
      events: [...history].reverse(),
    });
    const privacyRebuilt = deriveGameStatistics({
      setup,
      events: history,
      privacyOverlayRevision: 2,
    });
    expect(second).toEqual(first);
    expect(serialized).toEqual(first);
    expect(shuffled).toEqual(first);
    expect(privacyRebuilt.teams).toEqual(first.teams);
    expect(privacyRebuilt.batting).toEqual(first.batting);
    expect(privacyRebuilt.pitching).toEqual(first.pitching);
    expect(privacyRebuilt.fielding).toEqual(first.fielding);
    expect(first.metadata.derivationVersion).toBe(STATISTIC_DERIVATION_VERSION);
  });

  it("returns explicit empty and provisional lifecycle projections", () => {
    const empty = deriveGameStatistics({ setup, events: [] });
    expect(empty.metadata.lifecycleStatus).toBe("READY");
    expect(empty.outcome).toBe("UNDECIDED");
    expect(empty.batting).toEqual([]);
    expect(empty.inningLines).toEqual([]);

    const history: AcceptedEvent[] = [];
    append(history, start);
    append(history, {
      eventType: "GameSuspended",
      payload: { reasonCode: "WEATHER" },
    });
    const suspended = deriveGameStatistics({ setup, events: history });
    expect(suspended.metadata).toMatchObject({
      lifecycleStatus: "SUSPENDED",
      verificationStatus: "UNVERIFIED",
      seasonEligibility: "EXCLUDED_UNVERIFIED",
    });

    const abandonedHistory: AcceptedEvent[] = [];
    append(abandonedHistory, start);
    append(abandonedHistory, {
      eventType: "GameAbandoned",
      payload: { reasonCode: "UNSAFE_FIELD" },
    });
    expect(
      deriveGameStatistics({ setup, events: abandonedHistory }).metadata,
    ).toMatchObject({
      lifecycleStatus: "ABANDONED",
      seasonEligibility: "EXCLUDED_UNVERIFIED",
    });

    const cancelledHistory: AcceptedEvent[] = [];
    append(cancelledHistory, {
      eventType: "GameCancelled",
      payload: { reasonCode: "NO_OPPONENT" },
    });
    expect(
      deriveGameStatistics({ setup, events: cancelledHistory }).metadata
        .lifecycleStatus,
    ).toBe("CANCELLED");
  });

  it("fails when an out lacks the explicit fielder path needed for reconciliation", () => {
    const history: AcceptedEvent[] = [];
    append(history, start);
    append(
      history,
      plate("away-one", "BATTER_OUT", [
        movement("away-one", "BATTER", "OUT", "home-pitcher", {
          out: {
            outNumber: 1,
            force: false,
            fielders: [],
          },
        }),
      ]),
    );
    expect(() => deriveGameStatistics({ setup, events: history })).toThrowError(
      expect.objectContaining({ code: "MISSING_ATTRIBUTION" }),
    );
  });

  it("fails explicitly for legacy scoring runs and pending earned-run judgments", () => {
    const history: AcceptedEvent[] = [];
    append(history, start);
    const scoring = buildEvent(
      setup,
      history,
      plate("away-one", "HOME_RUN", [movement("away-one", "BATTER", "HOME")]),
    );
    const scoringPayload = scoring.payload as Extract<
      EventBody,
      { eventType: "PlateAppearanceRecorded" }
    >["payload"];
    const legacy = {
      ...scoring,
      schemaVersion: 1 as const,
      payload: {
        ...scoringPayload,
        movements: scoringPayload.movements.map((movement) => {
          const legacyMovement = { ...movement };
          delete legacyMovement.earnedRun;
          return legacyMovement;
        }),
      },
    } as AcceptedEvent;
    expect(() =>
      deriveGameStatistics({ setup, events: [history[0]!, legacy] }),
    ).toThrowError(
      expect.objectContaining({ code: "UNSUPPORTED_EVENT_VERSION" }),
    );

    const pendingHistory: AcceptedEvent[] = [];
    append(pendingHistory, start);
    append(
      pendingHistory,
      plate("away-one", "HOME_RUN", [
        movement("away-one", "BATTER", "HOME", "home-pitcher", {
          earnedRun: "PENDING",
        }),
      ]),
    );
    expect(() =>
      deriveGameStatistics({ setup, events: pendingHistory }),
    ).toThrowError(
      expect.objectContaining({ code: "INCOMPLETE_REPLAY_STATE" }),
    );
  });

  it("rolls up verified game selections and rejects mixed Accounts", () => {
    const history: AcceptedEvent[] = [];
    append(history, start);
    append(
      history,
      plate("away-one", "HOME_RUN", [movement("away-one", "BATTER", "HOME")]),
    );
    const unverified = deriveGameStatistics({ setup, events: history });
    const verified = {
      ...unverified,
      metadata: {
        ...unverified.metadata,
        lifecycleStatus: "VERIFIED",
        verificationStatus: "VERIFIED" as const,
        seasonEligibility: "INCLUDED" as const,
      },
    };
    const season = deriveSeasonStatistics({
      accountId: "account-a",
      seasonId: "season-a",
      teamId: "away-team",
      games: [
        {
          projection: verified,
          side: "AWAY",
          seasonId: "season-a",
          teamId: "away-team",
        },
        {
          projection: {
            ...unverified,
            metadata: { ...unverified.metadata, gameId: "game-b" },
          },
          side: "AWAY",
          seasonId: "season-a",
          teamId: "away-team",
        },
      ],
    });
    expect(season.metadata.includedGameIds).toEqual(["game-a"]);
    expect(season.metadata.excludedUnverifiedGameIds).toEqual(["game-b"]);
    expect(season.team.batting.homeRuns).toBe(1);

    expect(() =>
      deriveSeasonStatistics({
        accountId: "account-b",
        seasonId: "season-a",
        teamId: "away-team",
        games: [
          {
            projection: verified,
            side: "AWAY",
            seasonId: "season-a",
            teamId: "away-team",
          },
        ],
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "ACCOUNT_MISMATCH",
      }) satisfies Partial<StatisticDerivationError>,
    );
  });
});
