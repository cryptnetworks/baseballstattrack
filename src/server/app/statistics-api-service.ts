import { createHash } from "node:crypto";
import { z } from "zod";

import { GameBoxScoreError } from "@/domain/reports";
import {
  STATISTICS_API_VERSION,
  StatisticsApiError,
  decodeStatisticsCursor,
  pageSchema,
  statisticsApiEnvelope,
} from "@/domain/statistics-api";
import { STATISTIC_DERIVATION_VERSION } from "@/domain/statistics";
import {
  getRateLimitService,
  noRateLimit,
  type RateLimitEnforcer,
} from "@/server/app/rate-limit-service";
import { GameBoxScoreService } from "@/server/app/game-box-score-service";
import { SeasonDashboardService } from "@/server/app/season-dashboard-service";
import type { TrustedActorContext } from "@/server/auth/types";
import { requireTrustedActor } from "@/server/auth/types";
import { PrismaGameBoxScoreRepository } from "@/server/data/game-box-score-repository";
import { PrismaGameEventRepository } from "@/server/data/game-event-repository";
import { getPrismaClient } from "@/server/data/prisma";
import { PrismaSeasonDashboardRepository } from "@/server/data/season-dashboard-repository";
import { PrismaStatisticsApiRepository } from "@/server/data/statistics-api-repository";

type Directory = "teams" | "seasons" | "players" | "games";

function opaqueReference(kind: string, value: string): string {
  const digest = createHash("sha256")
    .update(`${STATISTICS_API_VERSION}:${kind}:${value}`)
    .digest("base64url")
    .slice(0, 24);
  return `${kind}_${digest}`;
}

function exactAccount(actor: TrustedActorContext, accountId: string) {
  if (actor.target.kind !== "ACCOUNT") {
    throw new StatisticsApiError("RESOURCE_UNAVAILABLE");
  }
  return actor.accountId === accountId;
}

function pageInput(search: URLSearchParams, additionalKeys: string[] = []) {
  const allowed = new Set([
    "limit",
    "cursor",
    "direction",
    "query",
    ...additionalKeys,
  ]);
  if ([...search.keys()].some((key) => !allowed.has(key))) {
    throw new StatisticsApiError("INVALID_QUERY");
  }
  const parsed = pageSchema.safeParse({
    limit: search.get("limit") ?? undefined,
    cursor: search.get("cursor"),
    direction: search.get("direction") ?? undefined,
    query: search.get("query"),
  });
  if (!parsed.success) throw new StatisticsApiError("INVALID_QUERY");
  return {
    ...parsed.data,
    cursor: decodeStatisticsCursor(parsed.data.cursor, parsed.data.direction),
  };
}

function optionalExternalId(value: string | null): string | null {
  if (value === null) return null;
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw new StatisticsApiError("INVALID_QUERY");
  return parsed.data;
}

export class StatisticsApiService {
  constructor(
    private readonly repository: PrismaStatisticsApiRepository,
    private readonly boxScores: GameBoxScoreService,
    private readonly dashboards: SeasonDashboardService,
    private readonly rateLimits: RateLimitEnforcer = noRateLimit,
  ) {}

  async account(accountId: string, actorInput: TrustedActorContext) {
    const actor = requireTrustedActor(actorInput, accountId, "account.view");
    if (!exactAccount(actor, accountId)) {
      throw new StatisticsApiError("RESOURCE_UNAVAILABLE");
    }
    await this.rateLimits.enforce(
      { accountId, endpointClass: "REPORT_READ" },
      actor,
    );
    const account = await this.repository.resolveAccountByInternalId(accountId);
    if (!account) throw new StatisticsApiError("RESOURCE_UNAVAILABLE");
    return statisticsApiEnvelope({
      id: account.externalId,
      displayName: account.displayName,
      status: account.status,
      createdAt: account.createdAt.toISOString(),
    });
  }

