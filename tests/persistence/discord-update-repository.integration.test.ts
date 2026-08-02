import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaDiscordUpdateRepository } from "@/server/data/discord-update-repository";

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const prefix = `issue119-${process.pid}-${Date.now()}`;
const now = new Date("2026-08-01T07:00:00.000Z");

function snapshot(revision: number) {
  return {
    awayTeam: "Away",
    homeTeam: "Home",
    awayScore: revision,
    homeScore: 1,
    inning: 7,
    half: "TOP" as const,
    latestEvent: `Accepted source revision ${revision}.`,
    correctionSummary: null,
    reportReady: false,
    verified: false,
  };
}

integration("Discord update worker persistence", () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl! }),
  });
  const repository = new PrismaDiscordUpdateRepository(prisma);
  const accountId = `${prefix}-account`;
  const otherAccountId = `${prefix}-other`;
  const teamId = `${prefix}-team`;
  const seasonId = `${prefix}-season`;
  const teamSeasonId = `${prefix}-team-season`;
  const gameId = `${prefix}-game`;
  let gameExternalId = "";
  let settingsId = "";

  beforeAll(async () => {
    await prisma.account.createMany({
      data: [
        { id: accountId, slug: `${prefix}-a`, displayName: "Worker A" },
        { id: otherAccountId, slug: `${prefix}-b`, displayName: "Worker B" },
      ],
    });
    await prisma.team.create({
      data: { id: teamId, accountId, displayName: "Tracked team" },
    });
    await prisma.season.create({
      data: { id: seasonId, accountId, displayName: "Tracked season" },
    });
    await prisma.teamSeason.create({
      data: { id: teamSeasonId, accountId, teamId, seasonId },
    });
    gameExternalId = (
      await prisma.game.create({
        data: {
          id: gameId,
          accountId,
          seasonId,
          teamSeasonId,
          status: "DRAFT",
        },
      })
    ).externalId;
    const installation = await prisma.discordInstallation.create({
      data: {
        accountId,
        guildId: `${Date.now()}11901`,
        credentialReference: "discord/installations/issue119",
        status: "ACTIVE",
        installedAt: now,
      },
    });
    const destination = await prisma.discordChannelDestination.create({
      data: {
        accountId,
        installationId: installation.id,
        channelId: `${Date.now()}11902`,
        channelReference: "discord/channels/issue119-live",
        lastVerifiedAt: now,
      },
    });
    const settings = await prisma.discordIntegrationSettings.create({
      data: {
        accountId,
        installationId: installation.id,
        enabled: false,
        cadenceMode: "EVENT_DRIVEN",
        cadenceSeconds: 300,
        triggers: ["SCORE_CHANGED", "GAME_CORRECTED"],
        messageStrategy: "EDIT_LIVE_MESSAGE",
        messageFormat: "COMPACT",
      },
    });
    settingsId = settings.id;
    await prisma.discordSettingsScope.create({
      data: { accountId, settingsId, teamSeasonId },
    });
    await prisma.discordSettingsDestination.create({
      data: {
        accountId,
        settingsId,
        destinationId: destination.id,
        purpose: "LIVE_UPDATES",
      },
    });
    await prisma.discordIntegrationSettings.update({
      where: { id: settingsId },
      data: { enabled: true },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("deduplicates duplicate signals and fails closed across Accounts", async () => {
    const signal = {
      accountId,
      gameExternalId,
      trigger: "SCORE_CHANGED" as const,
      sourceRevision: 7,
      occurredAt: now,
    };
    await expect(repository.enqueueSignal(signal)).resolves.toEqual({
      outcome: "accepted",
      created: 1,
    });
    await expect(repository.enqueueSignal(signal)).resolves.toEqual({
      outcome: "accepted",
      created: 0,
    });
    await expect(
      repository.enqueueSignal({ ...signal, accountId: otherAccountId }),
    ).resolves.toEqual({ outcome: "unavailable", created: 0 });
  });

  it("claims one ordered revision once across concurrent workers", async () => {
    await repository.enqueueSignal({
      accountId,
      gameExternalId,
      trigger: "SCORE_CHANGED",
      sourceRevision: 8,
      occurredAt: new Date(now.getTime() + 1_000),
    });
    const [first, second] = await Promise.all([
      repository.claimEvaluations("worker-119-one", now, 25),
      repository.claimEvaluations("worker-119-two", now, 25),
    ]);
    expect([...first, ...second]).toHaveLength(1);
    expect([...first, ...second][0]).toMatchObject({ sourceRevision: 7 });
    const claimed = [...first, ...second][0]!;
    await repository.completeEvaluation({
      evaluationId: claimed.id,
      workerId: claimed.leaseOwner!,
      completedAt: now,
      snapshot: snapshot(7),
    });
    const next = await repository.claimEvaluations(
      "worker-119-three",
      new Date(now.getTime() + 1_000),
      25,
    );
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ sourceRevision: 8 });
    await repository.completeEvaluation({
      evaluationId: next[0]!.id,
      workerId: "worker-119-three",
      completedAt: new Date(now.getTime() + 1_000),
      snapshot: snapshot(8),
    });
  });

  it("creates once, then deterministically edits the successful message", async () => {
    const deliveryNow = now;
    const queued = await prisma.discordUpdateDelivery.findMany({
      where: { settingsId },
      orderBy: { sourceRevision: "asc" },
      select: { sourceRevision: true, createdAt: true, nextAttemptAt: true },
    });
    expect(queued).toEqual([
      { sourceRevision: 7, createdAt: now, nextAttemptAt: now },
      {
        sourceRevision: 8,
        createdAt: new Date(now.getTime() + 1_000),
        nextAttemptAt: new Date(now.getTime() + 1_000),
      },
    ]);
    await expect(
      repository.claimDeliveries(
        "worker-119-before-schedule",
        new Date(deliveryNow.getTime() - 1),
        25,
      ),
    ).resolves.toHaveLength(0);
    const concurrentClaims = await Promise.all([
      repository.claimDeliveries("worker-119-four-a", deliveryNow, 25),
      repository.claimDeliveries("worker-119-four-b", deliveryNow, 25),
    ]);
    const first = concurrentClaims.flat();
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ sourceRevision: 7, operation: "CREATE" });
    const owner = first[0]!.leaseOwner!;
    const staleWorker =
      owner === "worker-119-four-a" ? "worker-119-four-b" : "worker-119-four-a";
    await expect(
      repository.completeDeliveryAttempt({
        deliveryId: first[0]!.id,
        workerId: staleWorker,
        startedAt: deliveryNow,
        completedAt: deliveryNow,
        durationMs: 0,
        responseStatus: 200,
        failureCode: null,
        providerMessageId: "999999999999999999",
        succeeded: true,
        terminal: false,
      }),
    ).resolves.toBeNull();
    await expect(
      prisma.discordUpdateDelivery.findUniqueOrThrow({
        where: { id: first[0]!.id },
      }),
    ).resolves.toMatchObject({
      status: "PROCESSING",
      attemptCount: 0,
      leaseOwner: owner,
      providerMessageId: null,
    });
    await repository.completeDeliveryAttempt({
      deliveryId: first[0]!.id,
      workerId: owner,
      startedAt: deliveryNow,
      completedAt: deliveryNow,
      durationMs: 10,
      responseStatus: 200,
      failureCode: null,
      providerMessageId: "123456789012345678",
      succeeded: true,
      terminal: false,
    });
    await expect(
      repository.claimDeliveries(
        "worker-119-five",
        new Date(deliveryNow.getTime() + 999),
        25,
      ),
    ).resolves.toHaveLength(0);
    const second = await repository.claimDeliveries(
      "worker-119-five",
      new Date(deliveryNow.getTime() + 1_000),
      25,
    );
    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({
      sourceRevision: 8,
      operation: "EDIT",
      targetProviderMessageId: "123456789012345678",
    });
    const retryAt = new Date(deliveryNow.getTime() + 1_000);
    await repository.completeDeliveryAttempt({
      deliveryId: second[0]!.id,
      workerId: "worker-119-five",
      startedAt: retryAt,
      completedAt: retryAt,
      durationMs: 5,
      responseStatus: 429,
      failureCode: "RATE_LIMITED",
      providerMessageId: null,
      succeeded: false,
      terminal: false,
      retryAfterSeconds: 90,
    });
    expect(
      await repository.claimDeliveries(
        "worker-119-six",
        new Date(retryAt.getTime() + 89_000),
        25,
      ),
    ).toHaveLength(0);
    const retried = await repository.claimDeliveries(
      "worker-119-six",
      new Date(retryAt.getTime() + 90_000),
      25,
    );
    expect(retried).toHaveLength(1);
    await repository.completeDeliveryAttempt({
      deliveryId: retried[0]!.id,
      workerId: "worker-119-six",
      startedAt: new Date(retryAt.getTime() + 90_000),
      completedAt: new Date(retryAt.getTime() + 90_001),
      durationMs: 1,
      responseStatus: 200,
      failureCode: null,
      providerMessageId: "123456789012345678",
      succeeded: true,
      terminal: false,
    });
    const attempts = await prisma.discordUpdateDeliveryAttempt.findMany({
      where: { deliveryId: retried[0]!.id },
      orderBy: { attemptNumber: "asc" },
    });
    expect(attempts.map(({ outcome }) => outcome)).toEqual([
      "RETRYABLE_FAILURE",
      "SUCCEEDED",
    ]);
    await expect(
      prisma.discordUpdateDeliveryAttempt.update({
        where: { id: attempts[0]!.id },
        data: { failureCode: "MUTATED" },
      }),
    ).rejects.toBeTruthy();
    expect(
      (
        await prisma.discordIntegrationSettings.findUniqueOrThrow({
          where: { id: settingsId },
        })
      ).lastSuccessfulUpdateAt,
    ).toEqual(new Date(retryAt.getTime() + 90_001));
  });

  it("reclaims expired leases and cancels stale settings revisions", async () => {
    const occurredAt = new Date(now.getTime() + 200_000);
    await repository.enqueueSignal({
      accountId,
      gameExternalId,
      trigger: "SCORE_CHANGED",
      sourceRevision: 9,
      occurredAt,
    });
    const leased = await repository.claimEvaluations(
      "worker-119-seven",
      occurredAt,
      1,
    );
    expect(leased).toHaveLength(1);
    const reclaimed = await repository.claimEvaluations(
      "worker-119-eight",
      new Date(occurredAt.getTime() + 61_000),
      1,
    );
    expect(reclaimed.map(({ id }) => id)).toEqual([leased[0]!.id]);
    await prisma.discordIntegrationSettings.update({
      where: { id: settingsId },
      data: { revision: { increment: 1 } },
    });
    await expect(
      repository.completeEvaluation({
        evaluationId: reclaimed[0]!.id,
        workerId: "worker-119-eight",
        completedAt: new Date(occurredAt.getTime() + 61_000),
        snapshot: snapshot(9),
      }),
    ).resolves.toMatchObject({
      status: "CANCELLED",
      lastFailureCode: "SETTINGS_OR_SCOPE_CHANGED",
    });
  });
});
