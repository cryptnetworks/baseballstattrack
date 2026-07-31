import { performance } from "node:perf_hooks";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildGameBoxScore } from "@/domain/reports";
import { PrismaGameBoxScoreRepository } from "@/server/data/game-box-score-repository";
import {
  PrismaGameEventRepository,
  type AcceptEventCommand,
} from "@/server/data/game-event-repository";
import { PrismaSeasonDashboardRepository } from "@/server/data/season-dashboard-repository";
import {
  PRODUCTION_WORKLOAD_BUDGETS,
  PRODUCTION_WORKLOAD_PROFILE,
} from "@/server/observability/performance-budgets";
import {
  seedPersistenceScoringFixture,
  type PersistenceScoringIds,
} from "../fixtures/persistence-scoring-fixture";

type Measurement = {
  workflow: string;
  samples: number;
  medianMilliseconds: number;
  p95Milliseconds: number;
};

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const runPrefix = `issue32-workload-${process.pid}-${Date.now()}`;

function summarize(
  workflow: string,
  durations: readonly number[],
): Measurement {
  const sorted = [...durations].sort((left, right) => left - right);
  const percentile = (value: number) =>
    sorted[Math.min(sorted.length - 1, Math.ceil(value * sorted.length) - 1)]!;
  return {
    workflow,
    samples: sorted.length,
    medianMilliseconds: Number(percentile(0.5).toFixed(3)),
    p95Milliseconds: Number(percentile(0.95).toFixed(3)),
  };
}

async function measureAsync(
  workflow: string,
  samples: number,
  operation: () => Promise<unknown>,
): Promise<Measurement> {
  await operation();
  const durations: number[] = [];
  for (let index = 0; index < samples; index += 1) {
    const started = performance.now();
    await operation();
    durations.push(performance.now() - started);
  }
  return summarize(workflow, durations);
}

