import {
  GameStatus,
  SeasonStatus,
  TeamStatus,
  type PrismaClient,
} from "@prisma/client";

import { discordGameScopeCategory } from "@/domain/discord-tracked-scopes";

type GameCounts = {
  upcoming: number;
  inProgress: number;
  completed: number;
  corrected: number;
  archived: number;
  incomplete: number;
};

const emptyCounts = (): GameCounts => ({
  upcoming: 0,
  inProgress: 0,
  completed: 0,
  corrected: 0,
  archived: 0,
  incomplete: 0,
});

function addStatus(counts: GameCounts, status: GameStatus, count: number) {
  counts[discordGameScopeCategory(status, false)] += count;
}

export class PrismaDiscordTrackedScopesRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getWorkspace(accountId: string, installationExternalId: string) {
    const installation = await this.prisma.discordInstallation.findUnique({
      where: {
        accountId_externalId: {
          accountId,
          externalId: installationExternalId,
        },
      },
      select: { externalId: true, status: true },
    });
    if (!installation) return null;

    const participations = await this.prisma.teamSeason.findMany({
      where: { accountId },
      select: {
        id: true,
        archivedAt: true,
        team: {
          select: {
            externalId: true,
            displayName: true,
            status: true,
            archivedAt: true,
          },
        },
        season: {
          select: {
            externalId: true,
            displayName: true,
            status: true,
            archivedAt: true,
            startsOn: true,
            endsOn: true,
          },
        },
      },
      orderBy: [
        { season: { startsOn: "desc" } },
        { season: { displayName: "asc" } },
        { team: { displayName: "asc" } },
      ],
    });
    const participationIds = participations.map(({ id }) => id);
    const [activeGroups, archivedGroups] = participationIds.length
      ? await Promise.all([
          this.prisma.game.groupBy({
            by: ["teamSeasonId", "status"],
            where: {
              accountId,
              teamSeasonId: { in: participationIds },
              archivedAt: null,
            },
            _count: { _all: true },
          }),
          this.prisma.game.groupBy({
            by: ["teamSeasonId"],
            where: {
              accountId,
              teamSeasonId: { in: participationIds },
              archivedAt: { not: null },
            },
            _count: { _all: true },
          }),
        ])
      : [[], []];
    const counts = new Map<string, GameCounts>();
    for (const group of activeGroups) {
      const current = counts.get(group.teamSeasonId) ?? emptyCounts();
      addStatus(current, group.status, group._count._all);
      counts.set(group.teamSeasonId, current);
    }
    for (const group of archivedGroups) {
      const current = counts.get(group.teamSeasonId) ?? emptyCounts();
      current.archived += group._count._all;
      counts.set(group.teamSeasonId, current);
    }

    return {
      installation: {
        id: installation.externalId,
        status: installation.status,
      },
      scopes: participations.map((participation) => {
        const staleReasons: string[] = [];
        if (
          participation.archivedAt ||
          participation.team.archivedAt ||
          participation.team.status === TeamStatus.ARCHIVED
        ) {
          staleReasons.push("team archived");
        }
        if (
          participation.season.archivedAt ||
          participation.season.status === SeasonStatus.ARCHIVED
        ) {
          staleReasons.push("season archived");
        }
        const games = counts.get(participation.id) ?? emptyCounts();
        return {
          teamId: participation.team.externalId,
          teamName: participation.team.displayName,
          seasonId: participation.season.externalId,
          seasonName: participation.season.displayName,
          seasonStatus: participation.season.status,
          startsOn: participation.season.startsOn,
          endsOn: participation.season.endsOn,
          available: staleReasons.length === 0,
          staleReasons,
          games,
          gameCount: Object.values(games).reduce(
            (total, value) => total + value,
            0,
          ),
        };
      }),
    };
  }
}