  async directory(
    resource: Directory,
    accountId: string,
    search: URLSearchParams,
    actorInput: TrustedActorContext,
  ) {
    const capability =
      resource === "teams"
        ? "team.view"
        : resource === "seasons"
          ? "season.view"
          : resource === "players"
            ? "roster.view"
            : "game.view";
    const actor = requireTrustedActor(actorInput, accountId, capability);
    if (!exactAccount(actor, accountId)) {
      throw new StatisticsApiError("RESOURCE_UNAVAILABLE");
    }
    await this.rateLimits.enforce(
      { accountId, endpointClass: "REPORT_READ" },
      actor,
    );
    const parsed = pageInput(search, resource === "games" ? ["seasonId"] : []);
    const input = { accountId, ...parsed };
    if (resource === "games") {
      const result = await this.repository.listGames({
        ...input,
        seasonExternalId: optionalExternalId(search.get("seasonId")),
      });
      const data = result.data.map((game) => {
        const checkpoint = game.projectionCheckpoints[0] ?? null;
        const freshness =
          checkpoint?.status === "CURRENT" &&
          checkpoint.sourceRevision === game.revision &&
          checkpoint.derivationVersion === STATISTIC_DERIVATION_VERSION
            ? "CURRENT"
            : checkpoint
              ? "STALE"
              : "INCOMPLETE";
        return {
          id: game.externalId,
          seasonId: game.season.externalId,
          accountTeamId: game.teamSeason.team.externalId,
          scheduledAt: game.scheduledAt?.toISOString() ?? null,
          reportStatus: game.status,
          sourceRevision: game.revision,
          verificationState:
            game.status === "VERIFIED" ? "VERIFIED" : "UNVERIFIED",
          correctionState:
            game.sourceEvents.length > 0 ? "CORRECTED" : "UNCHANGED",
          freshness,
          derivationVersion: checkpoint?.derivationVersion ?? null,
          privacyOverlayRevision: checkpoint?.privacyOverlayRevision ?? null,
        };
      });
      return statisticsApiEnvelope(data, {
        limit: parsed.limit,
        nextCursor: result.nextCursor,
      });
    }
    const result =
      resource === "teams"
        ? await this.repository.listTeams(input)
        : resource === "seasons"
          ? await this.repository.listSeasons(input)
          : await this.repository.listPlayers(input);
    const data = result.data.map((record) => {
      if (resource === "teams") {
        const team = record as Awaited<
          ReturnType<PrismaStatisticsApiRepository["listTeams"]>
        >["data"][number];
        return {
          id: team.externalId,
          displayName: team.displayName,
          color: team.color,
          status: team.status,
          revision: team.revision,
        };
      }
      if (resource === "seasons") {
        const season = record as Awaited<
          ReturnType<PrismaStatisticsApiRepository["listSeasons"]>
        >["data"][number];
        return {
          id: season.externalId,
          displayName: season.displayName,
          startsOn: season.startsOn?.toISOString().slice(0, 10) ?? null,
          endsOn: season.endsOn?.toISOString().slice(0, 10) ?? null,
          status: season.status,
          revision: season.revision,
        };
      }
      const player = record as Awaited<
        ReturnType<PrismaStatisticsApiRepository["listPlayers"]>
      >["data"][number];
      return {
        id: player.externalId,
        displayName: player.displayName,
        battingSide: player.battingSide,
        throwingHand: player.throwingHand,
        archived: player.archivedAt !== null,
        revision: player.revision,
      };
    });
    return statisticsApiEnvelope(data, {
      limit: parsed.limit,
      nextCursor: result.nextCursor,
    });
  }

