import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GameSetupService } from "@/server/app/game-setup-service";
import { TeamSeasonRosterService } from "@/server/app/team-season-roster-service";
import { PrismaGameEventRepository } from "@/server/data/game-event-repository";
import { PrismaGameSetupRepository } from "@/server/data/game-setup-repository";
import { PrismaTeamSeasonRosterRepository } from "@/server/data/team-season-roster-repository";

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const prefix = `issue14-${process.pid}`;

integration("game setup persistence", () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl! }),
  });
  const setupRepository = new PrismaGameSetupRepository(prisma);
  const setupService = new GameSetupService(setupRepository);
  const rosterService = new TeamSeasonRosterService(
    new PrismaTeamSeasonRosterRepository(prisma),
  );
  const eventRepository = new PrismaGameEventRepository(prisma);
  const ids = {
    account: `${prefix}-account`,
    season: `${prefix}-season`,
    wrongSeason: `${prefix}-wrong-season`,
    homeTeam: `${prefix}-home-team`,
    awayTeam: `${prefix}-away-team`,
    homeTeamSeason: `${prefix}-home-team-season`,
    awayTeamSeason: `${prefix}-away-team-season`,
    ruleset: `${prefix}-ruleset`,
    homeBatter: `${prefix}-home-batter`,
    homePitcherOne: `${prefix}-home-pitcher-one`,
    homePitcherTwo: `${prefix}-home-pitcher-two`,
    homeBench: `${prefix}-home-bench`,
    awayBatter: `${prefix}-away-batter`,
    awayPitcher: `${prefix}-away-pitcher`,
  };

  const rosterId = (playerId: string) => `${playerId}-roster`;
  const setupActor = (
    gameId: string,
    capability: "game.setup" | "game.view" = "game.setup",
  ) => ({
    accountId: ids.account,
    actorId: `${prefix}-setup-service`,
    actorKind: "SERVICE" as const,
    actorUserId: null,
    membershipId: null,
    capability,
    scope: { kind: "GAME" as const, gameId },
    authorizedAt: "2026-07-29T19:00:00.000Z",
  });
  const createActor = (
    seasonId = ids.season,
    capability = "game.create" as const,
  ) => ({
    accountId: ids.account,
    actorId: `${prefix}-setup-service`,
    actorKind: "SERVICE" as const,
    actorUserId: null,
    membershipId: null,
    capability,
    scope: { kind: "SEASON" as const, seasonId },
    authorizedAt: "2026-07-29T19:00:00.000Z",
  });
  const rosterActor = () => ({
    accountId: ids.account,
    actorId: `${prefix}-roster-service`,
    actorKind: "SERVICE" as const,
    actorUserId: null,
    membershipId: null,
    capability: "roster.manage" as const,
    scope: { kind: "ACCOUNT" as const },
    authorizedAt: "2026-07-29T19:00:00.000Z",
  });
  const seasonActor = (seasonId: string) => ({
    accountId: ids.account,
    actorId: `${prefix}-season-service`,
    actorKind: "SERVICE" as const,
    actorUserId: null,
    membershipId: null,
    capability: "season.manage" as const,
    scope: { kind: "SEASON" as const, seasonId },
    authorizedAt: "2026-07-29T19:00:00.000Z",
  });

  const managedSlot = (
    playerId: string,
    battingOrder: number | null,
    defensivePosition: "PITCHER" | "SHORTSTOP" | "CENTER_FIELD" | null,
    isStartingPitcher = false,
  ) => ({
    kind: "MANAGED",
    playerId,
    rosterEntryId: rosterId(playerId),
    battingOrder,
    defensivePosition,
    isStartingPitcher,
  });

  const saveCommand = (
    gameId: string,
    expectedSetupRevision: number,
    clientSubmissionId: string,
    options: {
      externalAway?: boolean;
      secondPitcher?: boolean;
      incomplete?: boolean;
      homeBatterId?: string;
    } = {},
  ) => ({
    accountId: ids.account,
    gameId,
    expectedSetupRevision,
    clientSubmissionId,
    rulesetVersionId: ids.ruleset,
    scheduledAt: "2026-08-01T18:00:00.000Z",
    location: "Central Field",
    weatherCondition: "CLEAR",
    temperatureF: 78,
    sides: [
      {
        kind: "MANAGED",
        side: "HOME",
        teamSeasonId: ids.homeTeamSeason,
        lineup: [
          managedSlot(options.homeBatterId ?? ids.homeBatter, 1, "SHORTSTOP"),
          managedSlot(
            ids.homePitcherOne,
            null,
            options.secondPitcher ? null : "PITCHER",
            !options.secondPitcher,
          ),
          managedSlot(
            ids.homePitcherTwo,
            null,
            options.secondPitcher ? "PITCHER" : null,
            options.secondPitcher,
          ),
          managedSlot(ids.homeBench, null, null),
        ],
      },
      ...(options.incomplete
        ? []
        : options.externalAway
          ? [
              {
                kind: "EXTERNAL",
                side: "AWAY",
                displayName: "External Visitors",
                lineup: [
                  {
                    kind: "EXTERNAL",
                    displayName: "Visitor Batter",
                    jerseyNumber: "4",
                    battingOrder: 1,
                    defensivePosition: "CENTER_FIELD",
                    isStartingPitcher: false,
                  },
                  {
                    kind: "EXTERNAL",
                    displayName: "Visitor Pitcher",
                    jerseyNumber: "9",
                    battingOrder: null,
                    defensivePosition: "PITCHER",
                    isStartingPitcher: true,
                  },
                ],
              },
            ]
          : [
              {
                kind: "MANAGED",
                side: "AWAY",
                teamSeasonId: ids.awayTeamSeason,
                lineup: [
                  managedSlot(ids.awayBatter, 1, "CENTER_FIELD"),
                  managedSlot(ids.awayPitcher, null, "PITCHER", true),
                ],
              },
            ]),
    ],
  });

  beforeAll(async () => {
    await prisma.account.create({
      data: {
        id: ids.account,
        slug: ids.account,
        displayName: "Issue 14 Synthetic Account",
      },
    });
    await prisma.team.createMany({
      data: [
        {
          id: ids.homeTeam,
          accountId: ids.account,
          displayName: "Home Club",
        },
        {
          id: ids.awayTeam,
          accountId: ids.account,
          displayName: "Away Club",
        },
      ],
    });
    await prisma.season.createMany({
      data: [
        {
          id: ids.season,
          accountId: ids.account,
          displayName: "2026",
          status: "ACTIVE",
        },
        {
          id: ids.wrongSeason,
          accountId: ids.account,
          displayName: "Wrong Season",
        },
      ],
    });
    await prisma.teamSeason.createMany({
      data: [
        {
          id: ids.homeTeamSeason,
          accountId: ids.account,
          teamId: ids.homeTeam,
          seasonId: ids.season,
        },
        {
          id: ids.awayTeamSeason,
          accountId: ids.account,
          teamId: ids.awayTeam,
          seasonId: ids.season,
        },
      ],
    });
    const players = [
      ids.homeBatter,
      ids.homePitcherOne,
      ids.homePitcherTwo,
      ids.homeBench,
      ids.awayBatter,
      ids.awayPitcher,
    ];
    await prisma.player.createMany({
      data: players.map((id) => ({
        id,
        accountId: ids.account,
        displayName: id.split("-").slice(-3).join(" "),
      })),
    });
    await prisma.rosterEntry.createMany({
      data: players.map((playerId) => ({
        id: rosterId(playerId),
        accountId: ids.account,
        playerId,
        teamSeasonId: playerId.includes("-away-")
          ? ids.awayTeamSeason
          : ids.homeTeamSeason,
        startsAt: new Date("2026-01-01T00:00:00.000Z"),
        jerseyNumber: "7",
      })),
    });
    await prisma.rulesetVersion.create({
      data: {
        id: ids.ruleset,
        accountId: ids.account,
        name: "issue-14-rules",
        version: 1,
        configuration: {
          scheduledInnings: 7,
          maximumLineupSize: 20,
          allowDefensiveOnly: true,
        },
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function createGame() {
    return setupService.createDraftGame(
      {
        accountId: ids.account,
        seasonId: ids.season,
        managedTeamSeasonId: ids.homeTeamSeason,
        scheduledAt: "2026-08-01T18:00:00.000Z",
        location: "Central Field",
        weatherCondition: "CLEAR",
        temperatureF: 78,
      },
      createActor(),
    );
  }

  it("supersedes pregame setup, starts from the exact ready revision, and preserves history", async () => {
    const game = await createGame();
    const revisionOne = await setupService.saveSetupRevision(
      saveCommand(game.id, 0, "history-r1"),
      setupActor(game.id),
    );
    const revisionOneBefore = await prisma.gameSetupSnapshot.findUniqueOrThrow({
      where: { id: revisionOne.setup.id },
      include: {
        teamSnapshots: { orderBy: { side: "asc" } },
        lineupSlots: { orderBy: { id: "asc" } },
      },
    });
    const retry = await setupService.saveSetupRevision(
      saveCommand(game.id, 0, "history-r1"),
      setupActor(game.id),
    );
    expect(retry.idempotentReplay).toBe(true);
    expect(retry.setup.id).toBe(revisionOne.setup.id);

    const revisionTwo = await setupService.saveSetupRevision(
      saveCommand(game.id, 1, "history-r2", { secondPitcher: true }),
      setupActor(game.id),
    );
    const ready = await setupService.markSetupReady(
      {
        accountId: ids.account,
        gameId: game.id,
        setupSnapshotId: revisionTwo.setup.id,
        expectedSetupRevision: 2,
      },
      setupActor(game.id),
    );
    expect(ready).toMatchObject({
      setupSnapshotId: revisionTwo.setup.id,
      setupRevision: 2,
      idempotentReplay: false,
      game: { status: "READY", readySetupSnapshotId: revisionTwo.setup.id },
    });
    const readyRetry = await setupService.markSetupReady(
      {
        accountId: ids.account,
        gameId: game.id,
        setupSnapshotId: revisionTwo.setup.id,
        expectedSetupRevision: 2,
      },
      setupActor(game.id),
    );
    expect(readyRetry.idempotentReplay).toBe(true);
    await expect(
      prisma.gameSetupSnapshot.update({
        where: { id: revisionTwo.setup.id },
        data: { location: "Rewritten Field" },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.lineupSlotSnapshot.update({
        where: { id: revisionTwo.setup.lineupSlots[0]!.id },
        data: { battingOrder: 9 },
      }),
    ).rejects.toThrow();

    await expect(
      eventRepository.accept({
        accountId: ids.account,
        gameId: game.id,
        setupSnapshotId: revisionOne.setup.id,
        expectedRevision: 0,
        eventId: `${game.id}-wrong-start`,
        playTransactionId: `${game.id}-wrong-start-play`,
        clientSubmissionId: `${game.id}-wrong-start-submit`,
        recordedAt: "2026-08-01T18:00:00.000Z",
        actor: {
          accountId: ids.account,
          actorId: `${prefix}-score-service`,
          actorKind: "SERVICE",
          actorUserId: null,
          capability: "game.score",
          scope: { kind: "GAME", gameId: game.id },
          authorizedAt: "2026-08-01T17:59:00.000Z",
        },
        body: { eventType: "GameStarted", payload: {} },
      }),
    ).rejects.toMatchObject({ code: "SETUP_NOT_READY" });

    await eventRepository.accept({
      accountId: ids.account,
      gameId: game.id,
      setupSnapshotId: revisionTwo.setup.id,
      expectedRevision: 0,
      eventId: `${game.id}-start`,
      playTransactionId: `${game.id}-start-play`,
      clientSubmissionId: `${game.id}-start-submit`,
      recordedAt: "2026-08-01T18:00:00.000Z",
      actor: {
        accountId: ids.account,
        actorId: `${prefix}-score-service`,
        actorKind: "SERVICE",
        actorUserId: null,
        capability: "game.score",
        scope: { kind: "GAME", gameId: game.id },
        authorizedAt: "2026-08-01T17:59:00.000Z",
      },
      body: { eventType: "GameStarted", payload: {} },
    });
    await expect(
      setupService.saveSetupRevision(
        saveCommand(game.id, 2, "history-r3"),
        setupActor(game.id),
      ),
    ).rejects.toMatchObject({ code: "IMMUTABLE_SETUP" });

    await eventRepository.accept({
      accountId: ids.account,
      gameId: game.id,
      setupSnapshotId: revisionTwo.setup.id,
      expectedRevision: 1,
      eventId: `${game.id}-substitution`,
      playTransactionId: `${game.id}-substitution-play`,
      clientSubmissionId: `${game.id}-substitution-submit`,
      recordedAt: "2026-08-01T18:01:00.000Z",
      actor: {
        accountId: ids.account,
        actorId: `${prefix}-score-service`,
        actorKind: "SERVICE",
        actorUserId: null,
        capability: "game.score",
        scope: { kind: "GAME", gameId: game.id },
        authorizedAt: "2026-08-01T17:59:00.000Z",
      },
      body: {
        eventType: "DefensiveSubstitutionMade",
        payload: {
          side: "HOME",
          outgoingPlayerId: ids.homeBatter,
          incomingPlayerId: ids.homeBench,
          position: "SHORTSTOP",
        },
      },
    });
    const replayBeforeRosterEdit = await eventRepository.replay(
      ids.account,
      game.id,
      revisionTwo.setup.id,
    );
    expect(replayBeforeRosterEdit.state).toMatchObject({
      status: "IN_PROGRESS",
      sourceRevision: 2,
    });
    expect(
      replayBeforeRosterEdit.state.lineups.HOME.find(
        ({ playerId }) => playerId === ids.homeBench,
      ),
    ).toMatchObject({ active: true, battingOrder: 1, position: "SHORTSTOP" });

    await rosterService.updatePlayer(
      {
        accountId: ids.account,
        playerId: ids.homeBatter,
        expectedRevision: 0,
        displayName: "Current Roster Label",
      },
      rosterActor(),
    );
    expect(
      await eventRepository.replay(ids.account, game.id, revisionTwo.setup.id),
    ).toEqual(replayBeforeRosterEdit);
    expect(
      await prisma.gameSetupSnapshot.findUniqueOrThrow({
        where: { id: revisionOne.setup.id },
        include: {
          teamSnapshots: { orderBy: { side: "asc" } },
          lineupSlots: { orderBy: { id: "asc" } },
        },
      }),
    ).toEqual(revisionOneBefore);
  });

  it("supports a managed team against a snapshot-only external opponent", async () => {
    const game = await createGame();
    const candidates = await setupService.listRosterCandidates(
      {
        accountId: ids.account,
        gameId: game.id,
        teamSeasonId: ids.homeTeamSeason,
        limit: 2,
      },
      setupActor(game.id),
    );
    expect(candidates.items).toHaveLength(2);
    expect(candidates.next).not.toBeNull();
    expect(candidates.items.map(({ player }) => player.displayName)).toEqual(
      [...candidates.items]
        .map(({ player }) => player.displayName)
        .sort((left, right) => left.localeCompare(right)),
    );
    const revision = await setupService.saveSetupRevision(
      saveCommand(game.id, 0, "external-r1", { externalAway: true }),
      setupActor(game.id),
    );
    await setupService.markSetupReady(
      {
        accountId: ids.account,
        gameId: game.id,
        setupSnapshotId: revision.setup.id,
        expectedSetupRevision: 1,
      },
      setupActor(game.id),
    );
    const external = revision.setup.teamSnapshots.find(
      ({ side }) => side === "AWAY",
    );
    expect(external).toMatchObject({
      displayName: "External Visitors",
      isAccountTeam: false,
      teamId: null,
      teamSeasonId: null,
    });
    expect(
      revision.setup.lineupSlots
        .filter(({ gameTeamSnapshotId }) => gameTeamSnapshotId === external?.id)
        .every(
          ({ playerId, rosterEntryId }) =>
            playerId === null && rosterEntryId === null,
        ),
    ).toBe(true);
  });

  it("rejects incomplete, stale, cross-Account, and season-mismatched setup", async () => {
    await expect(
      setupService.createDraftGame(
        {
          accountId: ids.account,
          seasonId: ids.wrongSeason,
          managedTeamSeasonId: ids.homeTeamSeason,
          scheduledAt: "2026-08-01T18:00:00.000Z",
        },
        createActor(ids.wrongSeason),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND_OR_INACCESSIBLE" });

    const game = await createGame();
    await expect(
      setupService.saveSetupRevision(saveCommand(game.id, 0, "wrong-account"), {
        ...setupActor(game.id),
        accountId: "another-account",
      }),
    ).rejects.toMatchObject({ code: "ACCOUNT_MISMATCH" });
    const incomplete = await setupService.saveSetupRevision(
      saveCommand(game.id, 0, "incomplete", { incomplete: true }),
      setupActor(game.id),
    );
    await expect(
      setupService.markSetupReady(
        {
          accountId: ids.account,
          gameId: game.id,
          setupSnapshotId: incomplete.setup.id,
          expectedSetupRevision: 1,
        },
        setupActor(game.id),
      ),
    ).rejects.toMatchObject({ code: "SETUP_INCOMPLETE" });
    await expect(
      setupService.saveSetupRevision(
        saveCommand(game.id, 0, "stale"),
        setupActor(game.id),
      ),
    ).rejects.toMatchObject({ code: "STALE_SETUP_REVISION" });
  });

  it("serializes competing editors and exact-start supersession", async () => {
    const game = await createGame();
    const edits = await Promise.allSettled([
      setupService.saveSetupRevision(
        saveCommand(game.id, 0, "editor-a"),
        setupActor(game.id),
      ),
      setupService.saveSetupRevision(
        {
          ...saveCommand(game.id, 0, "editor-b"),
          location: "Alternate Field",
        },
        setupActor(game.id),
      ),
    ]);
    expect(edits.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    const current = await setupService.loadCurrentSetup(
      { accountId: ids.account, gameId: game.id },
      { ...setupActor(game.id, "game.view"), capability: "game.view" },
    );
    expect(current.game.setupRevision).toBe(1);
    expect(current.setup?.setupRevision).toBe(1);

    const readyCommand = {
      accountId: ids.account,
      gameId: game.id,
      setupSnapshotId: current.setup!.id,
      expectedSetupRevision: 1,
    };
    const readiness = await Promise.allSettled([
      setupService.markSetupReady(readyCommand, setupActor(game.id)),
      setupService.markSetupReady(readyCommand, setupActor(game.id)),
    ]);
    expect(
      readiness.filter(({ status }) => status === "fulfilled").length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      await prisma.game.findUniqueOrThrow({ where: { id: game.id } }),
    ).toMatchObject({
      status: "READY",
      readySetupSnapshotId: current.setup!.id,
    });
    const start = eventRepository.accept({
      accountId: ids.account,
      gameId: game.id,
      setupSnapshotId: current.setup!.id,
      expectedRevision: 0,
      eventId: `${game.id}-race-start`,
      playTransactionId: `${game.id}-race-start-play`,
      clientSubmissionId: `${game.id}-race-start-submit`,
      recordedAt: "2026-08-01T18:00:00.000Z",
      actor: {
        accountId: ids.account,
        actorId: `${prefix}-race-score`,
        actorKind: "SERVICE",
        actorUserId: null,
        capability: "game.score",
        scope: { kind: "GAME", gameId: game.id },
        authorizedAt: "2026-08-01T17:59:00.000Z",
      },
      body: { eventType: "GameStarted", payload: {} },
    });
    const supersede = setupService.saveSetupRevision(
      saveCommand(game.id, 1, "race-supersede", { secondPitcher: true }),
      setupActor(game.id),
    );
    const race = await Promise.allSettled([start, supersede]);
    expect(race.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const finalGame = await prisma.game.findUniqueOrThrow({
      where: { id: game.id },
    });
    expect(
      (finalGame.status === "IN_PROGRESS" &&
        finalGame.readySetupSnapshotId === current.setup!.id) ||
        (finalGame.status === "DRAFT" &&
          finalGame.setupRevision === 2 &&
          finalGame.readySetupSnapshotId === null),
    ).toBe(true);
  });

  it("serializes readiness against roster deactivation and season closure against creation", async () => {
    const playerArchiveGame = await createGame();
    const playerArchiveRevision = await setupService.saveSetupRevision(
      saveCommand(playerArchiveGame.id, 0, "player-archive-race"),
      setupActor(playerArchiveGame.id),
    );
    const homeBatter = await prisma.player.findUniqueOrThrow({
      where: { id: ids.homeBatter },
    });
    const playerArchiveRace = await Promise.allSettled([
      setupService.markSetupReady(
        {
          accountId: ids.account,
          gameId: playerArchiveGame.id,
          setupSnapshotId: playerArchiveRevision.setup.id,
          expectedSetupRevision: 1,
        },
        setupActor(playerArchiveGame.id),
      ),
      rosterService.setPlayerArchived(
        {
          accountId: ids.account,
          playerId: ids.homeBatter,
          expectedRevision: homeBatter.revision,
          archived: true,
        },
        rosterActor(),
      ),
    ]);
    expect(
      playerArchiveRace.filter(({ status }) => status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      await prisma.player.findUniqueOrThrow({
        where: { id: ids.homeBatter },
      }),
    ).toMatchObject({ archivedAt: null });

    const racePlayer = await rosterService.createPlayer(
      { accountId: ids.account, displayName: "Readiness Race Batter" },
      rosterActor(),
    );
    const raceRoster = await rosterService.addRosterPeriod(
      {
        accountId: ids.account,
        teamSeasonId: ids.homeTeamSeason,
        playerId: racePlayer.id,
        startsAt: "2026-01-01T00:00:00.000Z",
        jerseyNumber: "33",
      },
      rosterActor(),
    );
    const game = await createGame();
    const revision = await setupService.saveSetupRevision(
      {
        ...saveCommand(game.id, 0, "roster-race", {
          homeBatterId: racePlayer.id,
        }),
        sides: saveCommand(game.id, 0, "unused", {
          homeBatterId: racePlayer.id,
        }).sides.map((side) =>
          side.kind !== "MANAGED" || side.side !== "HOME"
            ? side
            : {
                ...side,
                lineup: side.lineup.map((slot) =>
                  "playerId" in slot && slot.playerId === racePlayer.id
                    ? { ...slot, rosterEntryId: raceRoster.id }
                    : slot,
                ),
              },
        ),
      },
      setupActor(game.id),
    );
    const readinessRace = await Promise.allSettled([
      setupService.markSetupReady(
        {
          accountId: ids.account,
          gameId: game.id,
          setupSnapshotId: revision.setup.id,
          expectedSetupRevision: 1,
        },
        setupActor(game.id),
      ),
      rosterService.endRosterPeriod(
        {
          accountId: ids.account,
          rosterEntryId: raceRoster.id,
          expectedRevision: 0,
          endsAt: "2026-07-01T00:00:00.000Z",
        },
        rosterActor(),
      ),
    ]);
    expect(
      readinessRace.filter(({ status }) => status === "fulfilled"),
    ).toHaveLength(1);
    const gameAfter = await prisma.game.findUniqueOrThrow({
      where: { id: game.id },
    });
    const rosterAfter = await prisma.rosterEntry.findUniqueOrThrow({
      where: { id: raceRoster.id },
    });
    expect(
      gameAfter.status === "READY" && rosterAfter.status !== "ACTIVE",
    ).toBe(false);

    const season = await rosterService.createSeason(
      { accountId: ids.account, displayName: "Creation Race Season" },
      {
        ...seasonActor(ids.season),
        scope: { kind: "ACCOUNT" as const },
      },
    );
    const participation = await rosterService.addTeamSeason(
      {
        accountId: ids.account,
        teamId: ids.homeTeam,
        seasonId: season.id,
      },
      seasonActor(season.id),
    );
    const closureRace = await Promise.allSettled([
      rosterService.transitionSeason(
        {
          accountId: ids.account,
          seasonId: season.id,
          expectedRevision: 0,
          status: "ARCHIVED",
        },
        seasonActor(season.id),
      ),
      setupService.createDraftGame(
        {
          accountId: ids.account,
          seasonId: season.id,
          managedTeamSeasonId: participation.id,
          scheduledAt: "2026-08-01T18:00:00.000Z",
        },
        createActor(season.id),
      ),
    ]);
    expect(
      closureRace.filter(({ status }) => status === "fulfilled"),
    ).toHaveLength(1);
    const seasonAfter = await prisma.season.findUniqueOrThrow({
      where: { id: season.id },
    });
    const gameCount = await prisma.game.count({
      where: { accountId: ids.account, seasonId: season.id },
    });
    expect(seasonAfter.status === "ARCHIVED" && gameCount > 0).toBe(false);
  });
});
