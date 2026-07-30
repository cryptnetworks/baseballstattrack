import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { STATISTIC_DERIVATION_VERSION } from "@/domain/statistics";
import { PrismaGameBoxScoreRepository } from "@/server/data/game-box-score-repository";
import { PrismaStatisticProjectionRepository } from "@/server/data/statistic-projection-repository";
import { seedPersistenceScoringFixture } from "../fixtures/persistence-scoring-fixture";

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const prefix = `issue22-${process.pid}`;

integration("PrismaGameBoxScoreRepository", () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl! }),
  });
  const reports = new PrismaGameBoxScoreRepository(prisma);
  const projections = new PrismaStatisticProjectionRepository(prisma);
  let ids: Awaited<ReturnType<typeof seedPersistenceScoringFixture>>;

  beforeAll(async () => {
    ids = await seedPersistenceScoringFixture(prisma, prefix);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("resolves the current privacy overlay and exact fresh checkpoint", async () => {
    const initial = await reports.loadPresentationSource(
      ids.account,
      ids.game,
      ids.setup,
    );
    expect(initial).toMatchObject({
      sourceRevision: 0,
      privacyOverlayRevision: 0,
      projectionCheckpoint: null,
    });
    expect(
      initial.presentation.players.find(
        ({ playerId }) => playerId === ids.away.batter,
      )?.displayName,
    ).toBe("Synthetic away batter");

    await prisma.privacyOverlay.create({
      data: {
        id: `${prefix}-privacy`,
        accountId: ids.account,
        effectiveOrder: 1,
        reasonCode: "PSEUDONYMIZE",
        actorId: `${prefix}-privacy-service`,
        fields: {
          create: {
            id: `${prefix}-privacy-field`,
            playerId: ids.away.batter,
            field: "PLAYER_DISPLAY_NAME",
            replacementValue: "Protected Player",
          },
        },
      },
    });
    await projections.publishGameCheckpoint({
      accountId: ids.account,
      gameId: ids.game,
      sourceRevision: 0,
      privacyOverlayRevision: 1,
      derivationVersion: STATISTIC_DERIVATION_VERSION,
    });
    const protectedSource = await reports.loadPresentationSource(
      ids.account,
      ids.game,
      ids.setup,
    );
    expect(protectedSource).toMatchObject({
      sourceRevision: 0,
      privacyOverlayRevision: 1,
      projectionCheckpoint: {
        sourceRevision: 0,
        privacyOverlayRevision: 1,
        derivationVersion: STATISTIC_DERIVATION_VERSION,
        status: "CURRENT",
      },
    });
    expect(
      protectedSource.presentation.players.find(
        ({ playerId }) => playerId === ids.away.batter,
      )?.displayName,
    ).toBe("Protected Player");
  });

  it("fails closed for cross-Account report presentation", async () => {
    await expect(
      reports.loadPresentationSource(
        `${prefix}-other-account`,
        ids.game,
        ids.setup,
      ),
    ).rejects.toMatchObject({ code: "INVALID_REPORT_INPUT" });
  });
});
