export type StatisticErrorCode =
  | "UNSUPPORTED_EVENT_TYPE"
  | "UNSUPPORTED_EVENT_VERSION"
  | "UNSUPPORTED_RULESET"
  | "INCOMPLETE_REPLAY_STATE"
  | "MISSING_ATTRIBUTION"
  | "IMPOSSIBLE_COUNTER_STATE"
  | "RECONCILIATION_FAILURE"
  | "ACCOUNT_MISMATCH"
  | "STALE_PROJECTION_WRITE"
  | "INVALID_CORRECTION_GRAPH"
  | "INTERNAL_INVARIANT_FAILURE";

export class StatisticDerivationError extends Error {
  constructor(
    readonly code: StatisticErrorCode,
    message: string,
    readonly context: Readonly<Record<string, string | number>> = {},
  ) {
    super(message);
    this.name = "StatisticDerivationError";
  }
}

export type ExactRate = Readonly<{
  numerator: number;
  denominator: number;
}>;

function assertSafeNonnegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new StatisticDerivationError(
      "IMPOSSIBLE_COUNTER_STATE",
      `${label} must be a nonnegative safe integer.`,
      { value },
    );
  }
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = left;
  let b = right;
  while (b !== 0) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a;
}

export function exactRate(
  numerator: number,
  denominator: number,
): ExactRate | null {
  assertSafeNonnegativeInteger(numerator, "Rate numerator");
  assertSafeNonnegativeInteger(denominator, "Rate denominator");
  if (denominator === 0) return null;
  const divisor = greatestCommonDivisor(numerator, denominator);
  return {
    numerator: numerator / divisor,
    denominator: denominator / divisor,
  };
}

export function addExactRates(
  left: ExactRate | null,
  right: ExactRate | null,
): ExactRate | null {
  if (left === null || right === null) return null;
  const numerator =
    left.numerator * right.denominator + right.numerator * left.denominator;
  const denominator = left.denominator * right.denominator;
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)) {
    throw new StatisticDerivationError(
      "IMPOSSIBLE_COUNTER_STATE",
      "Exact rate exceeds safe integer arithmetic.",
    );
  }
  return exactRate(numerator, denominator);
}

export function formatExactRate(
  rate: ExactRate | null,
  options: {
    precision?: number;
    omitLeadingZero?: boolean;
  } = {},
): string | null {
  if (rate === null) return null;
  const precision = options.precision ?? 3;
  if (!Number.isSafeInteger(precision) || precision < 0 || precision > 6) {
    throw new StatisticDerivationError(
      "INTERNAL_INVARIANT_FAILURE",
      "Rate precision must be an integer from zero through six.",
    );
  }
  const scale = 10 ** precision;
  const scaleInteger = BigInt(scale);
  const denominator = BigInt(rate.denominator);
  const scaledNumerator = BigInt(rate.numerator) * scaleInteger;
  const rounded = (scaledNumerator * 2n + denominator) / (denominator * 2n);
  const whole = rounded / scaleInteger;
  const fraction = String(rounded % scaleInteger).padStart(precision, "0");
  const rendered =
    precision === 0 ? String(whole) : `${String(whole)}.${fraction}`;
  if (
    options.omitLeadingZero === true &&
    whole === 0n &&
    rendered.startsWith("0.")
  ) {
    return rendered.slice(1);
  }
  return rendered;
}

export function formatInningsPitched(outsRecorded: number): string {
  assertSafeNonnegativeInteger(outsRecorded, "Pitching outs");
  return `${Math.floor(outsRecorded / 3)}.${outsRecorded % 3}`;
}
