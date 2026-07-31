import { performance } from "node:perf_hooks";

import { describe, expect, it } from "vitest";

import { replayGame, type GameSide } from "@/domain/events/event-log";
import {
  createPortableDataDocument,
  encodePortableDocument,
  validatePortableImport,
  type PortableData,
} from "@/domain/portable-data";
import {
  buildSeasonDashboard,
  type SeasonDashboardGame,
} from "@/domain/reports";
import {
  createPlateAppearanceDraft,
  previewPlateAppearance,
} from "@/features/scoring/plate-appearance";
import {
  buildCorrectionPayload,
  previewCorrection,
} from "@/features/scoring/scoring-corrections";
import { previewRunnerPlay } from "@/features/scoring/runner-interactions";
import {
  FIXTURE_IDS,
  ScoringFixtureBuilder,
  fixturePlayer,
  routineOut,
} from "../fixtures/scoring-fixture-builder";

type Measurement = {
  workflow: string;
  samples: number;
  medianMilliseconds: number;
  p95Milliseconds: number;
};

const fullMeasurement = process.env.EXPERIENCE_MEASURE === "1";

function measure(
  workflow: string,
  samples: number,
  operation: () => unknown,
): Measurement {
  const warmups = fullMeasurement ? 10 : 1;
  for (let index = 0; index < warmups; index += 1) operation();
  const durations = Array.from({ length: samples }, () => {
    const started = performance.now();
    operation();
    return performance.now() - started;
  }).sort((left, right) => left - right);
  const percentile = (value: number) =>
    durations[Math.min(durations.length - 1, Math.ceil(value * samples) - 1)]!;
  return {
    workflow,
    samples,
    medianMilliseconds: Number(percentile(0.5).toFixed(3)),
    p95Milliseconds: Number(percentile(0.95).toFixed(3)),
  };
}

function acceptedWalk(builder: ScoringFixtureBuilder) {
  const state = builder.state();
  const draft = createPlateAppearanceDraft(state, "WALK");
  for (const origin of Object.keys(draft.earnedRuns)) {
    draft.earnedRuns[origin as keyof typeof draft.earnedRuns] = "EARNED";
  }
  const preview = previewPlateAppearance(state, draft);
  if (!preview.body || preview.errors.length > 0) {
    throw new Error(preview.errors.join("; "));
  }
  builder.append(preview.body);
}

function portableDocument(recordCount: number) {
  const data: PortableData = {
    teams: Array.from({ length: recordCount }, (_, index) => ({
      id: `synthetic-team-${index.toString().padStart(4, "0")}`,
      displayName: `Synthetic team ${index}`,
      status: "ACTIVE",
      archived: false,
    })),
    seasons: [],
    teamSeasons: [],
    players: [],
    rosters: [],
    rulesets: [],
    games: [],
  };
  return encodePortableDocument(
    createPortableDataDocument({
      exportedAt: "2026-07-30T20:00:00.000Z",
      data,
    }),
  );
}

