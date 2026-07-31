import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { rateLimitFingerprint } from "@/domain/rate-limits";
import { RateLimitService } from "@/server/app/rate-limit-service";
import { PrismaRateLimitRepository } from "@/server/data/rate-limit-repository";
import { trustedActorForTest } from "../fixtures/trusted-actor";

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const prefix = `issue90-${process.pid}-${Date.now()}`;

integration("distributed rate-limit persistence boundary", () => {
  const firstClient = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl! }),
  });
  const secondClient = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl! }),
  });
  const first = new PrismaRateLimitRepository(firstClient);
  const second = new PrismaRateLimitRepository(secondClient);
  const accountA = `${prefix}-account-a`;
  const accountB = `${prefix}-account-b`;
  const adminUser = `${prefix}-admin`;
  const base = {
    endpointClass: "SCORING_MUTATION" as const,
    capability: "game.score",
    policyVersion: `${prefix}-policy`,
    cost: 1,
    idempotencyTtlSeconds: 86_400,
  };

  beforeAll(async () => {
    await firstClient.account.createMany({
      data: [
        { id: accountA, slug: `${prefix}-a`, displayName: "Issue 90 A" },
        { id: accountB, slug: `${prefix}-b`, displayName: "Issue 90 B" },
      ],
    });
    await firstClient.appUser.create({
      data: {
        id: adminUser,
        provider: "supabase",
        providerSubject: `${prefix}-admin-subject`,
      },
    });
  });

  afterAll(async () => {
    await Promise.all([firstClient.$disconnect(), secondClient.$disconnect()]);
  });

  it("charges once for an exact retry and rejects changed input", async () => {
    const request = {
      ...base,
      accountId: accountA,
      actorKind: "SERVICE" as const,
      actorId: `${prefix}-retry-actor`,
      policyVersion: `${prefix}-retry-policy`,
      policy: { actorLimit: 2, accountLimit: 4, windowSeconds: 60 },
      operationKey: "operation-a",
      fingerprint: rateLimitFingerprint("exact"),
    };
    expect(await first.consume(request)).toMatchObject({
      allowed: true,
      idempotentRetry: false,
    });
    expect(await second.consume(request)).toMatchObject({
      allowed: true,
      idempotentRetry: true,
    });
    expect(
      await second.consume({
        ...request,
        fingerprint: rateLimitFingerprint("changed"),
      }),
    ).toMatchObject({ allowed: false, conflict: true });

    const counters = await firstClient.rateLimitCounter.findMany({
      where: {
        accountId: accountA,
        policyVersion: request.policyVersion,
      },
    });
    expect(counters).toHaveLength(2);
    expect(counters.map(({ used }) => used)).toEqual([1, 1]);
  });

  it("shares limits across instances while preserving Account independence", async () => {
    const policyVersion = `${prefix}-distributed-policy`;
    const policy = { actorLimit: 5, accountLimit: 20, windowSeconds: 60 };
    const attempts = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        (index % 2 === 0 ? first : second).consume({
          ...base,
          accountId: accountA,
          actorKind: "SERVICE",
          actorId: `${prefix}-distributed-actor`,
          policyVersion,
          policy,
          operationKey: `distributed-${index}`,
          fingerprint: rateLimitFingerprint(index),
        }),
      ),
    );
    expect(attempts.filter(({ allowed }) => allowed)).toHaveLength(5);
    expect(attempts.filter(({ allowed }) => !allowed)).toHaveLength(5);

    await expect(
      second.consume({
        ...base,
        accountId: accountB,
        actorKind: "SERVICE",
        actorId: `${prefix}-distributed-actor`,
        policyVersion,
        policy,
      }),
    ).resolves.toMatchObject({ allowed: true });
  });

  it("enforces an Account ceiling across otherwise healthy actors", async () => {
    const policyVersion = `${prefix}-account-policy`;
    const results = [];
    for (const actorId of [`${prefix}-one`, `${prefix}-two`]) {
      for (let index = 0; index < 3; index += 1) {
        results.push(
          await first.consume({
            ...base,
            accountId: accountA,
            actorKind: "SERVICE",
            actorId,
            policyVersion,
            policy: { actorLimit: 3, accountLimit: 4, windowSeconds: 60 },
          }),
        );
      }
    }
    expect(results.filter(({ allowed }) => allowed)).toHaveLength(4);
    expect(results.at(-1)).toMatchObject({
      allowed: false,
      constrainedBy: "ACCOUNT",
    });
  });

  it("keeps actor counters distinct by authorized capability", async () => {
    const input = {
      ...base,
      accountId: accountB,
      actorKind: "SERVICE" as const,
      actorId: `${prefix}-multi-capability-service`,
      policyVersion: `${prefix}-capability-policy`,
      policy: { actorLimit: 1, accountLimit: 10, windowSeconds: 60 },
    };
    expect(await first.consume(input)).toMatchObject({ allowed: true });
    expect(await first.consume(input)).toMatchObject({ allowed: false });
    expect(
      await first.consume({ ...input, capability: "game.start" }),
    ).toMatchObject({ allowed: true });
  });

  it("does not let a noisy Account consume another Account's capacity", async () => {
    const policy = { actorLimit: 5, accountLimit: 10, windowSeconds: 60 };
    const noisy = Array.from({ length: 50 }, (_, index) =>
      first.consume({
        ...base,
        accountId: accountA,
        actorKind: "SERVICE",
        actorId: `${prefix}-noisy-actor`,
        policyVersion: `${prefix}-isolation-load-policy`,
        policy,
        operationKey: `noisy-${index}`,
        fingerprint: rateLimitFingerprint("noisy", index),
      }),
    );
    const healthy = Array.from({ length: 10 }, (_, index) =>
      second.consume({
        ...base,
        accountId: accountB,
        actorKind: "SERVICE",
        actorId: `${prefix}-healthy-${index}`,
        policyVersion: `${prefix}-isolation-load-policy`,
        policy,
        operationKey: `healthy-${index}`,
        fingerprint: rateLimitFingerprint("healthy", index),
      }),
    );
    const [, healthyResults] = await Promise.all([
      Promise.all(noisy),
      Promise.all(healthy),
    ]);
    expect(healthyResults).toHaveLength(10);
    expect(healthyResults.every(({ allowed }) => allowed)).toBe(true);
  });

  it("applies, audits, expires, and revokes narrowly scoped overrides", async () => {
    const administrator = trustedActorForTest({
      accountId: accountA,
      actorId: adminUser,
      actorKind: "USER",
      actorUserId: adminUser,
      membershipId: `${prefix}-admin-membership`,
      capability: "account.manage",
      scope: { kind: "ACCOUNT" },
      authorizedAt: new Date().toISOString(),
    });
    const policies = {
      AUTHENTICATION: { actorLimit: 1, accountLimit: 10, windowSeconds: 60 },
      ACCOUNT_SELECTION: { actorLimit: 1, accountLimit: 10, windowSeconds: 60 },
      SCORING_MUTATION: { actorLimit: 1, accountLimit: 10, windowSeconds: 60 },
      CORRECTION_VERIFICATION: {
        actorLimit: 1,
        accountLimit: 10,
        windowSeconds: 60,
      },
      REPORT_READ: { actorLimit: 1, accountLimit: 10, windowSeconds: 60 },
      REPORT_GENERATION: { actorLimit: 1, accountLimit: 10, windowSeconds: 60 },
      EXPORT: { actorLimit: 1, accountLimit: 10, windowSeconds: 60 },
      ADMINISTRATION: { actorLimit: 1, accountLimit: 10, windowSeconds: 60 },
      API_READ: { actorLimit: 1, accountLimit: 10, windowSeconds: 60 },
      WEBHOOK_ADMINISTRATION: {
        actorLimit: 1,
        accountLimit: 10,
        windowSeconds: 60,
      },
      INTEGRATION_CONSUMER: {
        actorLimit: 1,
        accountLimit: 10,
        windowSeconds: 60,
      },
    } as const;
    const service = new RateLimitService(first, policies, { emit: () => {} });
    const targetActor = `${prefix}-override-service`;
    const override = await service.grantOverride(
      {
        accountId: accountA,
        endpointClass: "SCORING_MUTATION",
        actorKind: "SERVICE",
        actorId: targetActor,
        actorLimit: 3,
        accountLimit: 10,
        reasonCode: "INCIDENT_90",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
      administrator,
    );
    const consume = (actorId: string) =>
      first.consume({
        ...base,
        accountId: accountA,
        actorKind: "SERVICE",
        actorId,
        policyVersion: `${prefix}-override-policy`,
        policy: policies.SCORING_MUTATION,
      });
    expect(await consume(targetActor)).toMatchObject({
      allowed: true,
      overrideId: override.id,
    });
    expect(await consume(targetActor)).toMatchObject({ allowed: true });
    expect(await consume(`${prefix}-unscoped-service`)).toMatchObject({
      allowed: true,
      overrideId: null,
    });
    expect(await consume(`${prefix}-unscoped-service`)).toMatchObject({
      allowed: false,
    });

    await service.revokeOverride(
      {
        accountId: accountA,
        overrideId: override.id,
        reasonCode: "INCIDENT_RESOLVED",
      },
      administrator,
    );
    expect(await consume(targetActor)).toMatchObject({
      allowed: false,
      overrideId: null,
    });
    expect(
      await firstClient.securityAuditRecord.count({
        where: {
          accountId: accountA,
          targetId: override.id,
          action: { startsWith: "rate_limit.override." },
        },
      }),
    ).toBeGreaterThanOrEqual(4);
  });
});
