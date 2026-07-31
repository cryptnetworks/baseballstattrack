import { createHash } from "node:crypto";

import { z } from "zod";

export const rateLimitClasses = [
  "AUTHENTICATION",
  "ACCOUNT_SELECTION",
  "SCORING_MUTATION",
  "CORRECTION_VERIFICATION",
  "REPORT_READ",
  "REPORT_GENERATION",
  "EXPORT",
  "ADMINISTRATION",
  "API_READ",
  "WEBHOOK_ADMINISTRATION",
  "INTEGRATION_CONSUMER",
] as const;

export type RateLimitClass = (typeof rateLimitClasses)[number];

export type RateLimitPolicy = Readonly<{
  actorLimit: number;
  accountLimit: number;
  windowSeconds: number;
}>;

const policySchema = z
  .object({
    actorLimit: z.int().positive().max(1_000_000),
    accountLimit: z.int().positive().max(10_000_000),
    windowSeconds: z.int().positive().max(86_400),
  })
  .strict()
  .refine((value) => value.accountLimit >= value.actorLimit, {
    message: "The Account limit must not be lower than the actor limit.",
  });

const overrideSchema = z.partialRecord(z.enum(rateLimitClasses), policySchema);

export const DEFAULT_RATE_LIMIT_POLICIES: Readonly<
  Record<RateLimitClass, RateLimitPolicy>
> = Object.freeze({
  AUTHENTICATION: { actorLimit: 30, accountLimit: 300, windowSeconds: 60 },
  ACCOUNT_SELECTION: {
    actorLimit: 120,
    accountLimit: 1_200,
    windowSeconds: 60,
  },
  SCORING_MUTATION: {
    actorLimit: 600,
    accountLimit: 5_000,
    windowSeconds: 60,
  },
  CORRECTION_VERIFICATION: {
    actorLimit: 60,
    accountLimit: 500,
    windowSeconds: 60,
  },
  REPORT_READ: { actorLimit: 240, accountLimit: 1_500, windowSeconds: 60 },
  REPORT_GENERATION: {
    actorLimit: 40,
    accountLimit: 200,
    windowSeconds: 3_600,
  },
  EXPORT: { actorLimit: 10, accountLimit: 50, windowSeconds: 3_600 },
  ADMINISTRATION: {
    actorLimit: 60,
    accountLimit: 300,
    windowSeconds: 3_600,
  },
  API_READ: { actorLimit: 300, accountLimit: 2_000, windowSeconds: 60 },
  WEBHOOK_ADMINISTRATION: {
    actorLimit: 30,
    accountLimit: 200,
    windowSeconds: 3_600,
  },
  INTEGRATION_CONSUMER: {
    actorLimit: 600,
    accountLimit: 5_000,
    windowSeconds: 60,
  },
});

export const RATE_LIMIT_POLICY_VERSION = "m4-v1";
export const RATE_LIMIT_IDEMPOTENCY_TTL_SECONDS = 86_400;

export function loadRateLimitPolicies(
  encoded = process.env.RATE_LIMIT_POLICIES_JSON,
): Readonly<Record<RateLimitClass, RateLimitPolicy>> {
  if (!encoded?.trim()) return DEFAULT_RATE_LIMIT_POLICIES;
  let parsed: unknown;
  try {
    parsed = JSON.parse(encoded);
  } catch {
    throw new Error("RATE_LIMIT_POLICIES_JSON must be valid JSON.");
  }
  const overrides = overrideSchema.parse(parsed);
  return Object.freeze({ ...DEFAULT_RATE_LIMIT_POLICIES, ...overrides });
}

export function rateLimitFingerprint(...parts: readonly unknown[]): string {
  return createHash("sha256")
    .update(JSON.stringify(parts), "utf8")
    .digest("hex");
}

export class RateLimitError extends Error {
  readonly code: "RATE_LIMITED" | "IDEMPOTENCY_CONFLICT";
  readonly retryAfterSeconds: number;
  readonly limit: number;
  readonly remaining: number;
  readonly resetAt: Date;

  constructor(input: {
    code: "RATE_LIMITED" | "IDEMPOTENCY_CONFLICT";
    retryAfterSeconds: number;
    limit: number;
    remaining: number;
    resetAt: Date;
  }) {
    super(
      input.code === "RATE_LIMITED"
        ? "The request quota is temporarily exhausted."
        : "The retry identity was already used for different input.",
    );
    this.name = "RateLimitError";
    this.code = input.code;
    this.retryAfterSeconds = input.retryAfterSeconds;
    this.limit = input.limit;
    this.remaining = input.remaining;
    this.resetAt = input.resetAt;
  }
}

export class RateLimitOverrideError extends Error {
  readonly status: 400 | 409;

  constructor(status: 400 | 409, message: string) {
    super(message);
    this.name = "RateLimitOverrideError";
    this.status = status;
  }
}

export function rateLimitHeaders(error: RateLimitError): HeadersInit {
  if (error.code === "IDEMPOTENCY_CONFLICT") {
    return { "Cache-Control": "no-store" };
  }
  return {
    "Cache-Control": "no-store",
    "RateLimit-Limit": String(error.limit),
    "RateLimit-Remaining": String(error.remaining),
    "RateLimit-Reset": String(Math.ceil(error.resetAt.getTime() / 1_000)),
    "Retry-After": String(error.retryAfterSeconds),
  };
}

export function rateLimitStatus(error: RateLimitError): 409 | 429 {
  return error.code === "IDEMPOTENCY_CONFLICT" ? 409 : 429;
}

export function safeRateLimitMessage(error: RateLimitError): string {
  return error.code === "IDEMPOTENCY_CONFLICT"
    ? "The retry identity was already used for different input."
    : "The request quota is temporarily exhausted.";
}
