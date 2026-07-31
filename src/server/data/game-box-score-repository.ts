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

export type GameBoxScorePresentationRequest = {
  gameId: string;
  setupSnapshotId: string;
};

export type GameBoxScorePresentationResult = {
  gameId: string;
  source: GameBoxScorePresentationSource;
};

const MAX_PRESENTATION_SOURCES = 10_001;

export class PrismaGameBoxScoreRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async loadPresentationSource(
    accountId: string,
    gameId: string,
    setupSnapshotId: string,
  ): Promise<GameBoxScorePresentationSource> {
    const [result] = await this.loadPresentationSources(accountId, [
      { gameId, setupSnapshotId },
    ]);
    if (!result) {
      throw new GameBoxScoreError(
        "INVALID_REPORT_INPUT",
        "Game report source is unavailable.",
      );
    }
    return result.source;
  }

  async loadPresentationSources(
    accountId: string,
    requests: readonly GameBoxScorePresentationRequest[],
  ): Promise<GameBoxScorePresentationResult[]> {
    if (requests.length === 0) return [];
    if (requests.length > MAX_PRESENTATION_SOURCES) {
      throw new GameBoxScoreError(
        "INVALID_REPORT_INPUT",
        "Too many game report sources were requested.",
      );
    }
    if (
      new Set(requests.map(({ gameId }) => gameId)).size !== requests.length
    ) {
      throw new GameBoxScoreError(
        "INVALID_REPORT_INPUT",
        "Duplicate game report sources were requested.",
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const [games, setups, overlays] = await Promise.all([
        tx.game.findMany({
          where: {
            accountId,
            id: { in: requests.map(({ gameId }) => gameId) },
          },
          select: {
            id: true,
            revision: true,
            readySetupSnapshotId: true,
            season: { select: { id: true, displayName: true } },
          },
          orderBy: { id: "asc" },
        }),
        tx.gameSetupSnapshot.findMany({
          where: {
            accountId,
            id: { in: requests.map(({ setupSnapshotId }) => setupSnapshotId) },
          },
          include: {
            teamSnapshots: { orderBy: [{ side: "asc" }, { id: "asc" }] },
            lineupSlots: {
              orderBy: [{ battingOrder: "asc" }, { id: "asc" }],
            },
          },
          orderBy: { id: "asc" },
        }),
        tx.privacyOverlay.findMany({
          where: { accountId },
          orderBy: [{ effectiveOrder: "asc" }, { id: "asc" }],
          include: {
            fields: {
              where: { field: "PLAYER_DISPLAY_NAME" },
              orderBy: { id: "asc" },
            },
          },
        }),
      ]);
      const privacyOverlayRevision = overlays.at(-1)?.effectiveOrder ?? 0;
      const checkpoints = await tx.projectionCheckpoint.findMany({
        where: {
          accountId,
          gameId: { in: requests.map(({ gameId }) => gameId) },
          seasonId: null,
          scope: ProjectionScope.GAME,
          privacyOverlayRevision,
          derivationVersion: STATISTIC_DERIVATION_VERSION,
          status: ProjectionStatus.CURRENT,
        },
        select: {
          gameId: true,
          sourceRevision: true,
          privacyOverlayRevision: true,
          derivationVersion: true,
          status: true,
        },
        orderBy: [{ gameId: "asc" }, { sourceRevision: "desc" }],
      });

      const gamesById = new Map(games.map((game) => [game.id, game]));
      const setupsById = new Map(setups.map((setup) => [setup.id, setup]));
      return requests.map(({ gameId, setupSnapshotId }) => {
        const game = gamesById.get(gameId);
        const setup = setupsById.get(setupSnapshotId);
        if (!game || game.readySetupSnapshotId !== setupSnapshotId) {
          throw new GameBoxScoreError(
            "INVALID_REPORT_INPUT",
            "Game report source is unavailable.",
          );
        }
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

        const checkpoint = checkpoints.find(
          (candidate) =>
            candidate.gameId === gameId &&
            candidate.sourceRevision === game.revision,
        );
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
          gameId,
          source: {
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
          },
        };
      });
    });
  }
}
