import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  PrismaGameEventRepository,
  type AcceptEventCommand,
} from "@/server/data/game-event-repository";

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const runPrefix = `issue10-${process.pid}`;

integration("PrismaGameEventRepository", () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl! }),
  });
  const repository = new PrismaGameEventRepository(prisma);

  const actor = {
    accountId: `${runPrefix}-account`,
    actorId: `${runPrefix}-service`,
    actorKind: "SERVICE" as const,
    actorUserId: null,
    capability: "game.score" as const,
    scope: { kind: "GAME" as const, gameId: `${runPrefix}-game` },
    authorizedAt: "2026-07-29T15:59:59.000Z",
  };
  const startActor = {
    ...actor,
    capability: "game.start" as const,
  };

  const command = (
    overrides: Partial<AcceptEventCommand> = {},
  ): AcceptEventCommand => {
    const body: AcceptEventCommand["body"] = overrides.body ?? {
      eventType: "GameStarted",
      payload: {},
    };
    return {
      accountId: `${runPrefix}-account`,
      gameId: `${runPrefix}-game`,
      setupSnapshotId: `${runPrefix}-setup`,
      expectedRevision: 0,
      eventId: `${runPrefix}-event-start`,
      playTransactionId: `${runPrefix}-play-start`,
      clientSubmissionId: `${runPrefix}-submit-start`,
      recordedAt: "2026-07-29T16:00:00.000Z",
      actor: body.eventType === "GameStarted" ? startActor : actor,
      body,
      ...overrides,
    };
  };

  beforeAll(async () => {
    await prisma.account.create({
      data: {
        id: `${runPrefix}-account`,
        slug: `${runPrefix}-account`,
        displayName: "Synthetic Issue 10",
      },
    });
    await prisma.team.createMany({
      data: [
        {
          id: `${runPrefix}-home`,
          accountId: `${runPrefix}-account`,
          displayName: "Synthetic Home",
        },
        {
          id: `${runPrefix}-away`,
          accountId: `${runPrefix}-account`,
          displayName: "Synthetic Away",
        },
      ],
    });
    await prisma.season.create({
      data: {
        id: `${runPrefix}-season`,
        accountId: `${runPrefix}-account`,
        displayName: "Synthetic Season",
      },
    });
    await prisma.teamSeason.createMany({
      data: [
        {
          id: `${runPrefix}-home-season`,
          accountId: `${runPrefix}-account`,
          teamId: `${runPrefix}-home`,
          seasonId: `${runPrefix}-season`,
        },
        {
          id: `${runPrefix}-away-season`,
          accountId: `${runPrefix}-account`,
          teamId: `${runPrefix}-away`,
          seasonId: `${runPrefix}-season`,
        },
      ],
    });
    await prisma.player.createMany({
      data: [
        {
          id: `${runPrefix}-away-batter`,
          accountId: `${runPrefix}-account`,
          displayName: "Synthetic Away Batter",
        },
        {
          id: `${runPrefix}-away-pitcher`,
          accountId: `${runPrefix}-account`,
          displayName: "Synthetic Away Pitcher",
        },
        {
          id: `${runPrefix}-home-batter`,
          accountId: `${runPrefix}-account`,
          displayName: "Synthetic Home Batter",
        },
        {
          id: `${runPrefix}-home-pitcher`,
          accountId: `${runPrefix}-account`,
          displayName: "Synthetic Home Pitcher",
        },
      ],
    });
    await prisma.rosterEntry.createMany({
      data: [
        {
          id: `${runPrefix}-away-batter-roster`,
          accountId: `${runPrefix}-account`,
          playerId: `${runPrefix}-away-batter`,
          teamSeasonId: `${runPrefix}-away-season`,
        },
        {
          id: `${runPrefix}-away-pitcher-roster`,
          accountId: `${runPrefix}-account`,
          playerId: `${runPrefix}-away-pitcher`,
          teamSeasonId: `${runPrefix}-away-season`,
        },
        {
          id: `${runPrefix}-home-batter-roster`,
          accountId: `${runPrefix}-account`,
          playerId: `${runPrefix}-home-batter`,
          teamSeasonId: `${runPrefix}-home-season`,
        },
        {
          id: `${runPrefix}-home-pitcher-roster`,
          accountId: `${runPrefix}-account`,
          playerId: `${runPrefix}-home-pitcher`,
          teamSeasonId: `${runPrefix}-home-season`,
        },
      ],
    });
    await prisma.rulesetVersion.create({
      data: {
        id: `${runPrefix}-ruleset`,
        accountId: `${runPrefix}-account`,
        name: "synthetic",
        version: 1,
        configuration: { scheduledInnings: 9 },
      },
    });
    await prisma.game.create({
      data: {
        id: `${runPrefix}-game`,
        accountId: `${runPrefix}-account`,
        seasonId: `${runPrefix}-season`,
        teamSeasonId: `${runPrefix}-home-season`,
      },
    });
    await prisma.gameSetupSnapshot.create({
      data: {
        id: `${runPrefix}-setup`,
        accountId: `${runPrefix}-account`,
        gameId: `${runPrefix}-game`,
        setupRevision: 1,
        rulesetVersionId: `${runPrefix}-ruleset`,
        scheduledInnings: 9,
      },
    });
    await prisma.gameTeamSnapshot.createMany({
      data: [
        {
          id: `${runPrefix}-home-side`,
          accountId: `${runPrefix}-account`,
          gameId: `${runPrefix}-game`,
          setupSnapshotId: `${runPrefix}-setup`,
          side: "HOME",
          teamId: `${runPrefix}-home`,
          teamSeasonId: `${runPrefix}-home-season`,
          displayName: "Synthetic Home",
          isAccountTeam: true,
        },
        {
          id: `${runPrefix}-away-side`,
          accountId: `${runPrefix}-account`,
          gameId: `${runPrefix}-game`,
          setupSnapshotId: `${runPrefix}-setup`,
          side: "AWAY",
          teamId: `${runPrefix}-away`,
          teamSeasonId: `${runPrefix}-away-season`,
          displayName: "Synthetic Away",
          isAccountTeam: true,
        },
      ],
    });
    await prisma.lineupSlotSnapshot.createMany({
      data: [
        {
          id: `${runPrefix}-away-batter-slot`,
          accountId: `${runPrefix}-account`,
          gameId: `${runPrefix}-game`,
          setupSnapshotId: `${runPrefix}-setup`,
          gameTeamSnapshotId: `${runPrefix}-away-side`,
          playerId: `${runPrefix}-away-batter`,
          rosterEntryId: `${runPrefix}-away-batter-roster`,
          displayName: "Synthetic Away Batter",
          battingOrder: 1,
          defensivePosition: "SHORTSTOP",
        },
        {
          id: `${runPrefix}-away-pitcher-slot`,
          accountId: `${runPrefix}-account`,
          gameId: `${runPrefix}-game`,
          setupSnapshotId: `${runPrefix}-setup`,
          gameTeamSnapshotId: `${runPrefix}-away-side`,
          playerId: `${runPrefix}-away-pitcher`,
          rosterEntryId: `${runPrefix}-away-pitcher-roster`,
          displayName: "Synthetic Away Pitcher",
          defensivePosition: "PITCHER",
          isStartingPitcher: true,
        },
        {
          id: `${runPrefix}-home-batter-slot`,
          accountId: `${runPrefix}-account`,
          gameId: `${runPrefix}-game`,
          setupSnapshotId: `${runPrefix}-setup`,
          gameTeamSnapshotId: `${runPrefix}-home-side`,
          playerId: `${runPrefix}-home-batter`,
          rosterEntryId: `${runPrefix}-home-batter-roster`,
          displayName: "Synthetic Home Batter",
          battingOrder: 1,
          defensivePosition: "SHORTSTOP",
        },
        {
          id: `${runPrefix}-home-pitcher-slot`,
          accountId: `${runPrefix}-account`,
          gameId: `${runPrefix}-game`,
          setupSnapshotId: `${runPrefix}-setup`,
          gameTeamSnapshotId: `${runPrefix}-home-side`,
          playerId: `${runPrefix}-home-pitcher`,
          rosterEntryId: `${runPrefix}-home-pitcher-roster`,
          displayName: "Synthetic Home Pitcher",
          defensivePosition: "PITCHER",
          isStartingPitcher: true,
        },
      ],
    });
    await prisma.game.update({
      where: { id: `${runPrefix}-game` },
      data: {
        status: "READY",
        setupRevision: 1,
        readySetupSnapshotId: `${runPrefix}-setup`,
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("accepts atomically and returns the same event for an exact retry", async () => {
    const first = await repository.accept(command());
    const retry = await repository.accept(command());
    expect(first.idempotentReplay).toBe(false);
    expect(retry).toEqual({ event: first.event, idempotentReplay: true });
    expect(first.event.acceptedAt).not.toBe(first.event.recordedAt);
    expect(
      (
        await repository.replay(
          `${runPrefix}-account`,
          `${runPrefix}-game`,
          `${runPrefix}-setup`,
        )
      ).state.status,
    ).toBe("IN_PROGRESS");
  });

  it("rejects changed idempotency input and Account mismatch safely", async () => {
    await expect(
      repository.accept(
        command({
          body: {
            eventType: "GameSuspended",
            payload: { reasonCode: "different" },
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "DUPLICATE_IDEMPOTENCY_KEY" });
    await expect(
      repository.accept(
        command({
          accountId: "other-account",
        }),
      ),
    ).rejects.toMatchObject({ code: "ACCOUNT_MISMATCH" });
  });

  it("allows one concurrent revision writer and preserves append-only rows", async () => {
    const play = (suffix: string) =>
      command({
        expectedRevision: 1,
        eventId: `${runPrefix}-event-${suffix}`,
        playTransactionId: `${runPrefix}-play-${suffix}`,
        clientSubmissionId: `${runPrefix}-submit-${suffix}`,
        body: {
          eventType: "PlateAppearanceRecorded",
          payload: {
            batterId: `${runPrefix}-away-batter`,
            pitcherId: `${runPrefix}-home-pitcher`,
            outcome: "SINGLE",
            battedBall: "LINE_DRIVE",
            movements: [
              {
                runnerId: `${runPrefix}-away-batter`,
                from: "BATTER",
                to: "FIRST",
                cause: "HIT",
                forced: false,
                responsiblePitcherId: `${runPrefix}-home-pitcher`,
              },
            ],
            fieldingCredits: [],
          },
        },
      });
    const outcomes = await Promise.allSettled([
      repository.accept(play("concurrent-a")),
      repository.accept(play("concurrent-b")),
    ]);
    expect(
      outcomes.filter(({ status }) => status === "fulfilled"),
    ).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === "rejected")).toHaveLength(
      1,
    );

    const accepted = await prisma.sourceEvent.findFirstOrThrow({
      where: { gameId: `${runPrefix}-game`, acceptedRevision: 2 },
    });
    await expect(
      prisma.sourceEvent.update({
        where: { id: accepted.id },
        data: { eventType: "GameCompleted" },
      }),
    ).rejects.toBeTruthy();
    await expect(
      prisma.sourceEvent.delete({ where: { id: accepted.id } }),
    ).rejects.toBeTruthy();
  });

  it("persists append-only correction relationships and strict corrected replay", async () => {
    const original = await prisma.sourceEvent.findFirstOrThrow({
      where: { gameId: `${runPrefix}-game`, acceptedRevision: 2 },
    });
    const correctingActor = {
      ...actor,
      capability: "game.correct" as const,
    };
    const correction = await repository.accept(
      command({
        expectedRevision: 2,
        eventId: `${runPrefix}-event-correction`,
        playTransactionId: `${runPrefix}-play-correction`,
        clientSubmissionId: `${runPrefix}-submit-correction`,
        actor: correctingActor,
        body: {
          eventType: "CorrectionApplied",
          payload: {
            policy: "REPLACE_JUDGMENT",
            targetEventIds: [original.id],
            replacements: [
              {
                id: `${runPrefix}-replacement-walk`,
                order: 0,
                targetEventId: original.id,
                body: {
                  eventType: "PlateAppearanceRecorded",
                  payload: {
                    batterId: `${runPrefix}-away-batter`,
                    pitcherId: `${runPrefix}-home-pitcher`,
                    outcome: "WALK",
                    battedBall: null,
                    movements: [
                      {
                        runnerId: `${runPrefix}-away-batter`,
                        from: "BATTER",
                        to: "FIRST",
                        cause: "CORRECTION",
                        forced: false,
                        responsiblePitcherId: `${runPrefix}-home-pitcher`,
                      },
                    ],
                    fieldingCredits: [],
                  },
                },
              },
            ],
            reasonCode: "SCORER_REVIEW",
          },
        },
      }),
    );
    expect(correction.event.acceptedRevision).toBe(3);
    expect(
      await prisma.eventCorrection.count({
        where: {
          accountId: `${runPrefix}-account`,
          gameId: `${runPrefix}-game`,
          correctionEventId: correction.event.id,
          targetEventId: original.id,
        },
      }),
    ).toBe(1);
    const replayed = await repository.replay(
      `${runPrefix}-account`,
      `${runPrefix}-game`,
      `${runPrefix}-setup`,
    );
    expect(replayed.state.status).toBe("IN_PROGRESS");
    expect(replayed.state.bases.FIRST).toBe(`${runPrefix}-away-batter`);
    expect(
      (
        await prisma.sourceEvent.findUniqueOrThrow({
          where: { id: original.id },
        })
      ).eventType,
    ).toBe("PlateAppearanceRecorded");

    const reversed = await repository.accept(
      command({
        expectedRevision: 3,
        eventId: `${runPrefix}-event-correction-reversal`,
        playTransactionId: `${runPrefix}-play-correction-reversal`,
        clientSubmissionId: `${runPrefix}-submit-correction-reversal`,
        actor: correctingActor,
        body: {
          eventType: "CorrectionApplied",
          payload: {
            policy: "REVERSE_EVENTS",
            targetEventIds: [correction.event.id],
            replacements: [],
            reasonCode: "RESTORE_ORIGINAL",
          },
        },
      }),
    );
    expect(reversed.event.acceptedRevision).toBe(4);
    expect(
      (
        await repository.replay(
          `${runPrefix}-account`,
          `${runPrefix}-game`,
          `${runPrefix}-setup`,
        )
      ).state.bases.FIRST,
    ).toBe(`${runPrefix}-away-batter`);
  });

  it("deduplicates a concurrent exact retry and does not reserve failed input", async () => {
    const suspend = command({
      expectedRevision: 4,
      eventId: `${runPrefix}-event-suspend`,
      playTransactionId: `${runPrefix}-play-suspend`,
      clientSubmissionId: `${runPrefix}-submit-suspend`,
      body: {
        eventType: "GameSuspended",
        payload: { reasonCode: "WEATHER" },
      },
    });
    const retries = await Promise.all([
      repository.accept(suspend),
      repository.accept(suspend),
    ]);
    expect(
      retries.map(({ idempotentReplay }) => idempotentReplay).sort(),
    ).toEqual([false, true]);
    expect(retries[0]!.event).toEqual(retries[1]!.event);
    expect((await repository.accept(suspend)).idempotentReplay).toBe(true);

    const failedKey = `${runPrefix}-submit-failed-then-retry`;
    await expect(
      repository.accept(
        command({
          expectedRevision: 5,
          eventId: `${runPrefix}-event-failed-then-retry`,
          playTransactionId: `${runPrefix}-play-failed-then-retry`,
          clientSubmissionId: failedKey,
          body: {
            eventType: "PlateAppearanceRecorded",
            payload: {
              batterId: `${runPrefix}-away-batter`,
              pitcherId: `${runPrefix}-home-pitcher`,
              outcome: "SINGLE",
              battedBall: "LINE_DRIVE",
              movements: [
                {
                  runnerId: `${runPrefix}-away-batter`,
                  from: "BATTER",
                  to: "FIRST",
                  cause: "HIT",
                  forced: false,
                  responsiblePitcherId: `${runPrefix}-home-pitcher`,
                },
              ],
              fieldingCredits: [],
            },
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_LIFECYCLE_TRANSITION" });
    expect(
      await prisma.playTransaction.count({
        where: { clientSubmissionId: failedKey },
      }),
    ).toBe(0);
    const resumed = await repository.accept(
      command({
        expectedRevision: 5,
        eventId: `${runPrefix}-event-failed-then-retry`,
        playTransactionId: `${runPrefix}-play-failed-then-retry`,
        clientSubmissionId: failedKey,
        body: { eventType: "GameResumed", payload: {} },
      }),
    );
    expect(resumed.event.acceptedRevision).toBe(6);
  });

  it("persists and reloads one atomic schema-v3 runner play", async () => {
    const accepted = await repository.accept(
      command({
        expectedRevision: 6,
        eventId: `${runPrefix}-event-runner-play`,
        playTransactionId: `${runPrefix}-play-runner-play`,
        clientSubmissionId: `${runPrefix}-submit-runner-play`,
        body: {
          eventType: "RunnerPlayRecorded",
          payload: {
            playType: "WILD_PITCH",
            movements: [
              {
                runnerId: `${runPrefix}-away-batter`,
                from: "FIRST",
                to: "SECOND",
                cause: "WILD_PITCH",
                forced: false,
                responsiblePitcherId: `${runPrefix}-home-pitcher`,
              },
            ],
            fieldingCredits: [],
            responsibleFielderId: null,
          },
        },
      }),
    );
    expect(accepted.event).toMatchObject({
      schemaVersion: 3,
      eventType: "RunnerPlayRecorded",
      acceptedRevision: 7,
    });
    const reloaded = await repository.replay(
      `${runPrefix}-account`,
      `${runPrefix}-game`,
      `${runPrefix}-setup`,
    );
    expect(reloaded.state).toMatchObject({
      sourceRevision: 7,
      bases: {
        FIRST: null,
        SECOND: `${runPrefix}-away-batter`,
        THIRD: null,
      },
    });
  });
});
