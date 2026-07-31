import { describe, expect, it } from "vitest";

import { GameEventError } from "@/domain/events/event-log";
import {
  PRODUCT_ANALYTICS_SCHEMA_VERSION,
  analyticsDurationBucket,
  classifyScoringAnalyticsError,
  parseProductAnalyticsEvent,
  scoringEventFamily,
} from "@/domain/product-analytics";

const allowed = {
  schemaVersion: PRODUCT_ANALYTICS_SCHEMA_VERSION,
  name: "scoring.submission_succeeded",
  workflow: "LIVE_SCORING",
  result: "SUCCEEDED",
  eventFamily: "PLATE_APPEARANCE",
  durationBucket: "UNDER_250_MS",
  failureCategory: null,
} as const;

describe("privacy-safe product analytics contract", () => {
  it("accepts only the reviewed catalog and rejects private or arbitrary fields", () => {
    expect(parseProductAnalyticsEvent(allowed)).toEqual(allowed);
    for (const forbidden of [
      { playerName: "Taylor" },
      { eventPayload: { outcome: "SINGLE" } },
      { token: "secret" },
      { reportContent: "private" },
      { gameId: "game-a" },
      { accountId: "account-a" },
    ]) {
      expect(() =>
        parseProductAnalyticsEvent({ ...allowed, ...forbidden }),
      ).toThrow();
    }
  });

  it("uses coarse families and duration buckets", () => {
    expect(scoringEventFamily("PlateAppearanceRecorded")).toBe(
      "PLATE_APPEARANCE",
    );
    expect(scoringEventFamily("RunnerPlayRecorded")).toBe("RUNNER_MOVEMENT");
    expect(scoringEventFamily("PitchingChangeMade")).toBe("LINEUP_OR_PITCHING");
    expect(scoringEventFamily("GameStarted")).toBe("GAME_LIFECYCLE");
    expect(analyticsDurationBucket(249)).toBe("UNDER_250_MS");
    expect(analyticsDurationBucket(250)).toBe("UNDER_1_S");
    expect(analyticsDurationBucket(1_000)).toBe("UNDER_5_S");
    expect(analyticsDurationBucket(5_000)).toBe("SLOW");
  });

  it("separates baseball-rule rejections from workflow failures", () => {
    expect(
      classifyScoringAnalyticsError(
        new GameEventError("INVALID_RUNNER_MOVEMENT", "invalid"),
      ),
    ).toEqual({
      name: "scoring.baseball_rule_rejected",
      result: "BASEBALL_RULE_REJECTED",
      failureCategory: "BASEBALL_RULES",
    });
    expect(
      classifyScoringAnalyticsError(
        new GameEventError("STALE_SOURCE_REVISION", "stale"),
      ),
    ).toEqual({
      name: "scoring.workflow_failed",
      result: "WORKFLOW_FAILED",
      failureCategory: "CONCURRENCY",
    });
    expect(classifyScoringAnalyticsError(new Error("database"))).toEqual({
      name: "scoring.workflow_failed",
      result: "WORKFLOW_FAILED",
      failureCategory: "SERVICE",
    });
  });
});
