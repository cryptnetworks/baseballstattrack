import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { deriveGameStatistics } from "@/domain/statistics";
import { TeamSeasonRosterService } from "@/server/app/team-season-roster-service";
import { PrismaGameEventRepository } from "@/server/data/game-event-repository";
import { PrismaTeamSeasonRosterRepository } from "@/server/data/team-season-roster-repository";

import {
  seedPersistenceScoringFixture,
  type PersistenceScoringIds,
} from "../fixtures/persistence-scoring-fixture";
import { trustedActorForTest } from "../fixtures/trusted-actor";

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const runPrefix = `issue13-${process.pid}`;

integration("team, season, and roster management persistence", () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl! }),
  });
  const repository = new PrismaTeamSeasonRosterRepository(prisma);
  const service = new TeamSeasonRosterService(repository);
  const eventRepository = new PrismaGameEventRepository(prisma);
  let ids: PersistenceScoringIds;

  const actor = (
    capability:
      | "team.view"
      | "team.manage"
      | "season.view"
      | "season.manage"
      | "roster.view"
      | "roster.manage",
    scope:
      | { kind: "ACCOUNT" }
      | { kind: "TEAM"; teamId: string }
      | { kind: "SEASON"; seasonId: string } = { kind: "ACCOUNT" },
  ) =>
    trustedActorForTest({
      accountId: ids.account,
      actorId: `${runPrefix}-management-service`,
      actorKind: "SERVICE" as const,
      actorUserId: null,
      membershipId: null,
      capability,
      scope,
      authorizedAt: "2026-07-29T18:00:00.000Z",
    });

  beforeAll(async () => {
    ids = await seedPersistenceScoringFixture(prisma, runPrefix);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("reuses a stable player across seasons and preserves accepted history", async () => {
    await eventRepository.accept({
      accountId: ids.account,
      gameId: ids.game,
      setupSnapshotId: ids.setup,
      expectedRevision: 0,
      eventId: `${runPrefix}-event-start`,
      playTransactionId: `${runPrefix}-play-start`,
      clientSubmissionId: `${runPrefix}-submission-start`,
      recordedAt: "2026-01-01T00:00:00.000Z",
      actor: {
        accountId: ids.account,
        actorId: `${runPrefix}-score-service`,
        actorKind: "SERVICE",
        actorUserId: null,
        capability: "game.start",
        scope: { kind: "GAME", gameId: ids.game },
        authorizedAt: "2026-01-01T00:00:00.000Z",
      },
      body: { eventType: "GameStarted", payload: {} },
    });

    const setupBefore = await prisma.gameSetupSnapshot.findUniqueOrThrow({
      where: { id: ids.setup },
      include: {
        teamSnapshots: { orderBy: { side: "asc" } },
        lineupSlots: { orderBy: { id: "asc" } },
      },
    });
    const historyBefore = await eventRepository.loadAcceptedHistory(
      ids.account,
      ids.game,
      ids.setup,
    );
    const statisticsBefore = deriveGameStatistics(historyBefore);

    const nextSeason = await service.createSeason(
      {
        accountId: ids.account,
        displayName: "Next Season",
        startsOn: "2027-01-01",
        endsOn: "2027-12-31",
      },
      actor("season.manage"),
    );
    const nextParticipation = await service.addTeamSeason(
      {
        accountId: ids.account,
        teamId: ids.home.team,
        seasonId: nextSeason.id,
      },
      actor("season.manage"),
    );
    await service.addRosterPeriod(
      {
        accountId: ids.account,
        teamSeasonId: nextParticipation.id,
        playerId: ids.home.batter,
        startsAt: "2027-01-01T00:00:00.000Z",
        jerseyNumber: "7",
        primaryPosition: "SHORTSTOP",
      },
      actor("roster.manage"),
    );

    const currentRoster = await prisma.rosterEntry.findUniqueOrThrow({
      where: { id: `${runPrefix}-home-batter-roster` },
    });
    const replacement = await service.changeJersey(
      {
        accountId: ids.account,
        rosterEntryId: currentRoster.id,
        expectedRevision: currentRoster.revision,
        effectiveAt: "2028-01-01T00:00:00.000Z",
        jerseyNumber: "42",
      },
      actor("roster.manage", { kind: "TEAM", teamId: ids.home.team }),
    );
    await service.updatePlayer(
      {
        accountId: ids.account,
        playerId: ids.home.batter,
        expectedRevision: 0,
        displayName: "Renamed After Game",
        battingSide: "SWITCH",
        throwingHand: "RIGHT",
      },
      actor("roster.manage"),
    );

    const setupAfter = await prisma.gameSetupSnapshot.findUniqueOrThrow({
      where: { id: ids.setup },
      include: {
        teamSnapshots: { orderBy: { side: "asc" } },
        lineupSlots: { orderBy: { id: "asc" } },
      },
    });
    const historyAfter = await eventRepository.loadAcceptedHistory(
      ids.account,
      ids.game,
      ids.setup,
    );

    expect(setupAfter).toEqual(setupBefore);
    expect(historyAfter).toEqual(historyBefore);
    expect(deriveGameStatistics(historyAfter)).toEqual(statisticsBefore);
    expect(replacement.rosterEntry.jerseyNumber).toBe("42");
    expect(
      await prisma.rosterEntry.count({
        where: { accountId: ids.account, playerId: ids.home.batter },
      }),
    ).toBe(3);
  });

  it("allows duplicate jersey numbers but rejects duplicate active membership", async () => {
    const first = await service.createPlayer(
      { accountId: ids.account, displayName: "Jersey One" },
      actor("roster.manage"),
    );
    const second = await service.createPlayer(
      { accountId: ids.account, displayName: "Jersey Two" },
      actor("roster.manage"),
    );

    for (const playerId of [first.id, second.id]) {
      await service.addRosterPeriod(
        {
          accountId: ids.account,
          teamSeasonId: ids.away.teamSeason,
          playerId,
          startsAt: "2026-02-01T00:00:00.000Z",
          jerseyNumber: "00",
          primaryPosition: null,
        },
        actor("roster.manage"),
      );
    }

    await expect(
      service.addRosterPeriod(
        {
          accountId: ids.account,
          teamSeasonId: ids.away.teamSeason,
          playerId: first.id,
          startsAt: "2026-03-01T00:00:00.000Z",
          jerseyNumber: "8",
        },
        actor("roster.manage"),
      ),
    ).rejects.toMatchObject({
      code: "DUPLICATE_ACTIVE_RELATIONSHIP",
    });
    expect(
      await prisma.rosterEntry.count({
        where: {
          accountId: ids.account,
          teamSeasonId: ids.away.teamSeason,
          jerseyNumber: "00",
          status: "ACTIVE",
        },
      }),
    ).toBe(2);
  });

  it("keeps concurrent roster writers within one active historical chain", async () => {
    const player = await service.createPlayer(
      { accountId: ids.account, displayName: "Concurrent Roster Player" },
      actor("roster.manage"),
    );
    const additions = await Promise.allSettled([
      service.addRosterPeriod(
        {
          accountId: ids.account,
          teamSeasonId: ids.home.teamSeason,
          playerId: player.id,
          startsAt: "2026-01-01T00:00:00.000Z",
          jerseyNumber: "21",
        },
        actor("roster.manage"),
      ),
      service.addRosterPeriod(
        {
          accountId: ids.account,
          teamSeasonId: ids.home.teamSeason,
          playerId: player.id,
          startsAt: "2026-01-01T00:00:00.000Z",
          jerseyNumber: "22",
        },
        actor("roster.manage"),
      ),
    ]);
    expect(
      additions.filter(({ status }) => status === "fulfilled"),
    ).toHaveLength(1);

    const original = await prisma.rosterEntry.findFirstOrThrow({
      where: {
        accountId: ids.account,
        teamSeasonId: ids.home.teamSeason,
        playerId: player.id,
        status: "ACTIVE",
      },
    });
    const jerseyChanges = await Promise.allSettled([
      service.changeJersey(
        {
          accountId: ids.account,
          rosterEntryId: original.id,
          expectedRevision: 0,
          effectiveAt: "2026-02-01T00:00:00.000Z",
          jerseyNumber: "31",
        },
        actor("roster.manage"),
      ),
      service.changeJersey(
        {
          accountId: ids.account,
          rosterEntryId: original.id,
          expectedRevision: 0,
          effectiveAt: "2026-02-01T00:00:00.000Z",
          jerseyNumber: "32",
        },
        actor("roster.manage"),
      ),
    ]);
    expect(
      jerseyChanges.filter(({ status }) => status === "fulfilled"),
    ).toHaveLength(1);

    const replacement = await prisma.rosterEntry.findFirstOrThrow({
      where: {
        accountId: ids.account,
        teamSeasonId: ids.home.teamSeason,
        playerId: player.id,
        status: "ACTIVE",
      },
    });
    const deactivationRace = await Promise.allSettled([
      service.endRosterPeriod(
        {
          accountId: ids.account,
          rosterEntryId: replacement.id,
          expectedRevision: 0,
          endsAt: "2026-03-01T00:00:00.000Z",
        },
        actor("roster.manage"),
      ),
      service.changeJersey(
        {
          accountId: ids.account,
          rosterEntryId: replacement.id,
          expectedRevision: 0,
          effectiveAt: "2026-03-01T00:00:00.000Z",
          jerseyNumber: "41",
        },
        actor("roster.manage"),
      ),
    ]);
    expect(
      deactivationRace.filter(({ status }) => status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      await prisma.rosterEntry.count({
        where: {
          accountId: ids.account,
          teamSeasonId: ids.home.teamSeason,
          playerId: player.id,
          status: "ACTIVE",
        },
      }),
    ).toBeLessThanOrEqual(1);
  });

  it("ends and restarts non-overlapping roster periods with stable history", async () => {
    const player = await service.createPlayer(
      { accountId: ids.account, displayName: "Returning Player" },
      actor("roster.manage"),
    );
    const first = await service.addRosterPeriod(
      {
        accountId: ids.account,
        teamSeasonId: ids.home.teamSeason,
        playerId: player.id,
        startsAt: "2026-01-01T00:00:00.000Z",
        jerseyNumber: "12",
      },
      actor("roster.manage"),
    );
    await service.endRosterPeriod(
      {
        accountId: ids.account,
        rosterEntryId: first.id,
        expectedRevision: 0,
        endsAt: "2026-06-01T00:00:00.000Z",
      },
      actor("roster.manage"),
    );
    await expect(
      service.addRosterPeriod(
        {
          accountId: ids.account,
          teamSeasonId: ids.home.teamSeason,
          playerId: player.id,
          startsAt: "2026-05-01T00:00:00.000Z",
          jerseyNumber: "14",
        },
        actor("roster.manage"),
      ),
    ).rejects.toMatchObject({ code: "LIFECYCLE_CONFLICT" });
    const second = await service.addRosterPeriod(
      {
        accountId: ids.account,
        teamSeasonId: ids.home.teamSeason,
        playerId: player.id,
        startsAt: "2026-07-01T00:00:00.000Z",
        jerseyNumber: "13",
      },
      actor("roster.manage"),
    );

    const page = await service.listRosterHistory(
      {
        accountId: ids.account,
        playerId: player.id,
        limit: 10,
      },
      actor("roster.view"),
    );
    expect(page.items.map(({ id }) => id)).toEqual([second.id, first.id]);
    expect(page.items[1]?.endsAt?.toISOString()).toBe(
      "2026-06-01T00:00:00.000Z",
    );
  });

  it("fails closed across Accounts and under stale concurrent writes", async () => {
    await expect(
      service.listPlayers(
        { accountId: ids.account, limit: 10 },
        { ...actor("roster.view"), accountId: "another-account" },
      ),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_REQUIRED" });

    const team = await service.createTeam(
      {
        accountId: ids.account,
        displayName: "Concurrent Team",
        color: "#112233",
      },
      actor("team.manage"),
    );
    const outcomes = await Promise.allSettled([
      service.updateTeam(
        {
          accountId: ids.account,
          teamId: team.id,
          expectedRevision: 0,
          displayName: "Concurrent Winner A",
        },
        actor("team.manage"),
      ),
      service.updateTeam(
        {
          accountId: ids.account,
          teamId: team.id,
          expectedRevision: 0,
          displayName: "Concurrent Winner B",
        },
        actor("team.manage"),
      ),
    ]);

    expect(
      outcomes.filter(({ status }) => status === "fulfilled"),
    ).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === "rejected")).toHaveLength(
      1,
    );
    expect(outcomes.find(({ status }) => status === "rejected")).toMatchObject({
      reason: {
        code: expect.stringMatching(/^(STALE_REVISION|PERSISTENCE_CONFLICT)$/),
      },
    });
    expect(
      await prisma.securityAuditRecord.count({
        where: {
          accountId: ids.account,
          actorId: `${runPrefix}-management-service`,
          outcome: "SUCCEEDED",
        },
      }),
    ).toBeGreaterThan(0);
  });

  it("paginates management directories with stable value cursors", async () => {
    for (const displayName of [
      "Pagination Team C",
      "Pagination Team A",
      "Pagination Team B",
    ]) {
      await service.createTeam(
        { accountId: ids.account, displayName },
        actor("team.manage"),
      );
    }

    const all = await service.listTeams(
      { accountId: ids.account, limit: 100 },
      actor("team.view"),
    );
    const expected = all.items
      .filter(({ displayName }) => displayName.startsWith("Pagination Team"))
      .map(({ displayName }) => displayName);
    expect(expected).toEqual([
      "Pagination Team A",
      "Pagination Team B",
      "Pagination Team C",
    ]);

    const first = await service.listTeams(
      { accountId: ids.account, limit: 2 },
      actor("team.view"),
    );
    expect(first.next).not.toBeNull();
    const second = await service.listTeams(
      { accountId: ids.account, limit: 100, after: first.next },
      actor("team.view"),
    );
    expect(
      new Set([...first.items, ...second.items].map(({ id }) => id)).size,
    ).toBe(first.items.length + second.items.length);
  });

  it("serializes archive races against roster creation", async () => {
    const player = await service.createPlayer(
      { accountId: ids.account, displayName: "Archive Race Player" },
      actor("roster.manage"),
    );
    const playerRace = await Promise.allSettled([
      service.setPlayerArchived(
        {
          accountId: ids.account,
          playerId: player.id,
          expectedRevision: 0,
          archived: true,
        },
        actor("roster.manage"),
      ),
      service.addRosterPeriod(
        {
          accountId: ids.account,
          teamSeasonId: ids.away.teamSeason,
          playerId: player.id,
          startsAt: "2026-04-01T00:00:00.000Z",
          jerseyNumber: "55",
        },
        actor("roster.manage"),
      ),
    ]);
    expect(
      playerRace.filter(({ status }) => status === "fulfilled"),
    ).toHaveLength(1);
    const playerAfter = await prisma.player.findUniqueOrThrow({
      where: { id: player.id },
    });
    const activePlayerRosterCount = await prisma.rosterEntry.count({
      where: {
        accountId: ids.account,
        playerId: player.id,
        status: "ACTIVE",
      },
    });
    expect(playerAfter.archivedAt !== null && activePlayerRosterCount > 0).toBe(
      false,
    );

    const season = await service.createSeason(
      { accountId: ids.account, displayName: "Archive Race Season" },
      actor("season.manage"),
    );
    const participation = await service.addTeamSeason(
      {
        accountId: ids.account,
        teamId: ids.away.team,
        seasonId: season.id,
      },
      actor("season.manage"),
    );
    const seasonPlayer = await service.createPlayer(
      { accountId: ids.account, displayName: "Season Race Player" },
      actor("roster.manage"),
    );
    const seasonRace = await Promise.allSettled([
      service.transitionSeason(
        {
          accountId: ids.account,
          seasonId: season.id,
          expectedRevision: 0,
          status: "ARCHIVED",
        },
        actor("season.manage"),
      ),
      service.addRosterPeriod(
        {
          accountId: ids.account,
          teamSeasonId: participation.id,
          playerId: seasonPlayer.id,
          startsAt: "2026-05-01T00:00:00.000Z",
          jerseyNumber: "56",
        },
        actor("roster.manage"),
      ),
    ]);
    expect(
      seasonRace.filter(({ status }) => status === "fulfilled"),
    ).toHaveLength(1);
    const seasonAfter = await prisma.season.findUniqueOrThrow({
      where: { id: season.id },
    });
    const activeSeasonRosterCount = await prisma.rosterEntry.count({
      where: {
        accountId: ids.account,
        teamSeasonId: participation.id,
        status: "ACTIVE",
      },
    });
    expect(
      seasonAfter.status === "ARCHIVED" && activeSeasonRosterCount > 0,
    ).toBe(false);
  });
});
