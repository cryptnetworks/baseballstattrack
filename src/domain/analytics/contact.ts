import type { AcceptedEvent } from "@/domain/events/event-log";

import {
  isBattedBallPayload,
  isPitchLocationPayload,
  type AnalyticsObservation,
} from "./observations";
import type { AnalyticsGame } from "./insights";

export type ContactAnalytics = {
  version: 1;
  battedBall: {
    games: number;
    eligiblePlateAppearances: number;
    observed: number;
    missing: number;
    byType: Record<string, number>;
  };
  battedBallLocations: {
    games: number;
    eligibleBallsInPlay: number;
    observed: number;
    missing: number;
    bySector: Record<string, number>;
  };
  pitchLocations: {
    games: number;
    observed: number;
    byZoneCell: Record<string, number>;
    byResult: Record<string, number>;
  };
  limitations: string[];
};

const battedBallTypes = [
  "GROUND_BALL",
  "FLY_BALL",
  "LINE_DRIVE",
  "POP_UP",
  "BUNT",
] as const;

function emptyCounts(values: readonly string[]) {
  return Object.fromEntries(values.map((value) => [value, 0]));
}

function teamPlateAppearances(
  game: AnalyticsGame,
): Extract<AcceptedEvent, { eventType: "PlateAppearanceRecorded" }>[] {
  const players = new Set(
    game.setup.sides[game.side].lineup.map(({ playerId }) => playerId),
  );
  return game.events.filter(
    (
      event,
    ): event is Extract<
      AcceptedEvent,
      { eventType: "PlateAppearanceRecorded" }
    > =>
      event.eventType === "PlateAppearanceRecorded" &&
      players.has(event.payload.batterId),
  );
}

export function buildContactAnalytics(
  games: readonly AnalyticsGame[],
  observations: readonly AnalyticsObservation[] = [],
): ContactAnalytics {
  const byType = emptyCounts(battedBallTypes);
  let eligiblePlateAppearances = 0;
  let observed = 0;
  let missing = 0;
  for (const game of games) {
    for (const event of teamPlateAppearances(game)) {
      eligiblePlateAppearances += 1;
      if (event.payload.battedBall === null) {
        missing += 1;
      } else {
        observed += 1;
        byType[event.payload.battedBall] =
          (byType[event.payload.battedBall] ?? 0) + 1;
      }
    }
  }
  const bySector = emptyCounts([
    "LEFT_FIELD",
    "LEFT_CENTER",
    "CENTER_FIELD",
    "RIGHT_CENTER",
    "RIGHT_FIELD",
    "INFIELD",
    "FOUL_UNKNOWN",
    "UNKNOWN",
  ]);
  const byZoneCell = emptyCounts([
    "UP_LEFT",
    "UP_MIDDLE",
    "UP_RIGHT",
    "MID_LEFT",
    "MID_MIDDLE",
    "MID_RIGHT",
    "LOW_LEFT",
    "LOW_MIDDLE",
    "LOW_RIGHT",
    "OUT_OF_ZONE",
    "UNKNOWN",
  ]);
  const byResult = emptyCounts([
    "BALL",
    "CALLED_STRIKE",
    "SWINGING_STRIKE",
    "FOUL",
    "IN_PLAY",
    "UNKNOWN",
  ]);
  // The persistence repository supplies only observations without a newer
  // superseding observation. Domain callers may pass an already-filtered view.
  for (const observation of observations) {
    if (isBattedBallPayload(observation)) {
      bySector[observation.payload.sector] =
        (bySector[observation.payload.sector] ?? 0) + 1;
    }
    if (isPitchLocationPayload(observation)) {
      byZoneCell[observation.payload.zoneCell] =
        (byZoneCell[observation.payload.zoneCell] ?? 0) + 1;
      byResult[observation.payload.result] =
        (byResult[observation.payload.result] ?? 0) + 1;
    }
  }
  const battedBallLocationCount = Object.values(bySector).reduce(
    (sum, value) => sum + value,
    0,
  );
  const pitchLocationCount = Object.values(byZoneCell).reduce(
    (sum, value) => sum + value,
    0,
  );
  return {
    version: 1,
    battedBall: {
      games: games.length,
      eligiblePlateAppearances,
      observed,
      missing,
      byType,
    },
    battedBallLocations: {
      games: games.length,
      eligibleBallsInPlay: observed,
      observed: battedBallLocationCount,
      missing: Math.max(0, observed - battedBallLocationCount),
      bySector,
    },
    pitchLocations: {
      games: games.length,
      observed: pitchLocationCount,
      byZoneCell,
      byResult,
    },
    limitations: [
      "Batted-ball classes are event observations; locations are optional manual observations.",
      "Pitch charts show only recorded pitches and never infer omitted pitches from the final plate appearance.",
      "Sparse samples are descriptive and must not be treated as defensive positioning, pitch quality, or player potential claims.",
    ],
  };
}