integration("production-shaped database workload budgets", () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl! }),
  });
  const events = new PrismaGameEventRepository(prisma);
  const reports = new PrismaGameBoxScoreRepository(prisma);
  const dashboards = new PrismaSeasonDashboardRepository(prisma);
  let ids: PersistenceScoringIds;
  const measurements: Measurement[] = [];

  beforeAll(async () => {
    ids = await seedPersistenceScoringFixture(prisma, runPrefix);
  });

  afterAll(async () => {
    if (process.env.PERFORMANCE_MEASURE === "1") console.table(measurements);
    await prisma.$disconnect();
  });

  const actor = (capability: "game.start" | "game.score") => ({
    accountId: ids.account,
    actorId: `${runPrefix}-score-service`,
    actorKind: "SERVICE" as const,
    actorUserId: null,
    capability,
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
    recordedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, revision)).toISOString(),
    actor:
      body.eventType === "GameStarted"
        ? actor("game.start")
        : actor("game.score"),
    body,
  });

  it("keeps durable scoring acceptance within the p95 budget", async () => {
    await events.accept(
      command(0, { eventType: "GameStarted", payload: {} }, "start"),
    );
    const durations: number[] = [];
    for (
      let index = 0;
      index < PRODUCTION_WORKLOAD_PROFILE.scoringEvents;
      index += 1
    ) {
      const battingSide = Math.floor(index / 3) % 2 === 0 ? "away" : "home";
      const batterId = ids[battingSide].batter;
      const fieldingSide = battingSide === "away" ? "home" : "away";
      const pitcherId = ids[fieldingSide].pitcher;
      const fielderId = ids[fieldingSide].batter;
      const revision = index + 1;
      const started = performance.now();
      await events.accept(
        command(
          revision,
          {
            eventType: "PlateAppearanceRecorded",
            payload: {
              batterId,
              pitcherId,
              outcome: "STRIKEOUT_SWINGING",
              battedBall: null,
              movements: [
                {
                  runnerId: batterId,
                  from: "BATTER",
                  to: "OUT",
                  cause: "BATTER_RESULT",
                  forced: false,
                  responsiblePitcherId: pitcherId,
                  out: {
                    outNumber: (index % 3) + 1,
                    force: false,
                    fielders: [fielderId],
                  },
                },
              ],
              fieldingCredits: [
                {
                  fielderId,
                  credit: "PUTOUT",
                  errorType: null,
                },
              ],
            },
          },
          `out-${index + 1}`,
        ),
      );
      durations.push(performance.now() - started);
    }
    const measurement = summarize(
      PRODUCTION_WORKLOAD_BUDGETS.scoringAcceptance.workflow,
      durations,
    );
    measurements.push(measurement);
    expect(measurement.samples).toBe(
      PRODUCTION_WORKLOAD_BUDGETS.scoringAcceptance.samples,
    );
    expect(measurement.p95Milliseconds).toBeLessThanOrEqual(
      PRODUCTION_WORKLOAD_BUDGETS.scoringAcceptance.p95Milliseconds,
    );
  }, 30_000);

  it("keeps accepted-history box-score generation within budget", async () => {
    const measurement = await measureAsync(
      PRODUCTION_WORKLOAD_BUDGETS.gameReport.workflow,
      PRODUCTION_WORKLOAD_BUDGETS.gameReport.samples,
      async () => {
        const history = await events.loadAcceptedHistory(
          ids.account,
          ids.game,
          ids.setup,
        );
        const presentation = await reports.loadPresentationSource(
          ids.account,
          ids.game,
          ids.setup,
        );
        return buildGameBoxScore({
          setup: history.setup,
          events: history.events,
          presentation: presentation.presentation,
          privacyOverlayRevision: presentation.privacyOverlayRevision,
          projectionCheckpoint: presentation.projectionCheckpoint,
          generatedAt: "2026-01-01T01:00:00.000Z",
        });
      },
    );
    measurements.push(measurement);
    expect(measurement.p95Milliseconds).toBeLessThanOrEqual(
      PRODUCTION_WORKLOAD_BUDGETS.gameReport.p95Milliseconds,
    );
  });

  it("keeps a bounded 100-game dashboard source query within budget", async () => {
    const extraGames = PRODUCTION_WORKLOAD_PROFILE.seasonGames - 1;
    await prisma.game.createMany({
      data: Array.from({ length: extraGames }, (_, index) => ({
        id: `${runPrefix}-dashboard-game-${index}`,
        accountId: ids.account,
        seasonId: `${runPrefix}-season`,
        teamSeasonId: ids.home.teamSeason,
        scheduledAt: new Date(Date.UTC(2026, 1, (index % 28) + 1)),
      })),
    });
    await prisma.gameSetupSnapshot.createMany({
      data: Array.from({ length: extraGames }, (_, index) => ({
        id: `${runPrefix}-dashboard-setup-${index}`,
        accountId: ids.account,
        gameId: `${runPrefix}-dashboard-game-${index}`,
        setupRevision: 1,
        rulesetVersionId: ids.ruleset,
        scheduledInnings: 7,
      })),
    });
    await prisma.gameTeamSnapshot.createMany({
      data: Array.from({ length: extraGames }, (_, index) => [
        {
          id: `${runPrefix}-dashboard-home-${index}`,
          accountId: ids.account,
          gameId: `${runPrefix}-dashboard-game-${index}`,
          setupSnapshotId: `${runPrefix}-dashboard-setup-${index}`,
          side: "HOME" as const,
          teamId: ids.home.team,
          teamSeasonId: ids.home.teamSeason,
          displayName: "Synthetic Home Team",
          isAccountTeam: true,
        },
        {
          id: `${runPrefix}-dashboard-away-${index}`,
          accountId: ids.account,
          gameId: `${runPrefix}-dashboard-game-${index}`,
          setupSnapshotId: `${runPrefix}-dashboard-setup-${index}`,
          side: "AWAY" as const,
          teamId: ids.away.team,
          teamSeasonId: ids.away.teamSeason,
          displayName: "Synthetic Away Team",
          isAccountTeam: true,
        },
      ]).flat(),
    });
    for (let index = 0; index < extraGames; index += 1) {
      await prisma.game.update({
        where: { id: `${runPrefix}-dashboard-game-${index}` },
        data: {
          status: "READY",
          setupRevision: 1,
          readySetupSnapshotId: `${runPrefix}-dashboard-setup-${index}`,
        },
      });
    }

    const choices = await dashboards.listChoices(ids.account);
    const choice = choices.find(
      ({ teamSeasonId }) => teamSeasonId === ids.home.teamSeason,
    );
    expect(choice).toBeDefined();
    const measurement = await measureAsync(
      PRODUCTION_WORKLOAD_BUDGETS.seasonDashboard.workflow,
      PRODUCTION_WORKLOAD_BUDGETS.seasonDashboard.samples,
      async () => {
        const sources = await dashboards.loadGameSources(ids.account, choice!);
        expect(sources).toHaveLength(PRODUCTION_WORKLOAD_PROFILE.seasonGames);
      },
    );
    measurements.push(measurement);
    expect(measurement.p95Milliseconds).toBeLessThanOrEqual(
      PRODUCTION_WORKLOAD_BUDGETS.seasonDashboard.p95Milliseconds,
    );
  });
});
