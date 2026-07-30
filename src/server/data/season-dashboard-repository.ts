import type { PrismaClient } from "@prisma/client";

export type SeasonDashboardChoice = {
  teamSeasonId: string;
  teamId: string;
  teamDisplayName: string;
  seasonId: string;
  seasonDisplayName: string;
};

export type SeasonDashboardGameSource = {
  gameId: string;
  sourceRevision: number;
  setupSnapshotId: string;
  scheduledAt: string | null;
  side: "HOME" | "AWAY";
  opponentDisplayName: string;
  playerNames: Record<string, string>;
  privacyOverlayRevision: number;
};

const MAX_CHOICES = 100;
const MAX_SEASON_GAMES = 100;

export class PrismaSeasonDashboardRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listChoices(accountId: string): Promise<SeasonDashboardChoice[]> {
    const rows = await this.prisma.teamSeason.findMany({
      where: {
        accountId,
        archivedAt: null,
        team: { archivedAt: null },
        season: { archivedAt: null },
      },
      select: {
        id: true,
        teamId: true,
        seasonId: true,
        team: { select: { displayName: true } },
        season: { select: { displayName: true } },
      },
      orderBy: [
        { season: { displayName: "desc" } },
        { team: { displayName: "asc" } },
        { id: "asc" },
      ],
      take: MAX_CHOICES,
    });
    return rows.map((row) => ({
      teamSeasonId: row.id,
      teamId: row.teamId,
      teamDisplayName: row.team.displayName,
      seasonId: row.seasonId,
      seasonDisplayName: row.season.displayName,
    }));
  }

  async loadGameSources(
    accountId: string,
    choice: SeasonDashboardChoice,
  ): Promise<SeasonDashboardGameSource[]> {
    return this.prisma.$transaction(async (tx) => {
      const currentChoice = await tx.teamSeason.findUnique({
        where: {
          accountId_teamId_seasonId: {
            accountId,
            teamId: choice.teamId,
            seasonId: choice.seasonId,
          },
        },
        select: { id: true, archivedAt: true },
      });
      if (
        !currentChoice ||
        currentChoice.id !== choice.teamSeasonId ||
        currentChoice.archivedAt !== null
      ) {
        return [];
      }
      const overlays = await tx.privacyOverlay.findMany({
        where: { accountId },
        orderBy: [{ effectiveOrder: "asc" }, { id: "asc" }],
        include: {
          fields: {
            where: { field: "PLAYER_DISPLAY_NAME" },
            orderBy: { id: "asc" },
          },
        },
      });
      const privacyOverlayRevision = overlays.at(-1)?.effectiveOrder ?? 0;
      const games = await tx.game.findMany({
        where: {
          accountId,
          seasonId: choice.seasonId,
          archivedAt: null,
          readySetupSnapshotId: { not: null },
          readySetupSnapshot: {
            teamSnapshots: {
              some: { teamSeasonId: choice.teamSeasonId },
            },
          },
        },
        select: {
          id: true,
          revision: true,
          scheduledAt: true,
          readySetupSnapshot: {
            select: {
              id: true,
              teamSnapshots: {
                select: {
                  id: true,
                  side: true,
                  teamSeasonId: true,
                  displayName: true,
                },
                orderBy: [{ side: "asc" }, { id: "asc" }],
              },
              lineupSlots: {
                select: {
                  id: true,
                  playerId: true,
                  gameTeamSnapshotId: true,
                  displayName: true,
                },
                orderBy: [{ battingOrder: "asc" }, { id: "asc" }],
              },
            },
          },
        },
        orderBy: [{ scheduledAt: "desc" }, { id: "desc" }],
        take: MAX_SEASON_GAMES,
      });

      return games.flatMap((game) => {
        const setup = game.readySetupSnapshot;
        if (!setup || setup.teamSnapshots.length !== 2) return [];
        const selected = setup.teamSnapshots.find(
          ({ teamSeasonId }) => teamSeasonId === choice.teamSeasonId,
        );
        const opponent = setup.teamSnapshots.find(
          ({ id }) => id !== selected?.id,
        );
        if (!selected || !opponent) return [];
        const names = new Map(
          setup.lineupSlots.map((slot) => [
            slot.id,
            { playerId: slot.playerId ?? slot.id, value: slot.displayName },
          ]),
        );
        for (const overlay of overlays) {
          for (const field of overlay.fields) {
            for (const slot of setup.lineupSlots) {
              if (
                field.lineupSlotSnapshotId === slot.id ||
                (field.lineupSlotSnapshotId === null &&
                  field.playerId !== null &&
                  field.playerId === slot.playerId)
              ) {
                names.set(slot.id, {
                  playerId: slot.playerId ?? slot.id,
                  value: field.replacementValue,
                });
              }
            }
          }
        }
        return [
          {
            gameId: game.id,
            sourceRevision: game.revision,
            setupSnapshotId: setup.id,
            scheduledAt: game.scheduledAt?.toISOString() ?? null,
            side: selected.side,
            opponentDisplayName: opponent.displayName,
            playerNames: Object.fromEntries(
              [...names.values()].map(({ playerId, value }) => [
                playerId,
                value,
              ]),
            ),
            privacyOverlayRevision,
          },
        ];
      });
    });
  }
}
