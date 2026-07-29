import { describe, expect, it } from "vitest";

import {
  EVENT_SCHEMA_VERSION,
  applyEvent,
  canonicalJson,
  createInitialState,
  deriveEventStates,
  parseEvent,
  parseEventBody,
  replayGame,
  resolveEffectiveEvents,
  stateHash,
  summarizeEventLog,
  type AcceptedEvent,
  type AcceptedSetup,
  type EventBody,
  type GameState,
  type RunnerMovement,
} from "@/domain/events/event-log";

const setup: AcceptedSetup = {
  id: "setup-a",
  accountId: "account-a",
  gameId: "game-a",
  setupRevision: 1,
  rulesetVersionId: "ruleset-1",
  scheduledInnings: 9,
  status: "READY",
  sides: {
    HOME: {
      startingPitcherId: "home-pitcher",
      lineup: [
        {
          playerId: "home-batter-1",
          battingOrder: 1,
          position: "SHORTSTOP",
          active: true,
        },
        {
          playerId: "home-batter-2",
          battingOrder: 2,
          position: "CATCHER",
          active: true,
        },
        {
          playerId: "home-pitcher",
          battingOrder: null,
          position: "PITCHER",
          active: true,
        },
        {
          playerId: "home-bench",
          battingOrder: null,
          position: null,
          active: false,
        },
      ],
    },
    AWAY: {
      startingPitcherId: "away-pitcher",
      lineup: [
        {
          playerId: "away-batter-1",
          battingOrder: 1,
          position: "SHORTSTOP",
          active: true,
        },
        {
          playerId: "away-batter-2",
          battingOrder: 2,
          position: "CATCHER",
          active: true,
        },
        {
          playerId: "away-pitcher",
          battingOrder: null,
          position: "PITCHER",
          active: true,
        },
        {
          playerId: "away-bench",
          battingOrder: null,
          position: null,
          active: false,
        },
      ],
    },
  },
};

