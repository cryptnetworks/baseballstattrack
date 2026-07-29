import type { PrismaClient } from "@prisma/client";

export type PersistenceScoringIds = {
  account: string;
  game: string;
  setup: string;
  ruleset: string;
  home: {
    team: string;
    teamSeason: string;
    batter: string;
    pitcher: string;
  };
  away: {
    team: string;
    teamSeason: string;
    batter: string;
    pitcher: string;
  };
};

export async function seedPersistenceScoringFixture(
  prisma: PrismaClient,
  prefix: string,
): Promise<PersistenceScoringIds> {
  const ids: PersistenceScoringIds = {
    account: `${prefix}-account`,
    game: `${prefix}-game`,
    setup: `${prefix}-setup`,
    ruleset: `${prefix}-ruleset`,
    home: {
      team: `${prefix}-home-team`,
      teamSeason: `${prefix}-home-team-season`,
      batter: `${prefix}-home-batter`,
      pitcher: `${prefix}-home-pitcher`,
    },
    away: {
      team: `${prefix}-away-team`,
      teamSeason: `${prefix}-away-team-season`,
      batter: `${prefix}-away-batter`,
      pitcher: `${prefix}-away-pitcher`,
    },
  };
  const season = `${prefix}-season`;

  const existingAccount = await prisma.account.findUnique({
    where: { id: ids.account },
    select: {
      id: true,
      setupSnapshots: {
        where: { id: ids.setup, gameId: ids.game },
        select: { id: true },
      },
    },
  });
  if (existingAccount) {
    if (existingAccount.setupSnapshots.length !== 1) {
      throw new Error(
        "Existing synthetic fixture namespace has an incomplete setup.",
      );
    }
    return ids;
  }

  await prisma.account.create({
    data: {
      id: ids.account,
      slug: ids.account,
      displayName: "Synthetic Fixture Account",
    },
  });
  await prisma.team.createMany({
    data: [
      {
        id: ids.home.team,
        accountId: ids.account,
        displayName: "Synthetic Home Team",
      },
      {
        id: ids.away.team,
        accountId: ids.account,
        displayName: "Synthetic Away Team",
      },
    ],
  });
  await prisma.season.create({
    data: {
      id: season,
      accountId: ids.account,
      displayName: "Synthetic Fixture Season",
    },
  });
  await prisma.teamSeason.createMany({
    data: [
      {
        id: ids.home.teamSeason,
        accountId: ids.account,
        teamId: ids.home.team,
        seasonId: season,
      },
      {
        id: ids.away.teamSeason,
        accountId: ids.account,
        teamId: ids.away.team,
        seasonId: season,
      },
    ],
  });
  await prisma.player.createMany({
    data: [
      {
        id: ids.home.batter,
        accountId: ids.account,
        displayName: "Synthetic Home Batter",
      },
      {
        id: ids.home.pitcher,
        accountId: ids.account,
        displayName: "Synthetic Home Pitcher",
      },
      {
        id: ids.away.batter,
        accountId: ids.account,
        displayName: "Synthetic Away Batter",
      },
      {
        id: ids.away.pitcher,
        accountId: ids.account,
        displayName: "Synthetic Away Pitcher",
      },
    ],
  });
  const players = [
    { side: "home", role: "batter", playerId: ids.home.batter },
    { side: "home", role: "pitcher", playerId: ids.home.pitcher },
    { side: "away", role: "batter", playerId: ids.away.batter },
    { side: "away", role: "pitcher", playerId: ids.away.pitcher },
  ] as const;
  await prisma.rosterEntry.createMany({
    data: players.map(({ side, role, playerId }) => ({
      id: `${prefix}-${side}-${role}-roster`,
      accountId: ids.account,
      playerId,
      teamSeasonId: side === "home" ? ids.home.teamSeason : ids.away.teamSeason,
    })),
  });
  await prisma.rulesetVersion.create({
    data: {
      id: ids.ruleset,
      accountId: ids.account,
      name: "synthetic-fixture-rules",
      version: 1,
      configuration: { scheduledInnings: 1 },
    },
  });
  await prisma.game.create({
    data: {
      id: ids.game,
      accountId: ids.account,
      seasonId: season,
      teamSeasonId: ids.home.teamSeason,
      status: "READY",
    },
  });
  await prisma.gameSetupSnapshot.create({
    data: {
      id: ids.setup,
      accountId: ids.account,
      gameId: ids.game,
      setupRevision: 1,
      rulesetVersionId: ids.ruleset,
      scheduledInnings: 1,
    },
  });
  const homeSnapshot = `${prefix}-home-snapshot`;
  const awaySnapshot = `${prefix}-away-snapshot`;
  await prisma.gameTeamSnapshot.createMany({
    data: [
      {
        id: homeSnapshot,
        accountId: ids.account,
        gameId: ids.game,
        setupSnapshotId: ids.setup,
        side: "HOME",
        teamId: ids.home.team,
        teamSeasonId: ids.home.teamSeason,
        displayName: "Synthetic Home Team",
        isAccountTeam: true,
      },
      {
        id: awaySnapshot,
        accountId: ids.account,
        gameId: ids.game,
        setupSnapshotId: ids.setup,
        side: "AWAY",
        teamId: ids.away.team,
        teamSeasonId: ids.away.teamSeason,
        displayName: "Synthetic Away Team",
        isAccountTeam: true,
      },
    ],
  });
  await prisma.lineupSlotSnapshot.createMany({
    data: players.map(({ side, role, playerId }) => ({
      id: `${prefix}-${side}-${role}-slot`,
      accountId: ids.account,
      gameId: ids.game,
      setupSnapshotId: ids.setup,
      gameTeamSnapshotId: side === "home" ? homeSnapshot : awaySnapshot,
      playerId,
      rosterEntryId: `${prefix}-${side}-${role}-roster`,
      displayName: `Synthetic ${side} ${role}`,
      battingOrder: role === "batter" ? 1 : null,
      defensivePosition: role === "batter" ? "SHORTSTOP" : "PITCHER",
      isStartingPitcher: role === "pitcher",
    })),
  });

  return ids;
}
