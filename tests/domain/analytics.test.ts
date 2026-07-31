import { describe, expect, it } from "vitest";

import {
  buildAnalyticsInsights,
  buildContactAnalytics,
  parseAnalyticsObservation,
  type AnalyticsGame,
} from "@/domain/analytics";
import type { AcceptedEvent, AcceptedSetup } from "@/domain/events/event-log";
import type { GameStatisticsProjection } from "@/domain/statistics";

const setup = {
  id: "setup-1",
  accountId: "account-1",
  gameId: "game-1",
  setupRevision: 1,
  rulesetVersionId: "rules-1",
  scheduledInnings: 7,
  status: "READY",
  sides: {
    HOME: {
      startingPitcherId: "home-pitcher",
      lineup: [
        {
          playerId: "home-pitcher",
          battingOrder: 1,
          position: "PITCHER",
          active: true,
        },
      ],
    },
    AWAY: {
      startingPitcherId: "away-pitcher",
      lineup: [
        {
          playerId: "batter-1",
          battingOrder: 1,
          position: "CENTER_FIELD",
          active: true,
        },
      ],
    },
  },
} as unknown as AcceptedSetup;

function game(index: number, verified = true): AnalyticsGame {
  const gameId = `game-${index}`;
  const projection = {
    metadata: {
      accountId: "account-1",
      gameId,
      setupSnapshotId: "setup-1",
      setupRevision: 1,
      sourceRevision: index,
      privacyOverlayRevision: 1,
      rulesetVersionId: "rules-1",
      eventSchemaVersions: [3],
      derivationVersion: 2,
      statisticRulesVersion: 1,
      lifecycleStatus: "VERIFIED",
      verificationStatus: verified ? "VERIFIED" : "UNVERIFIED",
      seasonEligibility: verified ? "INCLUDED" : "EXCLUDED_UNVERIFIED",
    },
    outcome: "AWAY_WIN",
    finalScore: { HOME: 1, AWAY: index },
    inningLines: [],
    teams: {},
    batting: [],
    pitching: [],
    fielding: [],
  } as unknown as GameStatisticsProjection;
  const event = {
    eventType: "PlateAppearanceRecorded",
    payload: {
      batterId: "batter-1",
      pitcherId: "home-pitcher",
      outcome: index % 2 ? "SINGLE" : "BATTER_OUT",
      battedBall: index % 2 ? "LINE_DRIVE" : null,
      movements: [],
      fieldingCredits: [],
    },
  } as unknown as AcceptedEvent;
  return {
    projection,
    setup: { ...setup, gameId } as AcceptedSetup,
    events: [event],
    side: "AWAY",
    seasonId: "season-1",
    teamId: "team-1",
    scheduledAt: `2026-07-${String(index).padStart(2, "0")}T12:00:00.000Z`,
    opponentDisplayName: "Opponent",
    playerNames: { "batter-1": "Batter One", "home-pitcher": "Home Pitcher" },
  };
}

describe("M6 analytics derivation", () => {
  it("returns explainable lineup, matchup, and trend evidence from verified history", () => {
    const insights = buildAnalyticsInsights({
      accountId: "account-1",
      teamId: "team-1",
      seasonId: "season-1",
      games: [
        ...Array.from({ length: 5 }, (_, index) => game(index + 1)),
        game(6, false),
      ],
    });

    expect(insights.map(({ type }) => type)).toEqual([
      "LINEUP",
      "MATCHUP",
      "TREND",
    ]);
    expect(insights[0]?.sourceGames).toHaveLength(5);
    expect(insights[1]?.confidence).toBe("INSUFFICIENT");
    expect(insights[2]?.confidence).toBe("SUPPORTED");
    expect(insights[2]?.limitations[0]).toContain("Descriptive");
  });

  it("counts missing batted-ball facts and explicit optional locations separately", () => {
    const observation = parseAnalyticsObservation({
      id: "observation-1",
      accountId: "account-1",
      gameId: "game-1",
      setupSnapshotId: "setup-1",
      sourceEventId: "event-1",
      type: "BATTED_BALL_LOCATION",
      version: 1,
      ordinal: 0,
      captureSource: "MANUAL",
      confidence: "OBSERVED",
      payload: { sector: "CENTER_FIELD", x: 0, y: 0.5 },
      supersedesObservationId: null,
      recordedAt: "2026-07-31T12:00:00.000Z",
    });
    const contact = buildContactAnalytics([game(1)], [observation]);

    expect(contact.battedBall.observed).toBe(1);
    expect(contact.battedBall.missing).toBe(0);
    expect(contact.battedBallLocations.observed).toBe(1);
    expect(contact.pitchLocations.observed).toBe(0);
    expect(() =>
      parseAnalyticsObservation({
        ...observation,
        id: "invalid",
        payload: { sector: "CENTER_FIELD", x: 2, y: 0 },
      }),
    ).toThrow();
  });
});
