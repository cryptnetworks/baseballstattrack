import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";

import {
  DiscordUpdateProviderError,
  type DiscordStatisticsSnapshot,
  type DiscordUpdateTransportInput,
} from "@/domain/discord-update-worker";
import { DiscordCadenceService } from "@/server/app/discord-cadence-service";
import {
  DiscordUpdatePublicationService,
  DiscordUpdateWorkerService,
} from "@/server/app/discord-update-worker-service";
import { PrismaDiscordUpdateRepository } from "@/server/data/discord-update-repository";
import {
  createDiscordControlPlaneFixture,
  discordFixtureSettingsInput,
} from "../fixtures/discord-control-plane";

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const baseTime = new Date("2026-08-02T12:00:00.000Z");

function at(seconds: number) {
  return new Date(baseTime.getTime() + seconds * 1_000);
}

function snapshot(
  sourceRevision: number,
  values: Partial<DiscordStatisticsSnapshot> = {},
): DiscordStatisticsSnapshot {
  return {
    awayTeam: "Synthetic Visitors",
    homeTeam: "Synthetic Home",
    awayScore: 0,
    homeScore: 0,
    inning: 1,
    half: "TOP",
    latestEvent: "Game started.",
    correctionSummary: null,
    reportReady: false,
    verified: false,
    sourceRevision,
    freshness: "CURRENT",
    ...values,
  };
}

class SyntheticStatistics {
  current = snapshot(0);
  readonly reads: Array<{
    accountId: string;
    gameId: string;
    settingsRevision: number;
  }> = [];

  async loadGame(input: {
    accountId: string;
    gameId: string;
    settingsRevision: number;
  }) {
    this.reads.push(input);
    return this.current;
  }
}

class SyntheticDiscordTransport {
  readonly sends: DiscordUpdateTransportInput[] = [];
  nextFailure: DiscordUpdateProviderError | null = null;

  async send(input: DiscordUpdateTransportInput) {
    this.sends.push(input);
    if (this.nextFailure) {
      const failure = this.nextFailure;
      this.nextFailure = null;
      throw failure;
    }
    return { status: 200, messageId: "823456789012345678" };
  }
}

