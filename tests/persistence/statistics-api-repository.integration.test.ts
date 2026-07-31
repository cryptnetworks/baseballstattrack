import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { decodeStatisticsCursor } from "@/domain/statistics-api";
import { PrismaStatisticsApiRepository } from "@/server/data/statistics-api-repository";

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const prefix = `issue91-${process.pid}-${Date.now()}`;

integration("statistics API external identity and pagination", () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl! }),
  });
  const repository = new PrismaStatisticsApiRepository(prisma);
  const accountId = `${prefix}-account`;
  const accountExternalId = randomUUID();
  const teamExternalIds = [randomUUID(), randomUUID(), randomUUID()].sort();

  beforeAll(async () => {
    await prisma.account.create({
      data: {
        id: accountId,
        externalId: accountExternalId,
        slug: accountId,
        displayName: "Issue 91 Account",
      },
    });
    await prisma.team.createMany({
      data: teamExternalIds.map((externalId, index) => ({
        id: `${prefix}-team-${index}`,
        externalId,
        accountId,
        displayName: index === 2 ? "Filtered Club" : `Stars ${index}`,
      })),
    });
  });

  afterAll(async () => {
    await prisma.player.deleteMany({ where: { accountId } });
    await prisma.team.deleteMany({ where: { accountId } });
    await prisma.account.deleteMany({ where: { id: accountId } });
    await prisma.$disconnect();
  });

  it("resolves public identifiers without exposing internal keys", async () => {
    await expect(
      repository.resolveAccount(accountExternalId),
    ).resolves.toMatchObject({
      id: accountId,
      externalId: accountExternalId,
    });
    await expect(repository.resolveAccount(randomUUID())).resolves.toBeNull();
    const generated = await prisma.player.create({
      data: {
        id: `${prefix}-player`,
        accountId,
        displayName: "Generated External ID",
      },
    });
    expect(generated.externalId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("paginates deterministically and keeps filters Account-scoped", async () => {
    const first = await repository.listTeams({
      accountId,
      limit: 2,
      cursor: null,
      direction: "asc",
      query: null,
    });
    expect(first.data.map(({ externalId }) => externalId)).toEqual(
      teamExternalIds.slice(0, 2),
    );
    expect(first.nextCursor).not.toBeNull();
    const second = await repository.listTeams({
      accountId,
      limit: 2,
      cursor: decodeStatisticsCursor(first.nextCursor, "asc"),
      direction: "asc",
      query: null,
    });
    expect(second.data.map(({ externalId }) => externalId)).toEqual([
      teamExternalIds[2],
    ]);
    await expect(
      repository.listTeams({
        accountId: `${prefix}-other-account`,
        limit: 25,
        cursor: null,
        direction: "asc",
        query: null,
      }),
    ).resolves.toMatchObject({ data: [], nextCursor: null });
    await expect(
      repository.listTeams({
        accountId,
        limit: 25,
        cursor: null,
        direction: "asc",
        query: "filtered",
      }),
    ).resolves.toMatchObject({
      data: [expect.objectContaining({ externalId: teamExternalIds[2] })],
    });
  });

  it("keeps external API identities immutable", async () => {
    await expect(
      prisma.team.update({
        where: { id: `${prefix}-team-0` },
        data: { externalId: randomUUID() },
      }),
    ).rejects.toThrow();
  });
});
