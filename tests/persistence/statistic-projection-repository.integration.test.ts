import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { STATISTIC_DERIVATION_VERSION } from "@/domain/statistics";
import { PrismaStatisticProjectionRepository } from "@/server/data/statistic-projection-repository";

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const runPrefix = `issue11-${process.pid}`;

integration("PrismaStatisticProjectionRepository", () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl! }),
  });
  const repository = new PrismaStatisticProjectionRepository(prisma);

  beforeAll(async () => {
    await prisma.account.create({
      data: {
        id: `${runPrefix}-account`,
        slug: `${runPrefix}-account`,
        displayName: "Synthetic Issue 11",
      },
    });
    await prisma.team.create({
      data: {
        id: `${runPrefix}-team`,
        accountId: `${runPrefix}-account`,
        displayName: "Synthetic Team",
      },
    });
    await prisma.season.create({
      data: {
        id: `${runPrefix}-season`,
        accountId: `${runPrefix}-account`,
        displayName: "Synthetic Season",
      },
    });
    await prisma.teamSeason.create({
      data: {
        id: `${runPrefix}-team-season`,
        accountId: `${runPrefix}-account`,
        teamId: `${runPrefix}-team`,
        seasonId: `${runPrefix}-season`,
      },
    });
    await prisma.game.createMany({
      data: [
        {
          id: `${runPrefix}-game`,
          accountId: `${runPrefix}-account`,
          seasonId: `${runPrefix}-season`,
          teamSeasonId: `${runPrefix}-team-season`,
        },
        {
          id: `${runPrefix}-race-game`,
          accountId: `${runPrefix}-account`,
          seasonId: `${runPrefix}-season`,
          teamSeasonId: `${runPrefix}-team-season`,
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const command = (
    overrides: Partial<
      Parameters<typeof repository.publishGameCheckpoint>[0]
    > = {},
  ) => ({
    accountId: `${runPrefix}-account`,
    gameId: `${runPrefix}-game`,
    sourceRevision: 0,
    privacyOverlayRevision: 0,
    derivationVersion: STATISTIC_DERIVATION_VERSION,
    ...overrides,
  });

  it("publishes idempotently and prevents an older source revision from becoming current", async () => {
    const first = await repository.publishGameCheckpoint(command());
    const retry = await repository.publishGameCheckpoint(command());
    expect(retry.id).toBe(first.id);
    expect(retry.status).toBe("CURRENT");

    await prisma.game.update({
      where: { id: `${runPrefix}-game` },
      data: { revision: 1 },
    });
    const newer = await repository.publishGameCheckpoint(
      command({ sourceRevision: 1 }),
    );
    expect(newer.status).toBe("CURRENT");
    expect(
      await prisma.projectionCheckpoint.findUnique({
        where: { id: first.id },
        select: { status: true },
      }),
    ).toEqual({ status: "STALE" });
    await expect(
      repository.publishGameCheckpoint(command()),
    ).rejects.toMatchObject({ code: "STALE_PROJECTION_WRITE" });
  });

  it("coalesces concurrent publication of the same projection identity", async () => {
    const race = command({ gameId: `${runPrefix}-race-game` });
    const [left, right] = await Promise.all([
      repository.publishGameCheckpoint(race),
      repository.publishGameCheckpoint(race),
    ]);
    expect(left.id).toBe(right.id);
  });

  it("includes the Account privacy revision in freshness identity", async () => {
    await prisma.privacyOverlay.create({
      data: {
        id: `${runPrefix}-privacy`,
        accountId: `${runPrefix}-account`,
        effectiveOrder: 1,
        reasonCode: "PSEUDONYMIZE",
        actorId: `${runPrefix}-service`,
      },
    });
    await expect(
      repository.publishGameCheckpoint(command({ sourceRevision: 1 })),
    ).rejects.toMatchObject({ code: "STALE_PROJECTION_WRITE" });
    const current = await repository.publishGameCheckpoint(
      command({ sourceRevision: 1, privacyOverlayRevision: 1 }),
    );
    expect(current.privacyOverlayRevision).toBe(1);
    expect(
      await repository.findCurrentGameCheckpoint(
        `${runPrefix}-account`,
        `${runPrefix}-game`,
        {
          sourceRevision: 1,
          privacyOverlayRevision: 1,
          derivationVersion: STATISTIC_DERIVATION_VERSION,
        },
      ),
    ).toMatchObject({ id: current.id, status: "CURRENT" });
  });

  it("rejects cross-Account publication without revealing another game", async () => {
    await expect(
      repository.publishGameCheckpoint(
        command({ accountId: `${runPrefix}-other-account` }),
      ),
    ).rejects.toMatchObject({ code: "ACCOUNT_MISMATCH" });
  });
});