integration("Discord control-plane end-to-end fixtures", () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl! }),
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("delivers start, score, correction, and final state without duplicate messages", async () => {
    const fixture = await createDiscordControlPlaneFixture(prisma, "sequence");
    const repository = new PrismaDiscordUpdateRepository(prisma);
    const publication = new DiscordUpdatePublicationService(repository);
    const statistics = new SyntheticStatistics();
    const transport = new SyntheticDiscordTransport();
    let clock = at(0);
    const worker = new DiscordUpdateWorkerService(
      repository,
      statistics,
      transport,
      { emit() {} },
      () => clock,
    );
    const signal = async (
      trigger:
        "GAME_STARTED" | "SCORE_CHANGED" | "GAME_CORRECTED" | "GAME_COMPLETED",
      sourceRevision: number,
      occurredAt: Date,
    ) =>
      publication.publish({
        accountId: fixture.primary.accountId,
        gameId: fixture.primary.gameId,
        trigger,
        sourceRevision,
        occurredAt: occurredAt.toISOString(),
      });

    statistics.current = snapshot(1);
    await expect(signal("GAME_STARTED", 1, at(0))).resolves.toEqual({
      outcome: "accepted",
      created: 1,
    });
    await expect(signal("GAME_STARTED", 1, at(0))).resolves.toEqual({
      outcome: "accepted",
      created: 0,
    });
    await expect(
      worker.evaluateBatch("fixture-116-evaluate", { now: at(0) }),
    ).resolves.toEqual([expect.objectContaining({ outcome: "succeeded" })]);
    await expect(
      worker.deliverBatch("fixture-116-deliver", { now: at(0) }),
    ).resolves.toEqual([expect.objectContaining({ outcome: "succeeded" })]);

    clock = at(60);
    statistics.current = snapshot(2, {
      homeScore: 2,
      inning: 3,
      half: "BOTTOM",
      latestEvent: "Home run scored two runs.",
    });
    transport.nextFailure = new DiscordUpdateProviderError(
      "RATE_LIMITED",
      true,
      429,
      90,
    );
    await signal("SCORE_CHANGED", 2, at(60));
    await worker.evaluateBatch("fixture-116-evaluate", { now: at(60) });
    await expect(
      worker.deliverBatch("fixture-116-deliver", { now: at(60) }),
    ).resolves.toEqual([expect.objectContaining({ outcome: "retry" })]);
    await expect(
      worker.deliverBatch("fixture-116-deliver", { now: at(149) }),
    ).resolves.toEqual([]);
    clock = at(150);
    await expect(
      worker.deliverBatch("fixture-116-deliver", { now: at(150) }),
    ).resolves.toEqual([expect.objectContaining({ outcome: "succeeded" })]);

    clock = at(180);
    statistics.current = snapshot(2, {
      freshness: "STALE",
      homeScore: 2,
    });
    await signal("GAME_CORRECTED", 3, at(180));
    await expect(
      worker.evaluateBatch("fixture-116-evaluate", { now: at(180) }),
    ).resolves.toEqual([expect.objectContaining({ outcome: "retry" })]);
    await expect(
      worker.evaluateBatch("fixture-116-evaluate", { now: at(209) }),
    ).resolves.toEqual([]);
    clock = at(210);
    statistics.current = snapshot(3, {
      homeScore: 1,
      inning: 3,
      half: "BOTTOM",
      latestEvent: "Scoring correction accepted.",
      correctionSummary: "Home run changed to a one-run play",
    });
    await worker.evaluateBatch("fixture-116-evaluate", { now: at(210) });
    await worker.deliverBatch("fixture-116-deliver", { now: at(210) });

    clock = at(240);
    statistics.current = snapshot(4, {
      awayScore: 4,
      homeScore: 3,
      inning: 9,
      half: "FINAL",
      latestEvent: "Game completed.",
      reportReady: true,
    });
    await signal("GAME_COMPLETED", 4, at(240));
    await worker.evaluateBatch("fixture-116-evaluate", { now: at(240) });
    await worker.deliverBatch("fixture-116-deliver", { now: at(240) });

    const deliveries = await prisma.discordUpdateDelivery.findMany({
      where: { accountId: fixture.primary.accountId },
      orderBy: { sourceRevision: "asc" },
      select: {
        sourceRevision: true,
        operation: true,
        status: true,
        attemptCount: true,
        providerMessageId: true,
      },
    });
    expect(deliveries).toEqual([
      expect.objectContaining({
        sourceRevision: 1,
        operation: "CREATE",
        status: "SUCCEEDED",
        attemptCount: 1,
      }),
      expect.objectContaining({
        sourceRevision: 2,
        operation: "EDIT",
        status: "SUCCEEDED",
        attemptCount: 2,
      }),
      expect.objectContaining({
        sourceRevision: 3,
        operation: "EDIT",
        status: "SUCCEEDED",
        attemptCount: 1,
      }),
      expect.objectContaining({
        sourceRevision: 4,
        operation: "EDIT",
        status: "SUCCEEDED",
        attemptCount: 1,
      }),
    ]);
    expect(transport.sends.map(({ operation }) => operation)).toEqual([
      "CREATE",
      "EDIT",
      "EDIT",
      "EDIT",
      "EDIT",
    ]);
    expect(transport.sends[1]!.idempotencyKey).toBe(
      transport.sends[2]!.idempotencyKey,
    );
    expect(
      new Set(transport.sends.map(({ idempotencyKey }) => idempotencyKey)).size,
    ).toBe(4);
    expect(transport.sends[0]!.content).toContain("Game started.");
    expect(transport.sends[1]!.content).toContain("Home run scored two runs.");
    expect(transport.sends[3]!.content).toContain("CORRECTED:");
    expect(transport.sends[4]!.content).toContain("Final");
    expect(
      statistics.reads.every(
        ({ accountId, gameId }) =>
          accountId === fixture.primary.accountExternalId &&
          gameId === fixture.primary.gameId,
      ),
    ).toBe(true);
    expect(
      transport.sends.every(
        ({ channelId }) => channelId === fixture.primary.providerChannelId,
      ),
    ).toBe(true);
  });

  it("cancels stale settings and permission-revoked deliveries", async () => {
    const fixture = await createDiscordControlPlaneFixture(prisma, "stale");
    const repository = new PrismaDiscordUpdateRepository(prisma);
    const publication = new DiscordUpdatePublicationService(repository);
    const statistics = new SyntheticStatistics();
    const transport = new SyntheticDiscordTransport();
    let clock = at(300);
    const worker = new DiscordUpdateWorkerService(
      repository,
      statistics,
      transport,
      { emit() {} },
      () => clock,
    );
    await publication.publish({
      accountId: fixture.primary.accountId,
      gameId: fixture.primary.gameId,
      trigger: "SCORE_CHANGED",
      sourceRevision: 10,
      occurredAt: at(300).toISOString(),
    });
    await fixture.settingsService.update(
      discordFixtureSettingsInput(
        fixture.primary,
        fixture.primary.settingsRevision,
        { messageFormat: "DETAILED" },
      ),
      fixture.primary.actor,
    );
    statistics.current = snapshot(10, { homeScore: 1 });
    await expect(
      worker.evaluateBatch("fixture-116-stale", { now: at(300) }),
    ).resolves.toEqual([expect.objectContaining({ outcome: "cancelled" })]);
    expect(
      await prisma.discordUpdateDelivery.count({
        where: { accountId: fixture.primary.accountId },
      }),
    ).toBe(0);

    clock = at(360);
    await publication.publish({
      accountId: fixture.primary.accountId,
      gameId: fixture.primary.gameId,
      trigger: "SCORE_CHANGED",
      sourceRevision: 11,
      occurredAt: at(360).toISOString(),
    });
    statistics.current = snapshot(11, { homeScore: 2 });
    await worker.evaluateBatch("fixture-116-stale", { now: at(360) });
    await fixture.channelRepository.syncChannels({
      accountId: fixture.primary.accountId,
      installationExternalId: fixture.primary.installationId,
      channels: [
        {
          channelId: fixture.primary.providerChannelId,
          displayName: "synthetic-primary-updates",
          canView: true,
          canSend: false,
        },
      ],
      actor: fixture.primary.actor,
    });
    await expect(
      worker.deliverBatch("fixture-116-stale", { now: at(360) }),
    ).resolves.toEqual([expect.objectContaining({ outcome: "cancelled" })]);
    expect(transport.sends).toEqual([]);
    await expect(
      fixture.settingsRepository.getConfiguration(
        fixture.primary.accountId,
        fixture.primary.installationId,
      ),
    ).resolves.toMatchObject({
      settings: { enabled: false, destinations: [] },
    });
  });

  it("dead-letters a terminal Discord API failure without retrying", async () => {
    const fixture = await createDiscordControlPlaneFixture(prisma, "failure");
    const repository = new PrismaDiscordUpdateRepository(prisma);
    const publication = new DiscordUpdatePublicationService(repository);
    const statistics = new SyntheticStatistics();
    statistics.current = snapshot(20);
    const transport = new SyntheticDiscordTransport();
    transport.nextFailure = new DiscordUpdateProviderError(
      "DESTINATION_UNAVAILABLE",
      false,
      404,
    );
    const worker = new DiscordUpdateWorkerService(
      repository,
      statistics,
      transport,
      { emit() {} },
      () => at(420),
    );
    await publication.publish({
      accountId: fixture.primary.accountId,
      gameId: fixture.primary.gameId,
      trigger: "GAME_STARTED",
      sourceRevision: 20,
      occurredAt: at(420).toISOString(),
    });
    await worker.evaluateBatch("fixture-116-failure", { now: at(420) });
    await expect(
      worker.deliverBatch("fixture-116-failure", { now: at(420) }),
    ).resolves.toEqual([expect.objectContaining({ outcome: "dead_letter" })]);
    await expect(
      worker.deliverBatch("fixture-116-failure", { now: at(86_820) }),
    ).resolves.toEqual([]);
    await expect(
      prisma.discordUpdateDelivery.findFirstOrThrow({
        where: { accountId: fixture.primary.accountId },
      }),
    ).resolves.toMatchObject({
      status: "DEAD_LETTER",
      attemptCount: 1,
      lastFailureCode: "DESTINATION_UNAVAILABLE",
    });
  });

  it("isolates Accounts and servers and stops enqueueing when disabled", async () => {
    const fixture = await createDiscordControlPlaneFixture(prisma, "isolation");
    const repository = new PrismaDiscordUpdateRepository(prisma);
    const publication = new DiscordUpdatePublicationService(repository);
    await expect(
      publication.publish({
        accountId: fixture.primary.accountId,
        gameId: fixture.primary.gameId,
        trigger: "GAME_STARTED",
        sourceRevision: 30,
        occurredAt: at(480).toISOString(),
      }),
    ).resolves.toEqual({ outcome: "accepted", created: 1 });
    const primaryEvaluation =
      await prisma.discordUpdateEvaluation.findFirstOrThrow({
        where: { accountId: fixture.primary.accountId, sourceRevision: 30 },
        select: { settings: { select: { installationId: true } } },
      });
    const primaryInstallation =
      await prisma.discordInstallation.findUniqueOrThrow({
        where: {
          accountId_externalId: {
            accountId: fixture.primary.accountId,
            externalId: fixture.primary.installationId,
          },
        },
        select: { id: true },
      });
    expect(primaryEvaluation.settings.installationId).toBe(
      primaryInstallation.id,
    );
    await expect(
      publication.publish({
        accountId: fixture.otherAccount.accountId,
        gameId: fixture.primary.gameId,
        trigger: "GAME_STARTED",
        sourceRevision: 30,
        occurredAt: at(480).toISOString(),
      }),
    ).resolves.toEqual({ outcome: "unavailable", created: 0 });
    await expect(
      fixture.settingsService.update(
        discordFixtureSettingsInput(
          fixture.primary,
          fixture.primary.settingsRevision,
          {
            destinations: [
              {
                destinationId: fixture.sibling.destinationId,
                purposes: ["LIVE_UPDATES", "FINAL_SCORES", "CORRECTIONS"],
              },
            ],
          },
        ),
        fixture.primary.actor,
      ),
    ).rejects.toMatchObject({ code: "RESOURCE_UNAVAILABLE" });

    const cadence = new DiscordCadenceService(fixture.settingsRepository);
    await cadence.changeState(
      {
        accountId: fixture.primary.accountId,
        installationId: fixture.primary.installationId,
        expectedRevision: fixture.primary.settingsRevision,
        operation: "PAUSE",
      },
      fixture.primary.actor,
    );
    await expect(
      publication.publish({
        accountId: fixture.primary.accountId,
        gameId: fixture.primary.gameId,
        trigger: "SCORE_CHANGED",
        sourceRevision: 31,
        occurredAt: at(540).toISOString(),
      }),
    ).resolves.toEqual({ outcome: "accepted", created: 0 });
    await expect(
      publication.publish({
        accountId: fixture.sibling.accountId,
        gameId: fixture.sibling.gameId,
        trigger: "GAME_STARTED",
        sourceRevision: 31,
        occurredAt: at(540).toISOString(),
      }),
    ).resolves.toEqual({ outcome: "accepted", created: 1 });
    await expect(
      publication.publish({
        accountId: fixture.otherAccount.accountId,
        gameId: fixture.otherAccount.gameId,
        trigger: "GAME_STARTED",
        sourceRevision: 31,
        occurredAt: at(540).toISOString(),
      }),
    ).resolves.toEqual({ outcome: "accepted", created: 1 });
  });
});
