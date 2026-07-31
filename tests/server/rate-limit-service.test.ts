import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_RATE_LIMIT_POLICIES,
  RateLimitError,
  loadRateLimitPolicies,
  rateLimitFingerprint,
  rateLimitHeaders,
  rateLimitStatus,
} from "@/domain/rate-limits";
import { RateLimitService } from "@/server/app/rate-limit-service";
import { trustedActorForTest } from "../fixtures/trusted-actor";

const actor = trustedActorForTest({
  accountId: "account-a",
  actorId: "user-a",
  actorKind: "USER",
  actorUserId: "user-a",
  membershipId: "membership-a",
  capability: "game.score",
  scope: { kind: "GAME", gameId: "game-a" },
  authorizedAt: "2026-07-31T14:00:00.000Z",
});

function repository(decision: {
  allowed: boolean;
  idempotentRetry?: boolean;
  conflict?: boolean;
}) {
  return {
    consume: vi.fn().mockResolvedValue({
      allowed: decision.allowed,
      idempotentRetry: decision.idempotentRetry ?? false,
      conflict: decision.conflict ?? false,
      limit: 2,
      remaining: decision.allowed ? 1 : 0,
      resetAt: new Date("2026-07-31T14:01:00.000Z"),
      retryAfterSeconds: decision.allowed ? 0 : 30,
      constrainedBy: "ACTOR" as const,
      overrideId: null,
    }),
    grantOverride: vi.fn(),
    revokeOverride: vi.fn(),
  };
}

describe("rate-limit service", () => {
  it("uses typed Account and actor policies without exposing retry material", async () => {
    const store = repository({ allowed: true });
    const events = { emit: vi.fn() };
    const policies = {
      ...DEFAULT_RATE_LIMIT_POLICIES,
      SCORING_MUTATION: {
        actorLimit: 2,
        accountLimit: 4,
        windowSeconds: 60,
      },
    };
    const service = new RateLimitService(store, policies, events);
    const fingerprint = rateLimitFingerprint("event-a", { eventType: "Out" });

    await expect(
      service.enforce(
        {
          accountId: "account-a",
          endpointClass: "SCORING_MUTATION",
          operationKey: "submission-a",
          fingerprint,
        },
        actor,
      ),
    ).resolves.toMatchObject({ allowed: true });

    expect(store.consume).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "account-a",
        actorKind: "USER",
        actorId: "user-a",
        capability: "game.score",
        endpointClass: "SCORING_MUTATION",
        policy: policies.SCORING_MUTATION,
        operationKey: "submission-a",
        fingerprint,
      }),
    );
    expect(events.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "rate_limit_decision",
        metadata: expect.objectContaining({
          endpointClass: "SCORING_MUTATION",
        }),
      }),
    );
    expect(JSON.stringify(events.emit.mock.calls)).not.toContain(
      "submission-a",
    );
    expect(JSON.stringify(events.emit.mock.calls)).not.toContain(fingerprint);
  });

  it("returns consistent retry guidance for exhausted and conflicting retries", async () => {
    for (const conflict of [false, true]) {
      const service = new RateLimitService(
        repository({ allowed: false, conflict }),
      );
      let failure: unknown;
      try {
        await service.enforce(
          { accountId: "account-a", endpointClass: "SCORING_MUTATION" },
          actor,
        );
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(RateLimitError);
      expect(failure).toMatchObject({
        code: conflict ? "IDEMPOTENCY_CONFLICT" : "RATE_LIMITED",
        retryAfterSeconds: 30,
        remaining: 0,
      });
      const typedFailure = failure as RateLimitError;
      const headers = rateLimitHeaders(typedFailure);
      expect(rateLimitStatus(typedFailure)).toBe(conflict ? 409 : 429);
      if (conflict) {
        expect(headers).toEqual({ "Cache-Control": "no-store" });
      } else {
        expect(headers).toMatchObject({
          "RateLimit-Limit": "2",
          "RateLimit-Remaining": "0",
          "Retry-After": "30",
        });
      }
    }
  });

  it("fails closed on malformed deployment policy configuration", () => {
    expect(() => loadRateLimitPolicies("not-json")).toThrow(
      "must be valid JSON",
    );
    expect(() =>
      loadRateLimitPolicies(
        JSON.stringify({
          EXPORT: { actorLimit: 10, accountLimit: 2, windowSeconds: 60 },
        }),
      ),
    ).toThrow();
    expect(
      loadRateLimitPolicies(
        JSON.stringify({
          EXPORT: { actorLimit: 4, accountLimit: 20, windowSeconds: 900 },
        }),
      ).EXPORT,
    ).toEqual({ actorLimit: 4, accountLimit: 20, windowSeconds: 900 });
  });

  it("bounds emergency overrides and requires exact Account administration", async () => {
    const store = repository({ allowed: true });
    const service = new RateLimitService(store);
    const administrator = trustedActorForTest({
      accountId: "account-a",
      actorId: "admin-a",
      actorKind: "USER",
      actorUserId: "admin-a",
      membershipId: "membership-admin-a",
      capability: "account.manage",
      scope: { kind: "ACCOUNT" },
      authorizedAt: new Date().toISOString(),
    });
    await expect(
      service.grantOverride(
        {
          accountId: "account-a",
          endpointClass: "EXPORT",
          actorKind: null,
          actorId: null,
          actorLimit: DEFAULT_RATE_LIMIT_POLICIES.EXPORT.actorLimit * 11,
          accountLimit: DEFAULT_RATE_LIMIT_POLICIES.EXPORT.accountLimit * 11,
          reasonCode: "INCIDENT_LIMIT",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
        administrator,
      ),
    ).rejects.toThrow("exceeds the bounded policy");
    expect(store.grantOverride).not.toHaveBeenCalled();
  });
});