describe("controlled experience measurement harness", () => {
  it("measures representative pure workflows without flaky timing gates", () => {
    const samples = (full: number) => (fullMeasurement ? full : 1);
    const routine = new ScoringFixtureBuilder();
    routine.start();
    const routineState = routine.state();

    const complex = new ScoringFixtureBuilder();
    complex.start();
    acceptedWalk(complex);
    acceptedWalk(complex);
    acceptedWalk(complex);
    const complexState = complex.state();

    const correction = new ScoringFixtureBuilder();
    correction.start();
    acceptedWalk(correction);
    const correctionEvents = correction.events();
    const correctionPayload = buildCorrectionPayload(correctionEvents, {
      targetEventId: correctionEvents.at(-1)!.id,
      action: "REVERSE_EVENT",
      replacementOutcome: null,
      errorFielderId: null,
      reasonCode: "DATA_ENTRY_ERROR",
      replacementId: "measurement-replacement",
    });

    const longGame = new ScoringFixtureBuilder();
    longGame.start();
    const longGameEvents = fullMeasurement ? 75 : 12;
    for (let index = 0; index < longGameEvents; index += 1) {
      const fieldingSide: GameSide =
        longGame.state().half === "TOP" ? "HOME" : "AWAY";
      longGame.append(
        routineOut(
          longGame.state(),
          fixturePlayer(longGame.setup, fieldingSide, 1),
        ),
      );
    }
    const dashboardGame = new ScoringFixtureBuilder();
    dashboardGame.start();
    acceptedWalk(dashboardGame);
    dashboardGame.append({
      eventType: "GameCompleted",
      payload: { reasonCode: "TIME_LIMIT", ending: "TIME_LIMIT" },
    });
    dashboardGame.append({ eventType: "GameVerified", payload: {} });
    const dashboardProjection = dashboardGame.statistics();
    const dashboardGameCount = fullMeasurement ? 100 : 5;
    const games: SeasonDashboardGame[] = Array.from(
      { length: dashboardGameCount },
      (_, index) => {
        const playerId = (value: string) => `${value}-game-${index}`;
        const gameProjection = {
          ...dashboardProjection,
          metadata: {
            ...dashboardProjection.metadata,
            gameId: `measurement-game-${index}`,
            setupSnapshotId: `measurement-setup-${index}`,
          },
          batting: dashboardProjection.batting.map((line) => ({
            ...line,
            playerId: playerId(line.playerId),
          })),
          pitching: dashboardProjection.pitching.map((line) => ({
            ...line,
            playerId: playerId(line.playerId),
          })),
          fielding: dashboardProjection.fielding.map((line) => ({
            ...line,
            playerId: playerId(line.playerId),
          })),
        };
        return {
          projection: gameProjection,
          side: "AWAY",
          seasonId: "measurement-season",
          teamId: "measurement-team",
          setupSnapshotId: `measurement-setup-${index}`,
          scheduledAt: `2026-06-${String((index % 28) + 1).padStart(2, "0")}T12:00:00.000Z`,
          opponentDisplayName: `Opponent ${index}`,
          playerNames: Object.fromEntries(
            [
              ...gameProjection.batting,
              ...gameProjection.pitching,
              ...gameProjection.fielding,
            ].map(({ playerId: id }) => [id, `Synthetic player ${id}`]),
          ),
        };
      },
    );
    const importRecordCount = fullMeasurement ? 9_000 : 100;
    const importBytes = portableDocument(importRecordCount);

    const measurements = [
      measure("routine scoring preview", samples(200), () => {
        const preview = previewPlateAppearance(
          routineState,
          createPlateAppearanceDraft(routineState, "WALK"),
        );
        if (!preview.body) throw new Error("Routine preview failed.");
      }),
      measure("complex runner preview", samples(200), () => {
        const preview = previewRunnerPlay(complexState, {
          playType: "OPTIONAL_ADVANCE",
          outcomes: {
            FIRST: "SECOND",
            SECOND: "THIRD",
            THIRD: "HOME",
          },
          earnedRuns: { THIRD: "EARNED" },
          outFielderIds: [],
          errorFielderId: null,
        });
        if (!preview.body) throw new Error("Complex preview failed.");
      }),
      measure("correction preview", samples(100), () =>
        previewCorrection(
          correction.setup,
          correctionEvents,
          correctionPayload,
        ),
      ),
      measure(`${longGameEvents}-event replay`, samples(10), () =>
        replayGame(longGame.setup, longGame.events(), {
          verifyEvidence: true,
        }),
      ),
      measure(
        `${dashboardGameCount}-game / many-candidate dashboard derivation`,
        samples(20),
        () =>
          buildSeasonDashboard({
            accountId: FIXTURE_IDS.account,
            seasonId: "measurement-season",
            seasonDisplayName: "Synthetic ordinary season",
            teamId: "measurement-team",
            teamDisplayName: "Synthetic team",
            games,
          }),
      ),
      measure(`${importRecordCount}-record import validation`, samples(5), () =>
        validatePortableImport({
          bytes: importBytes,
          targetAccountId: "measurement-target",
        }),
      ),
    ];

    expect(importBytes.byteLength).toBeLessThan(5 * 1024 * 1024);
    expect(
      measurements.every(
        ({ medianMilliseconds, p95Milliseconds }) =>
          Number.isFinite(medianMilliseconds) &&
          Number.isFinite(p95Milliseconds),
      ),
    ).toBe(true);
    if (fullMeasurement) {
      console.table(measurements);
      console.log(
        `Near-limit import artifact: ${importBytes.byteLength} bytes`,
      );
    }
  });
});
