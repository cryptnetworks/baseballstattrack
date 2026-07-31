export type ReliabilitySloKey =
  | "availability"
  | "scoring_acceptance_latency"
  | "report_freshness"
  | "recovery";

export type ReliabilitySlo = Readonly<{
  key: ReliabilitySloKey;
  target: number;
  windowDays: 30;
  thresholdMs?: number;
}>;

export const RELIABILITY_SLOS: Readonly<
  Record<ReliabilitySloKey, ReliabilitySlo>
> = {
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
    thresholdMs: 5 * 60 * 1_000,
  },
  recovery: {
    key: "recovery",
    target: 0.99,
    windowDays: 30,
    thresholdMs: 60 * 60 * 1_000,
  },
};

export type ErrorBudgetState = "no_data" | "healthy" | "at_risk" | "exhausted";

export type ErrorBudgetEvaluation = Readonly<{
  eligible: number;
  good: number;
  bad: number;
  target: number;
  allowedBad: number;
  consumedRatio: number;
  remainingRatio: number;
  burnRate: number;
  state: ErrorBudgetState;
  pauseFeatureWork: boolean;
}>;

function validCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function evaluateErrorBudget(input: {
  eligible: number;
  good: number;
  target: number;
}): ErrorBudgetEvaluation {
  if (
    !validCount(input.eligible) ||
    !validCount(input.good) ||
    input.good > input.eligible
  ) {
    throw new RangeError(
      "SLO counts must be nonnegative integers with good <= eligible.",
    );
  }
  if (
    !Number.isFinite(input.target) ||
    input.target <= 0 ||
    input.target >= 1
  ) {
    throw new RangeError(
      "SLO target must be greater than zero and less than one.",
    );
  }

  const bad = input.eligible - input.good;
  const allowedBad = input.eligible * (1 - input.target);
  const consumedRatio = input.eligible === 0 ? 0 : bad / allowedBad;
  const remainingRatio = Math.max(0, 1 - consumedRatio);
  const burnRate =
    input.eligible === 0 ? 0 : bad / input.eligible / (1 - input.target);
  const state: ErrorBudgetState =
    input.eligible === 0
      ? "no_data"
      : bad + Number.EPSILON * input.eligible >= allowedBad
        ? "exhausted"
        : consumedRatio >= 0.5
          ? "at_risk"
          : "healthy";

  return {
    eligible: input.eligible,
    good: input.good,
    bad,
    target: input.target,
    allowedBad,
    consumedRatio,
    remainingRatio,
    burnRate,
    state,
    pauseFeatureWork: state === "exhausted",
  };
}
