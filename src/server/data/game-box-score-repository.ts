import {
  ProjectionScope,
  ProjectionStatus,
  type PrismaClient,
} from "@prisma/client";

import {
  GameBoxScoreError,
  type BoxScorePresentation,
  type BoxScoreProjectionCheckpoint,
} from "@/domain/reports";
import { STATISTIC_DERIVATION_VERSION } from "@/domain/statistics";

export type GameBoxScorePresentationSource = {
  sourceRevision: number;
  privacyOverlayRevision: number;
  presentation: BoxScorePresentation;
  projectionCheckpoint: BoxScoreProjectionCheckpoint | null;
};

export class PrismaGameBoxScoreRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async loadPresentationSource(
    accountId: string,
    gameId: string,
    setupSnapshotId: string,
  ): Promise<GameBoxScorePresentationSource> {
    return this.prisma.$transaction(async (tx) => {
      const game = await tx.game.findUnique({
        where: { accountId_id: { accountId, id: gameId } },
        select: {
          revision: true,
          readySetupSnapshotId: true,
          season: { select: { id: true, displayName: true } },
        },
      });
      if (!game || game.readySetupSnapshotId !== setupSnapshotId) {
        throw new GameBoxScoreError(
          "INVALID_REPORT_INPUT",
          "Game report source is unavailable.",
        );
      }
      const setup = await tx.gameSetupSnapshot.findUnique({
        where: { accountId_id: { accountId, id: setupSnapshotId } },
        include: {
          teamSnapshots: { orderBy: [{ side: "asc" }, { id: "asc" }] },
          lineupSlots: {
            orderBy: [{ battingOrder: "asc" }, { id: "asc" }],
          },
        },
      });
      if (
        !setup ||
        setup.gameId !== gameId ||
        setup.teamSnapshots.length !== 2
      ) {
        throw new GameBoxScoreError(
          "INVALID_REPORT_INPUT",
          "Accepted report presentation is unavailable.",
        );
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
      const names = new Map(
        setup.lineupSlots.map((slot) => [slot.id, slot.displayName]),
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
              names.set(slot.id, field.replacementValue);
            }
          }
        }
      }
      const checkpoint = await tx.projectionCheckpoint.findFirst({
        where: {
          accountId,
          gameId,
          seasonId: null,
          scope: ProjectionScope.GAME,
          sourceRevision: game.revision,
          privacyOverlayRevision,
          derivationVersion: STATISTIC_DERIVATION_VERSION,
          status: ProjectionStatus.CURRENT,
        },
      });
      const teams = Object.fromEntries(
        setup.teamSnapshots.map((team) => [
          team.side,
          { id: team.id, displayName: team.displayName },
        ]),
      ) as BoxScorePresentation["teams"];
      if (!teams.AWAY || !teams.HOME) {
        throw new GameBoxScoreError(
          "INVALID_REPORT_INPUT",
          "Both report teams are required.",
        );
      }
      const sideBySnapshot = new Map(
        setup.teamSnapshots.map(({ id, side }) => [id, side]),
      );
      return {
        sourceRevision: game.revision,
        privacyOverlayRevision,
        presentation: {
          season: game.season,
          teams,
          players: setup.lineupSlots.map((slot) => {
            const side = sideBySnapshot.get(slot.gameTeamSnapshotId);
            if (!side) {
              throw new GameBoxScoreError(
                "INVALID_REPORT_INPUT",
                "Report lineup identity is incomplete.",
              );
            }
            return {
              playerId: slot.playerId ?? slot.id,
              lineupSlotId: slot.id,
              side,
              displayName: names.get(slot.id) ?? slot.displayName,
              jerseyNumber: slot.jerseyNumber,
              battingOrder: slot.battingOrder,
              defensivePosition: slot.defensivePosition,
              startingPitcher: slot.isStartingPitcher,
            };
          }),
        },
        projectionCheckpoint: checkpoint
          ? {
              sourceRevision: checkpoint.sourceRevision,
              privacyOverlayRevision: checkpoint.privacyOverlayRevision,
              derivationVersion: checkpoint.derivationVersion,
              status: "CURRENT",
            }
          : null,
      };
    });
  }
}
