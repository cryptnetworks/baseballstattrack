import { z } from "zod";

import { buildSeasonDashboard, type SeasonDashboard } from "@/domain/reports";
import { deriveGameStatistics } from "@/domain/statistics";
import {
  getRateLimitService,
  noRateLimit,
  type RateLimitEnforcer,
} from "@/server/app/rate-limit-service";
import type { TrustedActorContext } from "@/server/auth/types";
import { requireTrustedActor } from "@/server/auth/types";
import { PrismaGameEventRepository } from "@/server/data/game-event-repository";
import { getPrismaClient } from "@/server/data/prisma";
import {
  PrismaSeasonDashboardRepository,
  type SeasonDashboardChoice,
} from "@/server/data/season-dashboard-repository";

const id = z.string().trim().min(1).max(128);
const date = z.iso.date();
const querySchema = z
  .object({
    accountId: id,
    teamId: id,
    seasonId: id,
    dateFrom: date.nullable().optional(),
    dateTo: date.nullable().optional(),
  })
  .strict();

export class SeasonDashboardService {
  constructor(
    private readonly repository: Pick<
      PrismaSeasonDashboardRepository,
      "listChoices" | "loadGameSources"
    >,
    private readonly events: Pick<
      PrismaGameEventRepository,
      "loadAcceptedHistories"
    >,
    private readonly rateLimits: RateLimitEnforcer = noRateLimit,
  ) {}

  async listChoices(
    accountId: string,
    actorInput: TrustedActorContext,
  ): Promise<SeasonDashboardChoice[]> {
    const actor = requireTrustedActor(actorInput, accountId, "report.view");
    if (actor.target.kind !== "ACCOUNT") {
      throw new Error("Account report authorization is required.");
    }
    await this.rateLimits.enforce(
      { accountId, endpointClass: "REPORT_READ" },
      actor,
    );
    return this.repository.listChoices(accountId);
  }

  async load(
    input: unknown,
    actorInput: TrustedActorContext,
  ): Promise<SeasonDashboard> {
    const query = querySchema.parse(input);
    const actor = requireTrustedActor(
      actorInput,
      query.accountId,
      "report.view",
    );
    if (
      actor.target.kind !== "SEASON" ||
      actor.target.seasonId !== query.seasonId ||
      !actor.target.teamIds.includes(query.teamId)
    ) {
      throw new Error("Exact team-season report authorization is required.");
    }
    await this.rateLimits.enforce(
      {
        accountId: query.accountId,
        endpointClass: "REPORT_GENERATION",
        cost: 2,
      },
      actor,
    );
    const choices = await this.repository.listChoices(query.accountId);
    const choice = choices.find(
      (candidate) =>
        candidate.teamId === query.teamId &&
        candidate.seasonId === query.seasonId,
    );
    if (!choice) throw new Error("Season dashboard is unavailable.");

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const sources = await this.repository.loadGameSources(
        query.accountId,
        choice,
      );
      const histories = await this.events.loadAcceptedHistories(
        query.accountId,
        sources.map(({ gameId, setupSnapshotId }) => ({
          gameId,
          setupSnapshotId,
        })),
      );
      const games = sources.map((source) => {
        const history = histories.find(
          (candidate) =>
            candidate.gameId === source.gameId &&
            candidate.setupSnapshotId === source.setupSnapshotId,
        )?.history;
        if (!history) throw new Error("Season game history is unavailable.");
        const projection = deriveGameStatistics({
          ...history,
          privacyOverlayRevision: source.privacyOverlayRevision,
        });
        return { source, projection };
      });
      if (
        games.some(
          ({ source, projection }) =>
            projection.metadata.sourceRevision !== source.sourceRevision,
        )
      ) {
        continue;
      }
      return buildSeasonDashboard({
        accountId: query.accountId,
        seasonId: query.seasonId,
        seasonDisplayName: choice.seasonDisplayName,
        teamId: query.teamId,
        teamDisplayName: choice.teamDisplayName,
        dateFrom: query.dateFrom ?? null,
        dateTo: query.dateTo ?? null,
        games: games.map(({ source, projection }) => ({
          projection,
          side: source.side,
          seasonId: query.seasonId,
          teamId: query.teamId,
          setupSnapshotId: source.setupSnapshotId,
          scheduledAt: source.scheduledAt,
          opponentDisplayName: source.opponentDisplayName,
          playerNames: source.playerNames,
        })),
      });
    }
    throw new Error(
      "Season history changed while the dashboard was generated.",
    );
  }
}

export function getSeasonDashboardService(): SeasonDashboardService {
  const prisma = getPrismaClient();
  return new SeasonDashboardService(
    new PrismaSeasonDashboardRepository(prisma),
    new PrismaGameEventRepository(prisma),
    getRateLimitService(),
  );
}
