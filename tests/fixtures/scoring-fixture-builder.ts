import {
  EVENT_SCHEMA_VERSION,
  deriveEventStates,
  parseEvent,
  parseEventBody,
  replayGame,
  stateHash,
  type AcceptedEvent,
  type AcceptedSetup,
  type BaseballPosition,
  type EventBody,
  type GameSide,
  type GameState,
  type RunnerMovement,
} from "@/domain/events/event-log";
import {
  deriveGameStatistics,
  type GameStatisticsProjection,
} from "@/domain/statistics";

export const FIXTURE_IDS = {
  account: "fixture-account",
  game: "fixture-game",
  setup: "fixture-setup",
  ruleset: "fixture-ruleset-v1",
  actor: "fixture-scorekeeper",
  user: "fixture-user",
  away: {
    batters: [
      "away-batter-1",
      "away-batter-2",
      "away-batter-3",
      "away-batter-4",
      "away-batter-5",
    ],
    pitcher: "away-pitcher",
    reliever: "away-reliever",
    bench: "away-bench",
  },
  home: {
    batters: [
      "home-batter-1",
      "home-batter-2",
      "home-batter-3",
      "home-batter-4",
      "home-batter-5",
    ],
    pitcher: "home-pitcher",
    reliever: "home-reliever",
    bench: "home-bench",
  },
} as const;

const BATTER_POSITIONS = [
  "CATCHER",
  "FIRST_BASE",
  "SECOND_BASE",
  "SHORTSTOP",
  "LEFT_FIELD",
] as const satisfies readonly BaseballPosition[];

export type FixtureSetupOptions = {
  prefix?: string;
  accountId?: string;
  gameId?: string;
  setupId?: string;
  rulesetVersionId?: string;
  scheduledInnings?: number;
};

const prefixed = (prefix: string, value: string) =>
  prefix.length === 0 ? value : `${prefix}-${value}`;

export function createScoringSetup(
  options: FixtureSetupOptions = {},
): AcceptedSetup {
  const prefix = options.prefix ?? "";
  const accountId = options.accountId ?? prefixed(prefix, FIXTURE_IDS.account);
  const gameId = options.gameId ?? prefixed(prefix, FIXTURE_IDS.game);
  const setupId = options.setupId ?? prefixed(prefix, FIXTURE_IDS.setup);
  const rulesetVersionId =
    options.rulesetVersionId ?? prefixed(prefix, FIXTURE_IDS.ruleset);

  const side = (name: "away" | "home") => {
    const ids = FIXTURE_IDS[name];
    return {
      startingPitcherId: prefixed(prefix, ids.pitcher),
      lineup: [
        ...ids.batters.map((playerId, index) => ({
          playerId: prefixed(prefix, playerId),
          battingOrder: index + 1,
          position: BATTER_POSITIONS[index]!,
          active: true,
        })),
        {
          playerId: prefixed(prefix, ids.pitcher),
          battingOrder: null,
          position: "PITCHER" as const,
          active: true,
        },
        {
          playerId: prefixed(prefix, ids.reliever),
          battingOrder: null,
          position: "CENTER_FIELD" as const,
          active: true,
        },
        {
          playerId: prefixed(prefix, ids.bench),
          battingOrder: null,
          position: null,
          active: false,
        },
      ],
    };
  };

  return {
    id: setupId,
    accountId,
    gameId,
    setupRevision: 1,
    rulesetVersionId,
    scheduledInnings: options.scheduledInnings ?? 2,
    status: "READY",
    sides: { AWAY: side("away"), HOME: side("home") },
  };
}

export function fixturePlayer(
  setup: AcceptedSetup,
  side: GameSide,
  role: "pitcher" | "reliever" | "bench" | number,
): string {
  if (typeof role === "number") {
    const entry = setup.sides[side].lineup.find(
      ({ battingOrder }) => battingOrder === role,
    );
    if (!entry) throw new Error(`Fixture batter ${side} ${role} is missing.`);
    return entry.playerId;
  }
  if (role === "pitcher") return setup.sides[side].startingPitcherId;
  const entry = setup.sides[side].lineup.find(({ playerId }) =>
    playerId.endsWith(`-${role}`),
  );
  if (!entry) throw new Error(`Fixture ${side} ${role} is missing.`);
  return entry.playerId;
}

export function currentFixtureBatter(state: GameState): string {
  const side = state.half === "TOP" ? "AWAY" : "HOME";
  const battingOrder = state.lineups[side]
    .filter(({ active, battingOrder }) => active && battingOrder !== null)
    .sort((left, right) => left.battingOrder! - right.battingOrder!);
  const batter =
    battingOrder[state.battingOrderIndex[side] % battingOrder.length];
  if (!batter) throw new Error("Fixture batting order is empty.");
  return batter.playerId;
}

export function runnerMovement(
  runnerId: string,
  from: RunnerMovement["from"],
  to: RunnerMovement["to"],
  responsiblePitcherId: string,
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
            fielders: [] as string[],
          },
        }
      : {}),
    ...overrides,
  } as RunnerMovement;
}