const startBody = {
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
      ? { runCounts: true, rbiEligible: true, earnedRun: "EARNED" as const }
      : {}),
    ...(to === "OUT"
      ? { out: { outNumber: 1, force: false, fielders: [] } }
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
  fieldingCredits: Extract<
    EventBody,
    { eventType: "PlateAppearanceRecorded" }
  >["payload"]["fieldingCredits"] = [],
): Extract<EventBody, { eventType: "PlateAppearanceRecorded" }> {
  return {
    eventType: "PlateAppearanceRecorded",
    payload: {
      batterId,
      pitcherId: "home-pitcher",
      outcome,
      battedBall:
        outcome === "SACRIFICE_BUNT"
          ? "BUNT"
          : outcome === "SACRIFICE_FLY"
            ? "FLY_BALL"
            : null,
      movements,
      fieldingCredits,
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
    actor: { kind: "USER" as const, id: "actor-1", userId: "user-1" },
    recordedAt: "2026-07-29T12:00:00.000Z",
    acceptedAt: "2026-07-29T12:00:01.000Z",
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
  acceptedSetup: AcceptedSetup,
  history: AcceptedEvent[],
  body: EventBody,
  id?: string,
): GameState {
  history.push(buildEvent(acceptedSetup, history, body, id));
  return replayGame(acceptedSetup, history, { verifyEvidence: true }).state;
}

describe("versioned event contracts and initial state", () => {
  it("validates strict payloads, privacy allowlists, event types, and versions", () => {
    const event = buildEvent(setup, [], startBody);
    expect(parseEvent(event)).toEqual(event);
    expect(() => parseEvent({ ...event, schemaVersion: 99 })).toThrowError(
      expect.objectContaining({ code: "UNSUPPORTED_SCHEMA_VERSION" }),
    );
    expect(() =>
      parseEventBody({ eventType: "UnknownEvent", payload: {} }),
    ).toThrowError(expect.objectContaining({ code: "UNSUPPORTED_EVENT_TYPE" }));
    expect(() =>
      parseEvent({
        ...event,
        payload: { email: "private@example.test" },
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_PAYLOAD" }));
    expect(() =>
      parseEventBody({
        eventType: "GameSuspended",
        payload: { reasonCode: "weather", notes: "unbounded" },
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_PAYLOAD" }));
  });

  it("keeps version 1 replayable and requires earned-run judgment in version 2", () => {
    const currentStart = buildEvent(setup, [], startBody);
    expect(parseEvent({ ...currentStart, schemaVersion: 1 })).toMatchObject({
      schemaVersion: 1,
      eventType: "GameStarted",
    });

    const scoring = buildEvent(
      setup,
      [currentStart],
      plate("away-batter-1", "HOME_RUN", [
        movement("away-batter-1", "BATTER", "HOME"),
      ]),
    );
    const payload = scoring.payload as Extract<
      EventBody,
      { eventType: "PlateAppearanceRecorded" }
    >["payload"];
    expect(() =>
      parseEvent({
        ...scoring,
        payload: {
          ...payload,
          movements: payload.movements.map((runnerMovement) => {
            const withoutEarnedRun = { ...runnerMovement };
            delete withoutEarnedRun.earnedRun;
            return withoutEarnedRun;
          }),
        },
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_PAYLOAD" }));
  });

  it("constructs deterministic state only from a complete accepted setup", () => {
    const first = createInitialState(setup);
    const second = createInitialState(JSON.parse(JSON.stringify(setup)));
    expect(first).toEqual(second);
    expect(first.setupSnapshotId).toBe("setup-a");
    expect(first.participatedPlayers.HOME).not.toContain("home-bench");

    expect(() =>
      createInitialState({
        ...setup,
        sides: {
          ...setup.sides,
          HOME: {
            ...setup.sides.HOME,
            lineup: [setup.sides.HOME.lineup[0]!, setup.sides.HOME.lineup[0]!],
          },
        },
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_LINEUP" }));
  });
});

describe("pure scoring reducer", () => {
  it("starts a game and resolves forced runners independent of movement order", () => {
    const history: AcceptedEvent[] = [];
    append(setup, history, startBody);
    append(
      setup,
      history,
      plate("away-batter-1", "WALK", [
        movement("away-batter-1", "BATTER", "FIRST", "home-pitcher", {
          cause: "FORCED_ADVANCE",
          forced: true,
        }),
      ]),
    );
    const state = append(
      setup,
      history,
      plate("away-batter-2", "WALK", [
        movement("away-batter-2", "BATTER", "FIRST", "home-pitcher", {
          cause: "FORCED_ADVANCE",
          forced: true,
        }),
        movement("away-batter-1", "FIRST", "SECOND", "home-pitcher", {
          cause: "FORCED_ADVANCE",
          forced: true,
        }),
      ]),
    );
    expect(state.bases).toEqual({
      FIRST: "away-batter-2",
      SECOND: "away-batter-1",
      THIRD: null,
    });
  });

  it("records hits, a counted run, and pitcher responsibility", () => {
    const history: AcceptedEvent[] = [];
    append(setup, history, startBody);
    append(
      setup,
      history,
      plate("away-batter-1", "SINGLE", [
        movement("away-batter-1", "BATTER", "FIRST"),
      ]),
    );
    const state = append(
      setup,
      history,
      plate("away-batter-2", "DOUBLE", [
        movement("away-batter-2", "BATTER", "SECOND"),
        movement("away-batter-1", "FIRST", "HOME"),
      ]),
    );
    expect(state.score.AWAY).toBe(1);
    expect(state.bases.SECOND).toBe("away-batter-2");
    expect(state.runnerPitcherResponsibility["away-batter-2"]).toBe(
      "home-pitcher",
    );
  });

  it("records reached-on-error and sacrifice judgments explicitly", () => {
    const history: AcceptedEvent[] = [];
    append(setup, history, startBody);
    append(
      setup,
      history,
      plate(
        "away-batter-1",
        "REACHED_ON_ERROR",
        [
          movement("away-batter-1", "BATTER", "FIRST", "home-pitcher", {
            cause: "ERROR",
          }),
        ],
        [
          {
            fielderId: "home-batter-1",
            credit: "ERROR",
            errorType: "FIELDING",
          },
        ],
      ),
    );
    const state = append(
      setup,
      history,
      plate("away-batter-2", "SACRIFICE_BUNT", [
        movement("away-batter-2", "BATTER", "OUT", "home-pitcher", {
          cause: "SACRIFICE",
          out: { outNumber: 1, force: false, fielders: ["home-pitcher"] },
        }),
        movement("away-batter-1", "FIRST", "SECOND", "home-pitcher", {
          cause: "SACRIFICE",
        }),
      ]),
    );
    expect(state.outs).toBe(1);
    expect(state.bases.SECOND).toBe("away-batter-1");
  });

  it("handles stolen bases, caught stealing, strikeouts, and inning transition", () => {
    const history: AcceptedEvent[] = [];
    append(setup, history, startBody);
    append(
      setup,
      history,
      plate("away-batter-1", "WALK", [
        movement("away-batter-1", "BATTER", "FIRST"),
      ]),
    );
    append(setup, history, {
      eventType: "StolenBaseAttemptRecorded",
      payload: {
        runnerId: "away-batter-1",
        from: "FIRST",
        to: "SECOND",
        result: "STOLEN_BASE",
        responsiblePitcherId: "home-pitcher",
        fielders: [],
      },
    });
    append(setup, history, {
      eventType: "StolenBaseAttemptRecorded",
      payload: {
        runnerId: "away-batter-1",
        from: "SECOND",
        to: "THIRD",
        result: "CAUGHT_STEALING",
        responsiblePitcherId: "home-pitcher",
        fielders: ["home-batter-2"],
      },
    });
    append(
      setup,
      history,
      plate("away-batter-2", "STRIKEOUT_SWINGING", [
        movement("away-batter-2", "BATTER", "OUT", "home-pitcher", {
          out: { outNumber: 2, force: false, fielders: ["home-batter-2"] },
        }),
      ]),
    );
    const state = append(
      setup,
      history,
      plate("away-batter-1", "BATTER_OUT", [
        movement("away-batter-1", "BATTER", "OUT", "home-pitcher", {
          out: { outNumber: 3, force: false, fielders: ["home-batter-1"] },
        }),
      ]),
    );
    expect(state.half).toBe("BOTTOM");
    expect(state.outs).toBe(0);
    expect(state.bases).toEqual({ FIRST: null, SECOND: null, THIRD: null });
  });

  it("validates substitution lineage, alignment, and pitching changes", () => {
    const history: AcceptedEvent[] = [];
    append(setup, history, startBody);
    append(setup, history, {
      eventType: "DefensiveSubstitutionMade",
      payload: {
        side: "HOME",
        outgoingPlayerId: "home-batter-1",
        incomingPlayerId: "home-bench",
        position: "SHORTSTOP",
      },
    });
    append(setup, history, {
      eventType: "DefensiveAlignmentChanged",
      payload: {
        side: "HOME",
        assignments: [
          { playerId: "home-bench", position: "CATCHER" },
          { playerId: "home-batter-2", position: "SHORTSTOP" },
        ],
        reasonCode: "SHIFT",
      },
    });
    const state = append(setup, history, {
      eventType: "PitchingChangeMade",
      payload: {
        side: "HOME",
        outgoingPitcherId: "home-pitcher",
        incomingPitcherId: "home-batter-2",
        inheritedRunnerIds: [],
      },
    });
    expect(state.activePitcher.HOME).toBe("home-batter-2");
    expect(state.defense.HOME.PITCHER).toBe("home-batter-2");
    expect(() =>
      append(setup, history, {
        eventType: "DefensiveSubstitutionMade",
        payload: {
          side: "HOME",
          outgoingPlayerId: "home-bench",
          incomingPlayerId: "home-batter-1",
          position: "CATCHER",
        },
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_LINEUP" }));
  });
});

describe("lifecycle and invalid transitions", () => {
  it("uses scheduled innings for extra innings and validates a walk-off ending", () => {
    const shortGame = { ...setup, scheduledInnings: 1 };
    const history: AcceptedEvent[] = [];
    append(shortGame, history, startBody);
    const recordOut = (
      batterId: string,
      pitcherId: string,
      outNumber: number,
    ) =>
      append(shortGame, history, {
        eventType: "PlateAppearanceRecorded",
        payload: {
          batterId,
          pitcherId,
          outcome: "BATTER_OUT",
          battedBall: "GROUND_BALL",
          movements: [
            movement(batterId, "BATTER", "OUT", pitcherId, {
              out: { outNumber, force: false, fielders: [] },
            }),
          ],
          fieldingCredits: [],
        },
      });
    for (const [batters, pitcher] of [
      [["away-batter-1", "away-batter-2", "away-batter-1"], "home-pitcher"],
      [["home-batter-1", "home-batter-2", "home-batter-1"], "away-pitcher"],
      [["away-batter-2", "away-batter-1", "away-batter-2"], "home-pitcher"],
    ] as const) {
      batters.forEach((batterId, index) =>
        recordOut(batterId, pitcher, index + 1),
      );
    }
    expect(replayGame(shortGame, history).state).toMatchObject({
      inning: 2,
      half: "BOTTOM",
    });
    append(shortGame, history, {
      eventType: "PlateAppearanceRecorded",
      payload: {
        batterId: "home-batter-2",
        pitcherId: "away-pitcher",
        outcome: "HOME_RUN",
        battedBall: "FLY_BALL",
        movements: [
          movement("home-batter-2", "BATTER", "HOME", "away-pitcher", {
            rbiEligible: true,
            runCounts: true,
          }),
        ],
        fieldingCredits: [],
      },
    });
    const completed = append(shortGame, history, {
      eventType: "GameCompleted",
      payload: { reasonCode: "WALK_OFF", ending: "WALK_OFF" },
    });
    expect(completed.status).toBe("COMPLETED");
    expect(completed.score.HOME).toBe(1);
  });

  it("preserves state across suspension and rejects scoring while suspended", () => {
    const history: AcceptedEvent[] = [];
    append(setup, history, startBody);
    const suspended = append(setup, history, {
      eventType: "GameSuspended",
      payload: { reasonCode: "WEATHER" },
    });
    expect(() =>
      append(
        setup,
        history,
        plate("away-batter-1", "SINGLE", [
          movement("away-batter-1", "BATTER", "FIRST"),
        ]),
      ),
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_LIFECYCLE_TRANSITION" }),
    );
    expect(suspended.status).toBe("SUSPENDED");
    const resumed = append(setup, history, {
      eventType: "GameResumed",
      payload: {},
    });
    expect(resumed.status).toBe("IN_PROGRESS");
  });

  it("rejects wrong batter, impossible movement, stale revisions, and identity mismatch", () => {
    const history: AcceptedEvent[] = [buildEvent(setup, [], startBody)];
    expect(() =>
      buildEvent(
        setup,
        history,
        plate("away-batter-2", "SINGLE", [
          movement("away-batter-2", "BATTER", "FIRST"),
        ]),
      ),
    ).toThrowError(expect.objectContaining({ code: "INVALID_LINEUP" }));

    append(
      setup,
      history,
      plate("away-batter-1", "SINGLE", [
        movement("away-batter-1", "BATTER", "FIRST"),
      ]),
    );
    expect(() =>
      buildEvent(
        setup,
        history,
        plate("away-batter-2", "SINGLE", [
          movement("away-batter-2", "BATTER", "FIRST"),
        ]),
      ),
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_RUNNER_MOVEMENT" }),
    );
    expect(() =>
      buildEvent(
        setup,
        history,
        plate("away-batter-2", "DOUBLE", [
          movement("away-batter-2", "BATTER", "SECOND"),
        ]),
      ),
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_RUNNER_MOVEMENT" }),
    );

    const start = history[0]!;
    const initial = createInitialState(setup);
    expect(() =>
      applyEvent(initial, { ...start, accountId: "account-b" }),
    ).toThrowError(expect.objectContaining({ code: "ACCOUNT_MISMATCH" }));
    expect(() =>
      applyEvent(initial, { ...start, gameId: "game-b" }),
    ).toThrowError(expect.objectContaining({ code: "GAME_MISMATCH" }));
    expect(() =>
      applyEvent(initial, { ...start, setupSnapshotId: "setup-b" }),
    ).toThrowError(expect.objectContaining({ code: "SETUP_NOT_READY" }));
    expect(() =>
      applyEvent(replayGame(setup, history).state, start),
    ).toThrowError(expect.objectContaining({ code: "STALE_SOURCE_REVISION" }));
    expect(() => replayGame(setup, [{ ...start, sequence: 2 }])).toThrowError(
      expect.objectContaining({ code: "SEQUENCE_CONFLICT" }),
    );
  });

  it("completes, verifies, reopens, and prevents ordinary verified scoring", () => {
    const history: AcceptedEvent[] = [];
    append(setup, history, startBody);
    append(setup, history, {
      eventType: "GameCompleted",
      payload: { reasonCode: "TIME_LIMIT", ending: "TIME_LIMIT" },
    });
    const verified = append(setup, history, {
      eventType: "GameVerified",
      payload: {},
    });
    expect(verified.status).toBe("VERIFIED");
    expect(() =>
      append(
        setup,
        history,
        plate("away-batter-1", "SINGLE", [
          movement("away-batter-1", "BATTER", "FIRST"),
        ]),
      ),
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_LIFECYCLE_TRANSITION" }),
    );
    const reopened = append(setup, history, {
      eventType: "GameReopened",
      payload: { reasonCode: "SCORING_REVIEW" },
    });
    expect(reopened.status).toBe("CORRECTED");
  });
});

describe("corrections and deterministic replay", () => {
  it("replaces an original event, preserves it for audit, and reverses the correction", () => {
    const history: AcceptedEvent[] = [];
    append(setup, history, startBody);
    append(
      setup,
      history,
      plate("away-batter-1", "DOUBLE", [
        movement("away-batter-1", "BATTER", "SECOND"),
      ]),
      "original-double",
    );
    const correctionBody = {
      eventType: "CorrectionApplied",
      payload: {
        policy: "REPLACE_JUDGMENT",
        targetEventIds: ["original-double"],
        replacements: [
          {
            id: "replacement-single",
            order: 0,
            targetEventId: "original-double",
            body: plate("away-batter-1", "SINGLE", [
              movement("away-batter-1", "BATTER", "FIRST", "home-pitcher", {
                cause: "CORRECTION",
              }),
            ]),
          },
        ],
        reasonCode: "HIT_VALUE",
      },
    } satisfies EventBody;
    const corrected = append(setup, history, correctionBody, "correction-1");
    expect(corrected.bases).toEqual({
      FIRST: "away-batter-1",
      SECOND: null,
      THIRD: null,
    });
    expect(history.find(({ id }) => id === "original-double")?.payload).toEqual(
      expect.objectContaining({ outcome: "DOUBLE" }),
    );
    expect(resolveEffectiveEvents(history).map(({ id }) => id)).not.toContain(
      "original-double",
    );
    const original = history.find(({ id }) => id === "original-double")!;
    const correction = history.find(({ id }) => id === "correction-1")!;
    expect(() =>
      resolveEffectiveEvents([
        { ...original, accountId: "account-b", gameId: "game-b" },
        correction,
      ]),
    ).toThrowError(
      expect.objectContaining({ code: "CORRECTION_GRAPH_INVALID" }),
    );

    const reversed = append(
      setup,
      history,
      {
        eventType: "CorrectionApplied",
        payload: {
          policy: "REVERSE_EVENTS",
          targetEventIds: ["correction-1"],
          replacements: [],
          reasonCode: "RESTORE_ORIGINAL",
        },
      },
      "correction-2",
    );
    expect(reversed.bases.SECOND).toBe("away-batter-1");
    expect(resolveEffectiveEvents(history).map(({ id }) => id)).toContain(
      "original-double",
    );
  });

  it("invalidates verification only after explicit reopen and rejects ambiguous correction graphs", () => {
    const history: AcceptedEvent[] = [];
    append(setup, history, startBody);
    append(
      setup,
      history,
      plate("away-batter-1", "DOUBLE", [
        movement("away-batter-1", "BATTER", "SECOND"),
      ]),
      "verified-double",
    );
    append(setup, history, {
      eventType: "GameCompleted",
      payload: { reasonCode: "TIME_LIMIT", ending: "TIME_LIMIT" },
    });
    append(setup, history, {
      eventType: "GameVerified",
      payload: {},
    });
    const correction = {
      eventType: "CorrectionApplied",
      payload: {
        policy: "REPLACE_JUDGMENT",
        targetEventIds: ["verified-double"],
        replacements: [
          {
            id: "verified-single",
            order: 0,
            targetEventId: "verified-double",
            body: plate("away-batter-1", "SINGLE", [
              movement("away-batter-1", "BATTER", "FIRST", "home-pitcher", {
                cause: "CORRECTION",
              }),
            ]),
          },
        ],
        reasonCode: "REVIEW",
      },
    } satisfies EventBody;
    expect(() => append(setup, history, correction)).toThrowError(
      expect.objectContaining({ code: "INVALID_LIFECYCLE_TRANSITION" }),
    );
    append(setup, history, {
      eventType: "GameReopened",
      payload: { reasonCode: "REVIEW" },
    });
    const corrected = append(setup, history, correction, "verified-correction");
    expect(corrected.status).toBe("CORRECTED");

    expect(() =>
      buildEvent(setup, history, {
        eventType: "CorrectionApplied",
        payload: {
          policy: "REVERSE_EVENTS",
          targetEventIds: ["verified-double"],
          replacements: [],
          reasonCode: "AMBIGUOUS",
        },
      }),
    ).toThrowError(
      expect.objectContaining({ code: "CORRECTION_GRAPH_INVALID" }),
    );
  });

  it("verifies state evidence across corrections and is stable after serialization", () => {
    const history: AcceptedEvent[] = [];
    append(setup, history, startBody);
    append(
      setup,
      history,
      plate("away-batter-1", "SINGLE", [
        movement("away-batter-1", "BATTER", "FIRST"),
      ]),
    );
    const first = replayGame(setup, history, { verifyEvidence: true });
    const second = replayGame(
      JSON.parse(JSON.stringify(setup)),
      JSON.parse(JSON.stringify([...history].reverse())),
      { verifyEvidence: true },
    );
    expect(first).toEqual(second);
    expect(canonicalJson({ z: 1, a: { d: 2, b: 1 } })).toBe(
      '{"a":{"b":1,"d":2},"z":1}',
    );
    expect(() =>
      replayGame(
        setup,
        [{ ...history[0]!, postStateHash: `sha256:v1:${"f".repeat(64)}` }],
        { verifyEvidence: true },
      ),
    ).toThrowError(
      expect.objectContaining({ code: "IMMUTABLE_HISTORY_VIOLATION" }),
    );
    expect(summarizeEventLog(history)).toMatchObject({
      accountId: "account-a",
      gameId: "game-a",
      eventCount: 2,
    });
  });
});