  async boxScore(
    accountId: string,
    externalGameId: string,
    actorInput: TrustedActorContext,
  ) {
    const game = await this.repository.resolveGame(accountId, externalGameId);
    if (!game?.readySetupSnapshotId) {
      throw new StatisticsApiError("RESOURCE_UNAVAILABLE");
    }
    const actor = requireTrustedActor(actorInput, accountId, "report.view");
    if (actor.target.kind !== "GAME" || actor.target.gameId !== game.id) {
      throw new StatisticsApiError("RESOURCE_UNAVAILABLE");
    }
    await this.rateLimits.enforce(
      { accountId, endpointClass: "REPORT_GENERATION" },
      actor,
    );
    let report;
    try {
      report = await this.boxScores.load(
        {
          accountId,
          gameId: game.id,
          setupSnapshotId: game.readySetupSnapshotId,
        },
        actor,
      );
    } catch (error) {
      if (
        error instanceof GameBoxScoreError &&
        error.code === "STALE_PROJECTION"
      ) {
        throw new StatisticsApiError("SOURCE_CHANGED");
      }
      throw error;
    }
    const playerIds = new Set([
      ...report.teams.AWAY.lineup.map(({ playerId }) => playerId),
      ...report.teams.HOME.lineup.map(({ playerId }) => playerId),
      ...report.teams.AWAY.batting.map(({ playerId }) => playerId),
      ...report.teams.HOME.batting.map(({ playerId }) => playerId),
      ...report.teams.AWAY.pitching.map(({ playerId }) => playerId),
      ...report.teams.HOME.pitching.map(({ playerId }) => playerId),
      ...report.teams.AWAY.fielding.map(({ playerId }) => playerId),
      ...report.teams.HOME.fielding.map(({ playerId }) => playerId),
    ]);
    const externalPlayers = await this.repository.externalPlayerIds(accountId, [
      ...playerIds,
    ]);
    const playerId = (internal: string) =>
      externalPlayers.get(internal) ?? opaqueReference("participant", internal);
    const team = (side: "AWAY" | "HOME") => ({
      id: opaqueReference("team_snapshot", report.teams[side].id),
      displayName: report.teams[side].displayName,
      opponentDisplayName: report.teams[side].opponentDisplayName,
      lineup: report.teams[side].lineup.map((line) => ({
        ...line,
        playerId: playerId(line.playerId),
      })),
      batting: report.teams[side].batting.map((line) => ({
        ...line,
        playerId: playerId(line.playerId),
      })),
      pitching: report.teams[side].pitching.map((line) => ({
        ...line,
        playerId: playerId(line.playerId),
      })),
      fielding: report.teams[side].fielding.map((line) => ({
        ...line,
        playerId: playerId(line.playerId),
      })),
      totals: report.teams[side].totals,
    });
    return statisticsApiEnvelope({
      id: externalGameId,
      version: {
        sourceRevision: report.version.sourceRevision,
        correctionRevision: report.version.correctionRevision,
        correctionCount: report.version.correctionCount,
        derivationVersion: report.version.derivationVersion,
        statisticRulesVersion: report.version.statisticRulesVersion,
        rulesetVersion: opaqueReference(
          "ruleset",
          report.version.rulesetVersionId,
        ),
        privacyOverlayRevision: report.version.privacyOverlayRevision,
        verificationState: report.version.verificationState,
        freshness: report.version.freshness,
        projectionFreshness: report.version.projectionFreshness,
        generatedAt: report.version.generatedAt,
      },
      reportState: report.reportState,
      scoreKind: report.scoreKind,
      correctionStatus: report.correctionStatus,
      seasonId: game.season.externalId,
      score: report.score,
      teams: { AWAY: team("AWAY"), HOME: team("HOME") },
      innings: report.innings,
      reconciliation: report.reconciliation,
    });
  }

  async leaders(
    accountId: string,
    seasonExternalId: string,
    teamExternalId: string,
    actorInput: TrustedActorContext,
  ) {
    const scope = await this.repository.resolveSeasonTeam(
      accountId,
      seasonExternalId,
      teamExternalId,
    );
    if (!scope) throw new StatisticsApiError("RESOURCE_UNAVAILABLE");
    const actor = requireTrustedActor(actorInput, accountId, "report.view");
    if (
      actor.target.kind !== "SEASON" ||
      actor.target.seasonId !== scope.seasonId ||
      !actor.target.teamIds.includes(scope.teamId)
    ) {
      throw new StatisticsApiError("RESOURCE_UNAVAILABLE");
    }
    await this.rateLimits.enforce(
      { accountId, endpointClass: "REPORT_GENERATION" },
      actor,
    );
    const dashboard = await this.dashboards.load(
      { accountId, seasonId: scope.seasonId, teamId: scope.teamId },
      actor,
    );
    const internalPlayers = [
      ...dashboard.leaders.batting.map(({ playerId }) => playerId),
      ...dashboard.leaders.pitching.map(({ playerId }) => playerId),
      ...dashboard.leaders.fielding.map(({ playerId }) => playerId),
    ];
    const players = await this.repository.externalPlayerIds(
      accountId,
      internalPlayers,
    );
    const convert = <T extends { playerId: string }>(rows: T[]) =>
      rows.map((row) => ({
        ...row,
        playerId:
          players.get(row.playerId) ??
          opaqueReference("participant", row.playerId),
      }));
    return statisticsApiEnvelope({
      seasonId: seasonExternalId,
      teamId: teamExternalId,
      freshness: dashboard.version.freshness,
      derivationVersion: dashboard.version.derivationVersion,
      statisticRulesVersion: dashboard.version.statisticRulesVersion,
      privacyOverlayRevision: dashboard.version.privacyOverlayRevision,
      inclusionPolicy: dashboard.inclusionPolicy,
      record: dashboard.record,
      leaders: {
        batting: convert(dashboard.leaders.batting),
        pitching: convert(dashboard.leaders.pitching),
        fielding: convert(dashboard.leaders.fielding),
      },
    });
  }
}

export function getStatisticsApiService() {
  const prisma = getPrismaClient();
  const events = new PrismaGameEventRepository(prisma);
  const reports = new PrismaGameBoxScoreRepository(prisma);
  const seasons = new PrismaSeasonDashboardRepository(prisma);
  return new StatisticsApiService(
    new PrismaStatisticsApiRepository(prisma),
    new GameBoxScoreService(events, reports),
    new SeasonDashboardService(seasons, events),
    getRateLimitService(),
  );
}
