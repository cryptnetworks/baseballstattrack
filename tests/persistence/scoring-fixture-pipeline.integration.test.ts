import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { deriveGameStatistics } from "@/domain/statistics";
import {
  PrismaGameEventRepository,
  type AcceptEventCommand,
} from "@/server/data/game-event-repository";

import {
  seedPersistenceScoringFixture,
  type PersistenceScoringIds,
} from "../fixtures/persistence-scoring-fixture";

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const runPrefix = `issue12-pipeline-${process.pid}`;

integration("representative scoring persistence pipeline", () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl! }),
  });
  const repository = new PrismaGameEventRepository(prisma);
  let ids: PersistenceScoringIds;

  beforeAll(async () => {
    ids = await seedPersistenceScoringFixture(prisma, runPrefix);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const actor = () => ({
    accountId: ids.account,
    actorId: `${runPrefix}-score-service`,
    actorKind: "SERVICE" as const,
    actorUserId: null,
    capability: "game.score" as const,
    scope: { kind: "GAME" as const, gameId: ids.game },
    authorizedAt: "2026-01-01T00:00:00.000Z",
  });

  const command = (
    revision: number,
    body: AcceptEventCommand["body"],
    suffix: string,
  ): AcceptEventCommand => ({
    accountId: ids.account,
    gameId: ids.game,
    setupSnapshotId: ids.setup,
    expectedRevision: revision,
    eventId: `${runPrefix}-event-${suffix}`,
    playTransactionId: `${runPrefix}-play-${suffix}`,
    clientSubmissionId: `${runPrefix}-submission-${suffix}`,
    recordedAt: `2026-01-01T00:00:0${revision}.000Z`,
    actor:
      body.eventType === "GameStarted"
        ? { ...actor(), capability: "game.start" }
        : actor(),
    body,
  });

  it("runs setup through acceptance, persistence, reload, replay, derivation, and box score", async () => {
    await repository.accept(
      command(0, { eventType: "GameStarted", payload: {} }, "start"),
    );
    for (let out = 1; out <= 3; out += 1) {
      await repository.accept(
        command(
          out,
          {
            eventType: "PlateAppearanceRecorded",
            payload: {
              batterId: ids.away.batter,
              pitcherId: ids.home.pitcher,
              outcome: "STRIKEOUT_SWINGING",
              battedBall: null,
              movements: [
                {
                  runnerId: ids.away.batter,
                  from: "BATTER",
                  to: "OUT",
                  cause: "BATTER_RESULT",
                  forced: false,
                  responsiblePitcherId: ids.home.pitcher,
                  out: {
                    outNumber: out,
                    force: false,
                    fielders: [ids.home.batter],
                  },
                },
              ],
              fieldingCredits: [
                {
                  fielderId: ids.home.batter,
                  credit: "PUTOUT",
                  errorType: null,
                },
              ],
            },
          },
          `top-out-${out}`,
        ),
      );
    }
    await repository.accept(
      command(
        4,
        {
          eventType: "PlateAppearanceRecorded",
          payload: {
            batterId: ids.home.batter,
            pitcherId: ids.away.pitcher,
            outcome: "HOME_RUN",
            battedBall: "FLY_BALL",
            movements: [
              {
                runnerId: ids.home.batter,
                from: "BATTER",
                to: "HOME",
                cause: "HIT",
                forced: false,
                responsiblePitcherId: ids.away.pitcher,
                runCounts: true,
                rbiEligible: true,
                earnedRun: "EARNED",
              },
            ],
            fieldingCredits: [],
          },
        },
        "walk-off-home-run",
      ),
    );
    const completionCommand = command(
      5,
      {
        eventType: "GameCompleted",
        payload: { ending: "WALK_OFF", reasonCode: "fixture-walk-off" },
      },
      "complete",
    );
    const completion = await repository.accept(completionCommand);

    const reloaded = await repository.loadAcceptedHistory(
      ids.account,
      ids.game,
      ids.setup,
    );
    const replayed = await repository.replay(ids.account, ids.game, ids.setup);
    const boxScore = deriveGameStatistics(reloaded);

    expect(reloaded.events).toHaveLength(6);
    expect(
      reloaded.events.map(({ acceptedRevision }) => acceptedRevision),
    ).toEqual([1, 2, 3, 4, 5, 6]);
    expect(replayed.state).toMatchObject({
      status: "COMPLETED",
      inning: 1,
      half: "BOTTOM",
      outs: 0,
      score: { AWAY: 0, HOME: 1 },
      sourceRevision: 6,
    });
    expect(boxScore).toMatchObject({
      outcome: "HOME_WIN",
      finalScore: { AWAY: 0, HOME: 1 },
      metadata: {
        accountId: ids.account,
        gameId: ids.game,
        sourceRevision: 6,
      },
      teams: {
        AWAY: {
          batting: { strikeouts: 3, hits: 0, runs: 0 },
          pitching: { homeRunsAllowed: 1, earnedRuns: 1 },
        },
        HOME: {
          batting: { homeRuns: 1, runs: 1, runsBattedIn: 1 },
          pitching: { strikeouts: 3, outsRecorded: 3 },
          fielding: { putouts: 3 },
        },
      },
    });
    expect(boxScore.inningLines).toEqual([
      { inning: 1, side: "AWAY", runs: 0 },
      { inning: 1, side: "HOME", runs: 1 },
    ]);

    const exactRetry = await repository.accept(completionCommand);
    expect(exactRetry).toEqual({
      event: completion.event,
      idempotentReplay: true,
    });
    await expect(
      repository.accept({
        ...completionCommand,
        body: {
          eventType: "GameAbandoned",
          payload: { reasonCode: "changed-idempotency-input" },
        },
      }),
    ).rejects.toMatchObject({ code: "DUPLICATE_IDEMPOTENCY_KEY" });
    await expect(
      repository.accept(
        command(
          5,
          {
            eventType: "GameAbandoned",
            payload: { reasonCode: "stale-revision" },
          },
          "stale",
        ),
      ),
    ).rejects.toMatchObject({ code: "STALE_SOURCE_REVISION" });
    await expect(
      repository.loadAcceptedHistory("different-account", ids.game, ids.setup),
    ).rejects.toMatchObject({ code: "SETUP_NOT_READY" });
  });
});
