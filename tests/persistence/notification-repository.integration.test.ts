import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaNotificationRepository } from "@/server/data/notification-repository";
import { enqueueWebhookEvent } from "@/server/data/webhook-repository";
import { trustedActorForTest } from "../fixtures/trusted-actor";

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const prefix = `issue99-${process.pid}-${Date.now()}`;
const GAME = "00000000-0000-4000-8000-000000000501";
const SEASON = "00000000-0000-4000-8000-000000000502";

integration("outbound notification persistence", () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl! }),
  });
  const repository = new PrismaNotificationRepository(prisma);
  const accountA = `${prefix}-account-a`;
  const accountB = `${prefix}-account-b`;
  const userA = `${prefix}-user-a`;
  const userB = `${prefix}-user-b`;
  const membershipA = `${prefix}-membership-a`;
  const membershipB = `${prefix}-membership-b`;
  const teamA = `${prefix}-team-a`;
  const teamB = `${prefix}-team-b`;
  let teamAExternal = "";

  const serviceActor = (accountId: string) =>
    trustedActorForTest({
      accountId,
      actorId: `${accountId}-service`,
      actorKind: "SERVICE",
      actorUserId: null,
      membershipId: null,
      capability: "account.manage",
      scope: { kind: "ACCOUNT" },
      authorizedAt: new Date().toISOString(),
    });

  beforeAll(async () => {
    await prisma.account.createMany({
      data: [
        { id: accountA, slug: `${prefix}-a`, displayName: "Notification A" },
        { id: accountB, slug: `${prefix}-b`, displayName: "Notification B" },
      ],
    });
    await prisma.appUser.createMany({
      data: [
        { id: userA, provider: "test", providerSubject: `${prefix}-a` },
        { id: userB, provider: "test", providerSubject: `${prefix}-b` },
      ],
    });
    await prisma.accountMembership.createMany({
      data: [
        {
          id: membershipA,
          accountId: accountA,
          userId: userA,
          status: "ACTIVE",
          activatedAt: new Date(),
        },
        {
          id: membershipB,
          accountId: accountB,
          userId: userB,
          status: "ACTIVE",
          activatedAt: new Date(),
        },
      ],
    });
    const teams = await Promise.all([
      prisma.team.create({
        data: { id: teamA, accountId: accountA, displayName: "Team A" },
      }),
      prisma.team.create({
        data: { id: teamB, accountId: accountB, displayName: "Team B" },
      }),
    ]);
    teamAExternal = teams[0]!.externalId;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("fans one versioned event out to exact Account and team recipients", async () => {
    const configured = await Promise.all([
      repository.configurePreference({
        accountId: accountA,
        membershipId: membershipA,
        teamId: null,
        channel: "EMAIL",
        destinationReference: "notifications/email/coach",
        subscribedEvents: ["GAME_VERIFIED", "GAME_CORRECTED"],
        sensitiveContent: false,
        actor: serviceActor(accountA),
      }),
      repository.configurePreference({
        accountId: accountA,
        membershipId: membershipA,
        teamId: teamA,
        channel: "DISCORD",
        destinationReference: "notifications/discord/team",
        subscribedEvents: ["GAME_VERIFIED", "GAME_CORRECTED"],
        sensitiveContent: false,
        actor: serviceActor(accountA),
      }),
      repository.configurePreference({
        accountId: accountB,
        membershipId: membershipB,
        teamId: teamB,
        channel: "EMAIL",
        destinationReference: "notifications/email/other",
        subscribedEvents: ["GAME_VERIFIED"],
        sensitiveContent: false,
        actor: serviceActor(accountB),
      }),
    ]);
    expect(configured.every((result) => result?.outcome === "configured")).toBe(
      true,
    );
    await expect(
      repository.configurePreference({
        accountId: accountA,
        membershipId: membershipA,
        teamId: teamB,
        channel: "EMAIL",
        destinationReference: "notifications/email/cross-account",
        subscribedEvents: ["GAME_VERIFIED"],
        sensitiveContent: false,
        actor: serviceActor(accountA),
      }),
    ).resolves.toBeNull();

    const occurredAt = new Date();
    const input = {
      accountId: accountA,
      eventName: "GAME_VERIFIED" as const,
      deduplicationKey: `${prefix}-game-verified-1`,
      payload: {
        gameId: GAME,
        seasonId: SEASON,
        teamId: teamAExternal,
        sourceRevision: 8,
        verificationState: "VERIFIED",
      },
      occurredAt,
    };
    await prisma.$transaction((tx) => enqueueWebhookEvent(tx, input));
    await prisma.$transaction((tx) => enqueueWebhookEvent(tx, input));

    const deliveries = await prisma.notificationDelivery.findMany({
      where: { accountId: accountA },
      include: { event: true },
      orderBy: { channel: "asc" },
    });
    expect(deliveries).toHaveLength(2);
    expect(new Set(deliveries.map(({ channel }) => channel))).toEqual(
      new Set(["EMAIL", "DISCORD"]),
    );
    expect(new Set(deliveries.map(({ event }) => event.externalId))).toEqual(
      new Set([deliveries[0]!.event.externalId]),
    );
    expect(
      await prisma.notificationDelivery.count({
        where: { accountId: accountB },
      }),
    ).toBe(0);
    expect(
      JSON.stringify(deliveries, (_key, value) =>
        typeof value === "bigint" ? value.toString() : value,
      ),
    ).not.toContain("coach@example");
  });

  it("leases in source order, retries safely, and cancels on opt-out", async () => {
    const schedule = await prisma.notificationDelivery.aggregate({
      where: { accountId: accountA },
      _max: { nextAttemptAt: true },
    });
    const claimAt = new Date(schedule._max.nextAttemptAt!.getTime() + 1);
    const claimed = await repository.claimDue("worker-issue99", claimAt, 10);
    expect(claimed).toHaveLength(2);

    await repository.completeAttempt({
      accountId: accountA,
      deliveryId: claimed[0]!.id,
      workerId: "worker-issue99",
      startedAt: claimAt,
      completedAt: new Date(claimAt.getTime() + 100),
      durationMs: 100,
      responseStatus: 202,
      failureCode: null,
      succeeded: true,
      terminal: false,
    });
    await repository.completeAttempt({
      accountId: accountA,
      deliveryId: claimed[1]!.id,
      workerId: "worker-issue99",
      startedAt: claimAt,
      completedAt: new Date(claimAt.getTime() + 100),
      durationMs: 100,
      responseStatus: 429,
      failureCode: "RATE_LIMITED",
      succeeded: false,
      terminal: false,
    });

    const optOutActor = trustedActorForTest({
      accountId: accountA,
      actorId: userA,
      actorKind: "USER",
      actorUserId: userA,
      membershipId: membershipA,
      capability: "account.view",
      scope: { kind: "ACCOUNT" },
      authorizedAt: new Date().toISOString(),
    });
    await expect(
      repository.optOut({
        accountId: accountA,
        membershipId: membershipA,
        actor: optOutActor,
        optedOutAt: new Date(claimAt.getTime() + 200),
      }),
    ).resolves.toBe(2);
    expect(
      await prisma.notificationDelivery.count({
        where: { accountId: accountA, status: "PENDING" },
      }),
    ).toBe(0);
    expect(
      await repository.claimDue(
        "worker-issue99-next",
        new Date(claimAt.getTime() + 86_400_000),
        10,
      ),
    ).toHaveLength(0);
    await expect(
      repository.configurePreference({
        accountId: accountA,
        membershipId: membershipA,
        teamId: teamA,
        channel: "EMAIL",
        destinationReference: "notifications/email/new-team-rule",
        subscribedEvents: ["GAME_COMPLETED"],
        sensitiveContent: false,
        actor: serviceActor(accountA),
      }),
    ).resolves.toMatchObject({ outcome: "opted_out" });
    const audit = await prisma.securityAuditRecord.findFirstOrThrow({
      where: {
        accountId: accountA,
        action: "notification.preference.opt_out",
      },
    });
    expect(JSON.stringify(audit)).not.toMatch(/coach@example|123456789/iu);
  });
});
