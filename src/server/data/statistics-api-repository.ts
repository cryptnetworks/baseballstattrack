import type { PrismaClient } from "@prisma/client";

import {
  encodeStatisticsCursor,
  type StatisticsApiPage,
} from "@/domain/statistics-api";

type ListInput = StatisticsApiPage & { accountId: string };

function externalWhere(input: ListInput) {
  if (!input.cursor) return {};
  return {
    externalId:
      input.direction === "asc" ? { gt: input.cursor } : { lt: input.cursor },
  };
}

function page<T extends { externalId: string }>(
  rows: T[],
  limit: number,
  direction: "asc" | "desc",
) {
  const hasMore = rows.length > limit;
  const data = rows.slice(0, limit);
  return {
    data,
    nextCursor:
      hasMore && data.length
        ? encodeStatisticsCursor({
            externalId: data.at(-1)!.externalId,
            direction,
          })
        : null,
  };
}

export class PrismaStatisticsApiRepository {
  constructor(private readonly prisma: PrismaClient) {}

  resolveAccount(externalId: string) {
    return this.prisma.account.findUnique({
      where: { externalId },
      select: {
        id: true,
        externalId: true,
        displayName: true,
        status: true,
        createdAt: true,
      },
    });
  }

  resolveAccountByInternalId(id: string) {
    return this.prisma.account.findUnique({
      where: { id },
      select: {
        id: true,
        externalId: true,
        displayName: true,
        status: true,
        createdAt: true,
      },
    });
  }

  resolveGame(accountId: string, externalId: string) {
    return this.prisma.game.findUnique({
      where: { accountId_externalId: { accountId, externalId } },
      select: {
        id: true,
        externalId: true,
        readySetupSnapshotId: true,
        seasonId: true,
        season: { select: { externalId: true } },
        teamSeason: { select: { teamId: true } },
      },
    });
  }

  resolveSeasonTeam(
    accountId: string,
    seasonExternalId: string,
    teamExternalId: string,
  ) {
    return this.prisma.teamSeason.findFirst({
      where: {
        accountId,
        season: { externalId: seasonExternalId },
        team: { externalId: teamExternalId },
        archivedAt: null,
      },
      select: {
        seasonId: true,
        teamId: true,
        season: { select: { externalId: true } },
        team: { select: { externalId: true } },
      },
    });
  }

  async listTeams(input: ListInput) {
    const rows = await this.prisma.team.findMany({
      where: {
        accountId: input.accountId,
        ...(input.query
          ? { displayName: { contains: input.query, mode: "insensitive" } }
          : {}),
        ...externalWhere(input),
      },
      select: {
        externalId: true,
        displayName: true,
        color: true,
        status: true,
        revision: true,
      },
      orderBy: { externalId: input.direction },
      take: input.limit + 1,
    });
    return page(rows, input.limit, input.direction);
  }

  async listSeasons(input: ListInput) {
    const rows = await this.prisma.season.findMany({
      where: {
        accountId: input.accountId,
        ...(input.query
          ? { displayName: { contains: input.query, mode: "insensitive" } }
          : {}),
        ...externalWhere(input),
      },
      select: {
        externalId: true,
        displayName: true,
        startsOn: true,
        endsOn: true,
        status: true,
        revision: true,
      },
      orderBy: { externalId: input.direction },
      take: input.limit + 1,
    });
    return page(rows, input.limit, input.direction);
  }

  async listPlayers(input: ListInput) {
    const rows = await this.prisma.player.findMany({
      where: {
        accountId: input.accountId,
        ...(input.query
          ? { displayName: { contains: input.query, mode: "insensitive" } }
          : {}),
        ...externalWhere(input),
      },
      select: {
        externalId: true,
        displayName: true,
        battingSide: true,
        throwingHand: true,
        archivedAt: true,
        revision: true,
      },
      orderBy: { externalId: input.direction },
      take: input.limit + 1,
    });
    return page(rows, input.limit, input.direction);
  }

  async listGames(input: ListInput & { seasonExternalId: string | null }) {
    const rows = await this.prisma.game.findMany({
      where: {
        accountId: input.accountId,
        archivedAt: null,
        ...(input.seasonExternalId
          ? { season: { externalId: input.seasonExternalId } }
          : {}),
        ...externalWhere(input),
      },
      select: {
        externalId: true,
        status: true,
        revision: true,
        scheduledAt: true,
        season: { select: { externalId: true } },
        teamSeason: { select: { team: { select: { externalId: true } } } },
        projectionCheckpoints: {
          where: { scope: "GAME" },
          select: {
            sourceRevision: true,
            privacyOverlayRevision: true,
            derivationVersion: true,
            status: true,
          },
          orderBy: [{ sourceRevision: "desc" }, { updatedAt: "desc" }],
          take: 1,
        },
        sourceEvents: {
          where: { eventType: "CorrectionApplied" },
          select: { id: true },
        },
      },
      orderBy: { externalId: input.direction },
      take: input.limit + 1,
    });
    return page(rows, input.limit, input.direction);
  }

  async externalPlayerIds(accountId: string, ids: readonly string[]) {
    const rows = await this.prisma.player.findMany({
      where: { accountId, id: { in: [...new Set(ids)] } },
      select: { id: true, externalId: true },
    });
    return new Map(rows.map(({ id, externalId }) => [id, externalId]));
  }

  async externalGameIds(accountId: string, ids: readonly string[]) {
    const rows = await this.prisma.game.findMany({
      where: { accountId, id: { in: [...new Set(ids)] } },
      select: { id: true, externalId: true },
    });
    return new Map(rows.map(({ id, externalId }) => [id, externalId]));
  }
}
