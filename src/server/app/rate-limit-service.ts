import { z } from "zod";

import {
  RATE_LIMIT_IDEMPOTENCY_TTL_SECONDS,
  RATE_LIMIT_POLICY_VERSION,
  RateLimitError,
  RateLimitOverrideError,
  loadRateLimitPolicies,
  rateLimitClasses,
  rateLimitFingerprint,
  type RateLimitClass,
  type RateLimitPolicy,
} from "@/domain/rate-limits";
import { getApplicationConfigurationService } from "@/server/app/application-configuration-service";
import { AuthorizationError } from "@/server/auth/errors";
import {
  requireTrustedActor,
  type TrustedActorContext,
} from "@/server/auth/types";
import {
  PrismaRateLimitRepository,
  type RateLimitDecision,
} from "@/server/data/rate-limit-repository";
import { getPrismaClient } from "@/server/data/prisma";
import {
  emitOperationalEvent,
  getOperationalEventSink,
  type OperationalEventSink,
} from "@/server/observability/operational-events";

const consumeSchema = z
  .object({
    accountId: z.string().trim().min(1).max(128),
    endpointClass: z.enum(rateLimitClasses),
    cost: z.int().positive().max(100).default(1),
    operationKey: z.string().trim().min(1).max(128).optional(),
    fingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .optional(),
  })
  .strict()
  .refine(
    (input) =>
      (input.operationKey === undefined) === (input.fingerprint === undefined),
    { message: "Retry identity and fingerprint must be supplied together." },
  );

const overrideSchema = z
  .object({
    accountId: z.string().trim().min(1).max(128),
    endpointClass: z.enum(rateLimitClasses),
    actorKind: z.enum(["USER", "SERVICE"]).nullable(),
    actorId: z.string().trim().min(1).max(128).nullable(),
    actorLimit: z.int().positive().max(1_000_000),
    accountLimit: z.int().positive().max(10_000_000),
    reasonCode: z
      .string()
      .trim()
      .regex(/^[A-Z][A-Z0-9_]{2,63}$/u),
    expiresAt: z.iso.datetime(),
  })
  .strict()
  .refine((input) => input.accountLimit >= input.actorLimit, {
    message: "The Account limit must not be lower than the actor limit.",
  })
  .refine((input) => (input.actorKind === null) === (input.actorId === null), {
    message: "Actor kind and actor id must be supplied together.",
  });

const revokeSchema = z
  .object({
    accountId: z.string().trim().min(1).max(128),
    overrideId: z.string().trim().min(1).max(128),
    reasonCode: z
      .string()
      .trim()
      .regex(/^[A-Z][A-Z0-9_]{2,63}$/u),
  })
  .strict();

type RateLimitRepository = Pick<
  PrismaRateLimitRepository,
  "consume" | "grantOverride" | "revokeOverride"
>;

function policyIdentity(
  endpointClass: RateLimitClass,
  policy: RateLimitPolicy,
) {
  return `${RATE_LIMIT_POLICY_VERSION}-${rateLimitFingerprint(endpointClass, policy).slice(0, 12)}`;
}

export class RateLimitService {
  constructor(
    private readonly repository: RateLimitRepository,
    private readonly policies:
      | Readonly<Record<RateLimitClass, RateLimitPolicy>>
      | ((
          accountId: string,
        ) => Promise<
          Readonly<Record<RateLimitClass, RateLimitPolicy>>
        >) = loadRateLimitPolicies(),
    private readonly operationalEvents: OperationalEventSink = getOperationalEventSink(),
  ) {}

  private configuredPolicies(accountId: string) {
    return typeof this.policies === "function"
      ? this.policies(accountId)
      : Promise.resolve(this.policies);
  }

