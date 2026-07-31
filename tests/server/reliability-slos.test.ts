import { describe, expect, it } from "vitest";

import {
  evaluateErrorBudget,
  RELIABILITY_SLOS,
} from "@/server/observability/reliability-slos";

describe("production reliability SLOs", () => {
  it("defines measurable rolling targets for every required indicator", () => {
    expect(RELIABILITY_SLOS).toEqual({
      availability: {
        key: "availability",
        target: 0.999,
        windowDays: 30,
      },
      scoring_acceptance_latency: {
        key: "scoring_acceptance_latency",
        target: 0.99,
        windowDays: 30,
        thresholdMs: 1_000,
      },
      report_freshness: {
        key: "report_freshness",
        target: 0.99,
        windowDays: 30,
        thresholdMs: 300_000,
      },
      recovery: {
        key: "recovery",
        target: 0.99,
        windowDays: 30,
        thresholdMs: 3_600_000,
      },
    });
  });

  it("turns observed bad events into a deterministic budget decision", () => {
    const healthy = evaluateErrorBudget({
      eligible: 100_000,
      good: 99_960,
      target: 0.999,
    });
    expect(healthy).toMatchObject({
      bad: 40,
      state: "healthy",
      pauseFeatureWork: false,
    });
    expect(healthy.allowedBad).toBeCloseTo(100);
    expect(healthy.consumedRatio).toBeCloseTo(0.4);
    expect(healthy.remainingRatio).toBeCloseTo(0.6);
    expect(
      evaluateErrorBudget({ eligible: 100_000, good: 99_940, target: 0.999 }),
    ).toMatchObject({ state: "at_risk", pauseFeatureWork: false });
    expect(
      evaluateErrorBudget({ eligible: 100_000, good: 99_900, target: 0.999 }),
    ).toMatchObject({ state: "exhausted", pauseFeatureWork: true });
  });

  it("does not manufacture a passing SLO when there is no traffic", () => {
    expect(
      evaluateErrorBudget({ eligible: 0, good: 0, target: 0.999 }),
    ).toMatchObject({ state: "no_data", consumedRatio: 0, burnRate: 0 });
  });

  it("rejects invalid counters and targets", () => {
    expect(() =>
      evaluateErrorBudget({ eligible: 1, good: 2, target: 0.999 }),
    ).toThrow(RangeError);
    expect(() =>
      evaluateErrorBudget({ eligible: 1, good: 1, target: 1 }),
    ).toThrow(RangeError);
  });
});