type PlateAppearance = Extract<
  EventBody,
  { eventType: "PlateAppearanceRecorded" }
>;

export function plateAppearance(
  batterId: string,
  pitcherId: string,
  outcome: PlateAppearance["payload"]["outcome"],
  movements: RunnerMovement[],
  options: {
    battedBall?: PlateAppearance["payload"]["battedBall"];
    fieldingCredits?: PlateAppearance["payload"]["fieldingCredits"];
  } = {},
): PlateAppearance {
  return parseEventBody({
    eventType: "PlateAppearanceRecorded",
    payload: {
      batterId,
      pitcherId,
      outcome,
      battedBall:
        options.battedBall ??
        (outcome === "SACRIFICE_BUNT"
          ? "BUNT"
          : outcome === "SACRIFICE_FLY"
            ? "FLY_BALL"
            : null),
      movements,
      fieldingCredits: options.fieldingCredits ?? [],
    },
  }) as PlateAppearance;
}

export function routineOut(
  state: GameState,
  putoutFielderId: string,
  outcome:
    "BATTER_OUT" | "STRIKEOUT_SWINGING" | "STRIKEOUT_LOOKING" = "BATTER_OUT",
): PlateAppearance {
  const batterId = currentFixtureBatter(state);
  const fieldingSide = state.half === "TOP" ? "HOME" : "AWAY";
  const pitcherId = state.activePitcher[fieldingSide];
  return plateAppearance(
    batterId,
    pitcherId,
    outcome,
    [
      runnerMovement(batterId, "BATTER", "OUT", pitcherId, {
        cause: "BATTER_RESULT",
        out: {
          outNumber: state.outs + 1,
          force: false,
          fielders: [putoutFielderId],
        },
      }),
    ],
    {
      fieldingCredits: [
        { fielderId: putoutFielderId, credit: "PUTOUT", errorType: null },
      ],
    },
  );
}

export type FixtureCheckpoint = {
  label: string;
  eventId: string;
  state: GameState;
};

export class ScoringFixtureBuilder {
  readonly setup: AcceptedSetup;
  private history: AcceptedEvent[] = [];
  private checkpoints: FixtureCheckpoint[] = [];

  constructor(setup: AcceptedSetup = createScoringSetup()) {
    this.setup = structuredClone(setup);
  }

  append(
    bodyInput: EventBody,
    label: string = bodyInput.eventType,
  ): AcceptedEvent {
    const body = parseEventBody(structuredClone(bodyInput));
    const current = replayGame(this.setup, this.history).state;
    const ordinal = this.history.length + 1;
    const recordedAt = new Date(
      Date.UTC(2026, 0, 1, 0, 0, 0) + ordinal * 1_000,
    ).toISOString();
    const acceptedAt = new Date(
      Date.UTC(2026, 0, 1, 0, 1, 0) + ordinal * 1_000,
    ).toISOString();
    const partial = {
      id: `${this.setup.gameId}-event-${ordinal}`,
      accountId: this.setup.accountId,
      gameId: this.setup.gameId,
      setupSnapshotId: this.setup.id,
      setupRevision: this.setup.setupRevision,
      sequence: current.lastSequence + 1,
      schemaVersion: EVENT_SCHEMA_VERSION,
      rulesetVersionId: this.setup.rulesetVersionId,
      playTransactionId: `${this.setup.gameId}-play-${ordinal}`,
      componentOrder: 0,
      clientSubmissionId: `${this.setup.gameId}-submission-${ordinal}`,
      expectedRevision: current.sourceRevision,
      acceptedRevision: current.sourceRevision + 1,
      actor: {
        kind: "USER" as const,
        id: FIXTURE_IDS.actor,
        userId: FIXTURE_IDS.user,
      },
      recordedAt,
      acceptedAt,
      ...body,
      preStateHash: stateHash(current),
      postStateHash: `sha256:v1:${"0".repeat(64)}`,
    } satisfies AcceptedEvent;
    const { before, after } = deriveEventStates(
      this.setup,
      this.history,
      partial,
    );
    const event = parseEvent({
      ...partial,
      preStateHash: stateHash(before),
      postStateHash: stateHash(after),
    });
    this.history.push(event);
    this.checkpoints.push({
      label,
      eventId: event.id,
      state: structuredClone(after),
    });
    return structuredClone(event);
  }

  start(): AcceptedEvent {
    return this.append({ eventType: "GameStarted", payload: {} }, "start");
  }

  state(): GameState {
    return structuredClone(replayGame(this.setup, this.history).state);
  }

  events(): AcceptedEvent[] {
    return structuredClone(this.history);
  }

  statistics(): GameStatisticsProjection {
    return deriveGameStatistics({
      setup: structuredClone(this.setup),
      events: this.events(),
    });
  }

  checkpoint(label: string): GameState {
    const checkpoint = this.checkpoints.find(
      (candidate) => candidate.label === label,
    );
    if (!checkpoint) throw new Error(`Fixture checkpoint ${label} is missing.`);
    return structuredClone(checkpoint.state);
  }
}
