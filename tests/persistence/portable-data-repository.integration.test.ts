import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaPortableDataRepository } from "@/server/data/portable-data-repository";
import { seedPersistenceScoringFixture } from "../fixtures/persistence-scoring-fixture";
import { trustedActorForTest } from "../fixtures/trusted-actor";

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const prefix = `issue26-${process.pid}`;

integration("portable data persistence boundary", () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl! }),
  });
  const repository = new PrismaPortableDataRepository(prisma);
  let ids: Awaited<ReturnType<typeof seedPersistenceScoringFixture>>;

  beforeAll(async () => {
    ids = await seedPersistenceScoringFixture(prisma, prefix);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("loads only the exact Account catalog and resolves current player privacy", async () => {
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
            replacementValue: "Portable Protected Player",
          },
        },
      },
    });
    const source = await repository.loadCatalog(ids.account);
    expect(source.teams.length).toBeGreaterThan(0);
    expect(source.seasons.length).toBeGreaterThan(0);
    expect(source.games).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: ids.game,
          setupSnapshotId: ids.setup,
        }),
      ]),
    );
    expect(
      source.players.find(({ id }) => id === ids.away.batter)?.displayName,
    ).toBe("Portable Protected Player");
    await expect(repository.loadCatalog(`${prefix}-other`)).resolves.toEqual({
      teams: [],
      seasons: [],
      teamSeasons: [],
      players: [],
      rosters: [],
      rulesets: [],
      games: [],
    });
  });

  it("detects existing logical IDs and records a minimized export audit", async () => {
    const existing = await repository.findExistingLogicalIds(ids.account, [
      ids.game,
      ids.away.batter,
      "missing",
    ]);
    expect(existing).toEqual(new Set([ids.game, ids.away.batter]));
    const actor = trustedActorForTest({
      accountId: ids.account,
      actorId: `${prefix}-export-service`,
      actorKind: "SERVICE",
      actorUserId: null,
      membershipId: null,
      capability: "report.export",
      scope: { kind: "ACCOUNT" },
      authorizedAt: "2026-07-30T20:00:00.000Z",
    });
    await repository.audit({
      actor,
      action: "data.export.download",
      outcome: "SUCCEEDED",
      metadata: {
        checksum: "sha256:test",
        counts: { games: 1 },
        ephemeral: true,
      },
    });
    const audit = await prisma.securityAuditRecord.findFirstOrThrow({
      where: {
        accountId: ids.account,
        action: "data.export.download",
        actorId: actor.actorId,
      },
    });
    expect(audit).toMatchObject({
      capability: "report.export",
      outcome: "SUCCEEDED",
      targetType: "AccountPortableData",
    });
    expect(JSON.stringify(audit.metadata)).not.toMatch(
      /displayName|event|payload|email|token/iu,
    );
  });
});
