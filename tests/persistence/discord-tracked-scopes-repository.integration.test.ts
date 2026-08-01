import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaDiscordTrackedScopesRepository } from "@/server/data/discord-tracked-scopes-repository";

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const prefix = `issue120-${process.pid}-${Date.now()}`;
const snowflake = `8${Date.now()}${process.pid}`;

integration("Discord tracked scope persistence", () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl! }),
  });
  const repository = new PrismaDiscordTrackedScopesRepository(prisma);
  const accountA = `${prefix}-account-a`;
  const accountB = `${prefix}-account-b`;
  let installationA = "";
  let installationB = "";
  let teamExternalId = "";
  let seasonExternalId = "";

  beforeAll(async () => {
    await prisma.account.createMany({
      data: [
        { id: accountA, slug: `${prefix}-a`, displayName: "Tracking A" },
        { id: accountB, slug: `${prefix}-b`, displayName: "Tracking B" },
      ],
    });
    const [team, archivedTeam, otherTeam, season, otherSeason] =
      await Promise.all([
        prisma.team.create({
          data: {
            id: `${prefix}-team-active`,
            accountId: accountA,
            displayName: "Falcons",
          },
        }),
        prisma.team.create({
          data: {
            id: `${prefix}-team-archived`,
            accountId: accountA,
            displayName: "Falcons alumni",
            status: "ARCHIVED",
            archivedAt: new Date("2026-07-01T00:00:00.000Z"),
          },
        }),
        prisma.team.create({
          data: {
            id: `${prefix}-team-other`,
            accountId: accountB,
            displayName: "Other tenant",
          },
        }),
        prisma.season.create({
          data: {
            id: `${prefix}-season-active`,
            accountId: accountA,
            displayName: "2027",
            status: "ACTIVE",
          },
        }),
        prisma.season.create({
          data: {
            id: `${prefix}-season-other`,
            accountId: accountB,
            displayName: "Other season",
            status: "ACTIVE",
          },
        }),
      ]);
    teamExternalId = team.externalId;
    seasonExternalId = season.externalId;
    const [activeParticipation] = await Promise.all([
      prisma.teamSeason.create({
        data: {
          id: `${prefix}-participation-active`,
          accountId: accountA,
          teamId: team.id,
          seasonId: season.id,
        },
      }),
      prisma.teamSeason.create({
        data: {
          id: `${prefix}-participation-archived`,
          accountId: accountA,
          teamId: archivedTeam.id,
          seasonId: season.id,
        },
      }),
      prisma.teamSeason.create({
        data: {
          id: `${prefix}-participation-other`,
          accountId: accountB,
          teamId: otherTeam.id,
          seasonId: otherSeason.id,
        },
      }),
    ]);
    await prisma.game.create({
      data: {
        id: `${prefix}-game-upcoming`,
        accountId: accountA,
        seasonId: season.id,
        teamSeasonId: activeParticipation.id,
        status: "DRAFT",
      },
    });
    const [a, b] = await Promise.all([
      prisma.discordInstallation.create({
        data: {
          accountId: accountA,
          guildId: `${snowflake}1`,
          credentialReference: "discord/installations/issue120-a",
          status: "ACTIVE",
          installedAt: new Date(),
        },
      }),
      prisma.discordInstallation.create({
        data: {
          accountId: accountB,
          guildId: `${snowflake}2`,
          credentialReference: "discord/installations/issue120-b",
          status: "ACTIVE",
          installedAt: new Date(),
        },
      }),
    ]);
    installationA = a.externalId;
    installationB = b.externalId;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("lists only exact-Account team-seasons with deliberate states", async () => {
    const workspace = await repository.getWorkspace(accountA, installationA);
    expect(workspace).toMatchObject({
      installation: { id: installationA, status: "ACTIVE" },
      scopes: [
        {
          teamId: teamExternalId,
          teamName: "Falcons",
          seasonId: seasonExternalId,
          seasonName: "2027",
          available: true,
          games: { upcoming: 1 },
          gameCount: 1,
        },
        {
          teamName: "Falcons alumni",
          available: false,
          staleReasons: ["team archived"],
          gameCount: 0,
        },
      ],
    });
    const serialized = JSON.stringify(workspace);
    expect(serialized).not.toContain(accountA);
    expect(serialized).not.toContain(`${prefix}-participation-active`);
    expect(serialized).not.toContain("Other tenant");
    expect(serialized).not.toMatch(/credentialReference|guildId/iu);
  });

  it("non-enumerates an installation owned by another Account", async () => {
    await expect(
      repository.getWorkspace(accountA, installationB),
    ).resolves.toBeNull();
  });
});
