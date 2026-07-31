import { z } from "zod";

import { GameEventError } from "@/domain/events/event-log";

export const PRODUCT_ANALYTICS_SCHEMA_VERSION = 1;
export const PRODUCT_ANALYTICS_POLICY_VERSION = "2026-07-31";
export const PRODUCT_ANALYTICS_CONSENT_DAYS = 365;

export const productAnalyticsEventNames = [
  "scoring.submission_succeeded",
  "scoring.baseball_rule_rejected",
  "scoring.workflow_failed",
] as const;

export const scoringEventFamilies = [
  "PLATE_APPEARANCE",
  "RUNNER_MOVEMENT",
  "LINEUP_OR_PITCHING",
  "GAME_LIFECYCLE",
] as const;

export const productAnalyticsEventSchema = z
  .object({
    schemaVersion: z.literal(PRODUCT_ANALYTICS_SCHEMA_VERSION),
    name: z.enum(productAnalyticsEventNames),
    workflow: z.literal("LIVE_SCORING"),
    result: z.enum(["SUCCEEDED", "BASEBALL_RULE_REJECTED", "WORKFLOW_FAILED"]),
    eventFamily: z.enum(scoringEventFamilies),
    durationBucket: z.enum(["UNDER_250_MS", "UNDER_1_S", "UNDER_5_S", "SLOW"]),
    failureCategory: z
      .enum(["BASEBALL_RULES", "INPUT", "CONCURRENCY", "SERVICE"])
      .nullable(),
  })
  .strict();

export type ProductAnalyticsEvent = z.infer<typeof productAnalyticsEventSchema>;

export type ProductAnalyticsObservation = Readonly<
  ProductAnalyticsEvent & { occurredAt: string }
>;

export function scoringEventFamily(eventType: string) {
  if (eventType === "PlateAppearanceRecorded")
    return "PLATE_APPEARANCE" as const;
  if (eventType === "RunnerPlayRecorded") return "RUNNER_MOVEMENT" as const;
  if (
    eventType === "PitchingChangeMade" ||
    eventType === "DefensiveAlignmentChanged" ||
    eventType === "DefensiveSubstitutionMade"
  ) {
    return "LINEUP_OR_PITCHING" as const;
  }
  return "GAME_LIFECYCLE" as const;
}

export function analyticsDurationBucket(durationMs: number) {
  if (durationMs < 250) return "UNDER_250_MS" as const;
  if (durationMs < 1_000) return "UNDER_1_S" as const;
  if (durationMs < 5_000) return "UNDER_5_S" as const;
  return "SLOW" as const;
}

const baseballRuleCodes = new Set([
  "SETUP_NOT_READY",
  "INVALID_LIFECYCLE_TRANSITION",
  "INVALID_BASEBALL_TRANSITION",
  "INVALID_LINEUP",
  "INVALID_RUNNER_MOVEMENT",
  "INVALID_PITCHER",
]);
const concurrencyCodes = new Set([
  "STALE_SOURCE_REVISION",
  "SEQUENCE_CONFLICT",
  "DUPLICATE_IDEMPOTENCY_KEY",
  "DUPLICATE_ACCEPTED_EVENT",
  "PERSISTENCE_CONFLICT",
]);
const inputCodes = new Set([
  "INVALID_PAYLOAD",
  "UNSUPPORTED_EVENT_TYPE",
  "UNSUPPORTED_SCHEMA_VERSION",
  "GAME_MISMATCH",
  "ACCOUNT_MISMATCH",
]);

export function classifyScoringAnalyticsError(error: unknown): Readonly<{
  name: "scoring.baseball_rule_rejected" | "scoring.workflow_failed";
  result: "BASEBALL_RULE_REJECTED" | "WORKFLOW_FAILED";
  failureCategory: "BASEBALL_RULES" | "INPUT" | "CONCURRENCY" | "SERVICE";
}> {
  if (error instanceof GameEventError && baseballRuleCodes.has(error.code)) {
    return {
      name: "scoring.baseball_rule_rejected",
      result: "BASEBALL_RULE_REJECTED",
      failureCategory: "BASEBALL_RULES",
    };
  }
  if (error instanceof GameEventError && concurrencyCodes.has(error.code)) {
    return {
      name: "scoring.workflow_failed",
      result: "WORKFLOW_FAILED",
      failureCategory: "CONCURRENCY",
    };
  }
  if (error instanceof GameEventError && inputCodes.has(error.code)) {
    return {
      name: "scoring.workflow_failed",
      result: "WORKFLOW_FAILED",
      failureCategory: "INPUT",
    };
  }
  return {
    name: "scoring.workflow_failed",
    result: "WORKFLOW_FAILED",
    failureCategory: "SERVICE",
  };
}

export function parseProductAnalyticsEvent(input: unknown) {
  return productAnalyticsEventSchema.parse(input);
}
