import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  PrismaWebhookRepository,
  enqueueWebhookEvent,
} from "@/server/data/webhook-repository";
import { trustedActorForTest } from "../fixtures/trusted-actor";

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const prefix = `issue93-${process.pid}-${Date.now()}`;
const GAME = "00000000-0000-4000-8000-000000000031";
const SEASON = "00000000-0000-4000-8000-000000000032";
const TEAM = "00000000-0000-4000-8000-000000000033";
const scenarioStartedAt = new Date();

integration("durable webhook persistence", () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl! }),
  });
  const repository = new PrismaWebhookRepository(prisma);
  const accountA = `${prefix}-account-a`;
  const accountB = `${prefix}-account-b`;
  let firstEndpointId = "";
  let secondEndpointId = "";
  let firstEventExternalId = "";

  const serviceActor = (accountId: string) =>
    trustedActorForTest({
      accountId,
      actorId: `${accountId}-service`,
      actorKind: "SERVICE",
      actorUserId: null,
      membershipId: null,
      capability: "account.manage",
      scope: { kind: "ACCOUNT" },
      authorizedAt: scenarioStartedAt.toISOString(),
    });

  beforeAll(async () => {
    await prisma.account.createMany({
      data: [
        { id: accountA, slug: `${prefix}-a`, displayName: "Webhook A" },
        { id: accountB, slug: `${prefix}-b`, displayName: "Webhook B" },
      ],
    });
    const endpoints = await Promise.all(
      ["one", "two"].map((suffix) =>
        prisma.webhookEndpoint.create({
          data: {
            accountId: accountA,
            url: `https://${suffix}.example.test/webhook`,
            status: "ACTIVE",
            subscribedEvents: ["GAME_VERIFIED"],
            verifiedAt: scenarioStartedAt,
          },
        }),
      ),
    );
    firstEndpointId = endpoints[0]!.id;
    secondEndpointId = endpoints[1]!.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("fans out idempotently and enforces per-endpoint order across workers", async () => {
    const occurredAt = scenarioStartedAt;
    const eventInput = (revision: number) => ({
      accountId: accountA,
      eventName: "GAME_VERIFIED" as const,
      deduplicationKey: `verified-${revision}`,
      payload: {
        gameId: GAME,
        seasonId: SEASON,
        teamId: TEAM,
        sourceRevision: revision,
        verificationState: "VERIFIED",
      },
      occurredAt: new Date(occurredAt.getTime() + revision * 1_000),
    });
    const first = await prisma.$transaction((tx) =>
      enqueueWebhookEvent(tx, eventInput(1)),
    );
    firstEventExternalId = first.externalId;
    await prisma.$transaction((tx) => enqueueWebhookEvent(tx, eventInput(1)));
    await prisma.$transaction((tx) => enqueueWebhookEvent(tx, eventInput(2)));

    expect(
      await prisma.webhookEvent.count({ where: { accountId: accountA } }),
    ).toBe(2);
    expect(
      await prisma.webhookDelivery.count({ where: { accountId: accountA } }),
    ).toBe(4);

    const deliverySchedule = await prisma.webhookDelivery.aggregate({
      where: { accountId: accountA },
      _max: { nextAttemptAt: true },
    });
    const nextAttemptAt = deliverySchedule._max.nextAttemptAt;
    expect(nextAttemptAt).not.toBeNull();
    const claimAt = new Date(nextAttemptAt!.getTime() + 1);
    const firstAttemptCompletedAt = new Date(claimAt.getTime() + 1_000);
    const claimed = await repository.claimDue("worker-order-one", claimAt, 10);
    expect(claimed).toHaveLength(2);
    expect(new Set(claimed.map(({ endpointId }) => endpointId))).toEqual(
      new Set([firstEndpointId, secondEndpointId]),
    );
    expect(new Set(claimed.map(({ event }) => event.deduplicationKey))).toEqual(
      new Set(["verified-1"]),
    );

    const firstEndpointDelivery = claimed.find(
      ({ endpointId }) => endpointId === firstEndpointId,
    )!;
    const secondEndpointDelivery = claimed.find(
      ({ endpointId }) => endpointId === secondEndpointId,
    )!;
    await repository.completeAttempt({
      accountId: accountA,
      deliveryId: firstEndpointDelivery.id,
      workerId: "worker-order-one",
      startedAt: claimAt,
      completedAt: firstAttemptCompletedAt,
      durationMs: 1_000,
      responseStatus: 503,
      failureCode: "HTTP_503",
      succeeded: false,
      terminal: false,
    });
    await repository.completeAttempt({
      accountId: accountA,
      deliveryId: secondEndpointDelivery.id,
      workerId: "worker-order-one",
      startedAt: claimAt,
      completedAt: firstAttemptCompletedAt,
      durationMs: 1_000,
      responseStatus: 204,
      failureCode: null,
      succeeded: true,
      terminal: false,
    });

    const independent = await repository.claimDue(
      "worker-order-two",
      new Date(firstAttemptCompletedAt.getTime() + 1_000),
      10,
    );
    expect(independent).toHaveLength(1);
    expect(independent[0]).toMatchObject({ endpointId: secondEndpointId });
    expect(independent[0]!.event.deduplicationKey).toBe("verified-2");
  });

  it("authorizes retained replay by exact Account and pins the current secret", async () => {
    const wrongAccount = await repository.replayDelivery({
      accountId: accountB,
      endpointId: firstEndpointId,
      eventExternalId: firstEventExternalId,
      actor: serviceActor(accountB),
      requestedAt: new Date(scenarioStartedAt.getTime() + 86_400_000),
    });
    expect(wrongAccount).toBeNull();

    await prisma.webhookEndpoint.update({
      where: { id: firstEndpointId },
      data: { secretVersion: 2 },
    });
    const replay = await repository.replayDelivery({
      accountId: accountA,
      endpointId: firstEndpointId,
      eventExternalId: firstEventExternalId,
      actor: serviceActor(accountA),
      requestedAt: new Date(scenarioStartedAt.getTime() + 86_400_000),
    });
    expect(replay).toMatchObject({ replayNumber: 1, secretVersion: 2 });
  });

  it("revokes atomically and makes all pending work unclaimable", async () => {
    await expect(
      repository.revokeEndpoint({
        accountId: accountA,
        endpointId: firstEndpointId,
        actor: serviceActor(accountA),
        reasonCode: "CONSUMER_REVOKED",
        revokedAt: new Date(scenarioStartedAt.getTime() + 90_000_000),
      }),
    ).resolves.toBe(true);
    expect(
      await prisma.webhookDelivery.count({
        where: {
          endpointId: firstEndpointId,
          status: { in: ["PENDING", "PROCESSING"] },
        },
      }),
    ).toBe(0);
    expect(await repository.endpointIsActive(accountA, firstEndpointId)).toBe(
      false,
    );
  });
});