  async enforce(
    input: unknown,
    actorInput: TrustedActorContext,
  ): Promise<RateLimitDecision> {
    const parsed = consumeSchema.parse(input);
    const actor = requireTrustedActor(
      actorInput,
      parsed.accountId,
      actorInput.capability,
    );
    const policies = await this.configuredPolicies(parsed.accountId);
    const policy = policies[parsed.endpointClass];
    const decision = await this.repository.consume({
      accountId: parsed.accountId,
      endpointClass: parsed.endpointClass,
      cost: parsed.cost,
      ...(parsed.operationKey
        ? {
            operationKey: parsed.operationKey,
            fingerprint: parsed.fingerprint!,
          }
        : {}),
      actorKind: actor.actorKind,
      actorId: actor.actorId,
      capability: actor.capability,
      policy,
      policyVersion: policyIdentity(parsed.endpointClass, policy),
      idempotencyTtlSeconds: RATE_LIMIT_IDEMPOTENCY_TTL_SECONDS,
    });
    emitOperationalEvent(this.operationalEvents, {
      severity: decision.allowed ? "info" : "warning",
      category: "authorization",
      name: "rate_limit_decision",
      outcome: decision.allowed ? "succeeded" : "rejected",
      accountId: parsed.accountId,
      capability: actor.capability,
      ...(decision.conflict ? { code: "IDEMPOTENCY_CONFLICT" } : {}),
      metadata: {
        endpointClass: parsed.endpointClass,
        cost: parsed.cost,
        constrainedBy: decision.constrainedBy,
        idempotentRetry: decision.idempotentRetry,
        overrideApplied: decision.overrideId !== null,
      },
    });
    if (!decision.allowed) {
      throw new RateLimitError({
        code: decision.conflict ? "IDEMPOTENCY_CONFLICT" : "RATE_LIMITED",
        retryAfterSeconds: decision.retryAfterSeconds,
        limit: decision.limit,
        remaining: decision.remaining,
        resetAt: decision.resetAt,
      });
    }
    return decision;
  }

  async grantOverride(input: unknown, actorInput: TrustedActorContext) {
    const parsed = overrideSchema.parse(input);
    const actor = requireTrustedActor(
      actorInput,
      parsed.accountId,
      "account.manage",
    );
    if (actor.target.kind !== "ACCOUNT") {
      throw new AuthorizationError("AUTHORIZATION_REQUIRED");
    }
    const policy = (await this.configuredPolicies(parsed.accountId))[
      parsed.endpointClass
    ];
    if (
      parsed.actorLimit > policy.actorLimit * 10 ||
      parsed.accountLimit > policy.accountLimit * 10
    ) {
      throw new RateLimitOverrideError(
        400,
        "An emergency override exceeds the bounded policy.",
      );
    }
    const expiresAt = new Date(parsed.expiresAt);
    if (
      expiresAt <= new Date() ||
      expiresAt.getTime() - Date.now() > 24 * 60 * 60 * 1_000
    ) {
      throw new RateLimitOverrideError(
        400,
        "An emergency override must expire within 24 hours.",
      );
    }
    const override = await this.repository.grantOverride({
      ...parsed,
      expiresAt,
      grantedBy: actor,
    });
    if (!override) {
      throw new RateLimitOverrideError(
        409,
        "The rate-limit override is unavailable.",
      );
    }
    return override;
  }

  async revokeOverride(input: unknown, actorInput: TrustedActorContext) {
    const parsed = revokeSchema.parse(input);
    const actor = requireTrustedActor(
      actorInput,
      parsed.accountId,
      "account.manage",
    );
    if (actor.target.kind !== "ACCOUNT") {
      throw new AuthorizationError("AUTHORIZATION_REQUIRED");
    }
    const override = await this.repository.revokeOverride({
      ...parsed,
      revokedBy: actor,
    });
    if (!override) {
      throw new RateLimitOverrideError(
        409,
        "The rate-limit override is unavailable.",
      );
    }
    return override;
  }
}

export type RateLimitEnforcer = Pick<RateLimitService, "enforce">;

export const noRateLimit: RateLimitEnforcer = Object.freeze({
  enforce: async () => ({
    allowed: true,
    idempotentRetry: false,
    conflict: false,
    limit: Number.MAX_SAFE_INTEGER,
    remaining: Number.MAX_SAFE_INTEGER,
    resetAt: new Date(0),
    retryAfterSeconds: 0,
    constrainedBy: "ACTOR" as const,
    overrideId: null,
  }),
});

let defaultService: RateLimitService | undefined;

export function getRateLimitService(): RateLimitService {
  defaultService ??= new RateLimitService(
    new PrismaRateLimitRepository(getPrismaClient()),
    async (accountId) =>
      (await getApplicationConfigurationService().runtime(accountId)).values
        .rateLimits,
  );
  return defaultService;
}
