import {
  Prisma,
  ProjectionScope,
  ProjectionStatus,
  type PrismaClient,
  type ProjectionCheckpoint,
} from "@prisma/client";

import { STATISTIC_DERIVATION_VERSION } from "@/domain/statistics";
import { StatisticDerivationError } from "@/domain/statistics/statistic-values";

export type PublishGameProjectionCheckpointCommand = {
  accountId: string;
  gameId: string;
  sourceRevision: number;
  privacyOverlayRevision: number;
  derivationVersion: number;
};

function validateRevision(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new StatisticDerivationError(
      "IMPOSSIBLE_COUNTER_STATE",
      `${label} must be a nonnegative safe integer.`,
      { value },
    );
  }
}

export class PrismaStatisticProjectionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async publishGameCheckpoint(
    command: PublishGameProjectionCheckpointCommand,
  ): Promise<ProjectionCheckpoint> {
    validateRevision(command.sourceRevision, "Source revision");
    validateRevision(
      command.privacyOverlayRevision,
      "Privacy-overlay revision",
    );
    if (command.derivationVersion !== STATISTIC_DERIVATION_VERSION) {
      throw new StatisticDerivationError(
        "UNSUPPORTED_RULESET",
        "Unsupported statistic derivation version.",
        { derivationVersion: command.derivationVersion },
      );
    }

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const game = await tx.game.findUnique({
            where: {
              accountId_id: {
                accountId: command.accountId,
                id: command.gameId,
              },
            },
            select: { revision: true },
          });
          if (!game) {
            throw new StatisticDerivationError(
              "ACCOUNT_MISMATCH",
              "Game is unavailable in the requested Account.",
              { gameId: command.gameId },
            );
          }
          if (game.revision !== command.sourceRevision) {
            throw new StatisticDerivationError(
              "STALE_PROJECTION_WRITE",
              "Projection source revision is not current.",
              {
                sourceRevision: command.sourceRevision,
                currentSourceRevision: game.revision,
              },
            );
          }

          const privacyRevision = await tx.privacyOverlay.aggregate({
            where: { accountId: command.accountId },
            _max: { effectiveOrder: true },
          });
          const currentPrivacyRevision =
            privacyRevision._max.effectiveOrder ?? 0;
          if (command.privacyOverlayRevision !== currentPrivacyRevision) {
            throw new StatisticDerivationError(
              "STALE_PROJECTION_WRITE",
              "Projection privacy-overlay revision is not current.",
              {
                privacyOverlayRevision: command.privacyOverlayRevision,
                currentPrivacyRevision,
              },
            );
          }

          const identity = {
            accountId: command.accountId,
            gameId: command.gameId,
            sourceRevision: command.sourceRevision,
            privacyOverlayRevision: command.privacyOverlayRevision,
            derivationVersion: command.derivationVersion,
          };
          const existing = await tx.projectionCheckpoint.findUnique({
            where: {
              accountId_gameId_sourceRevision_privacyOverlayRevision_derivationVersion:
                identity,
            },
          });
          if (existing) {
            if (
              existing.scope !== ProjectionScope.GAME ||
              existing.seasonId !== null
            ) {
              throw new StatisticDerivationError(
                "INTERNAL_INVARIANT_FAILURE",
                "Stored projection checkpoint has an invalid game scope.",
              );
            }
            return tx.projectionCheckpoint.update({
              where: { id: existing.id },
              data: {
                status: ProjectionStatus.CURRENT,
                failureCode: null,
              },
            });
          }

          await tx.projectionCheckpoint.updateMany({
            where: {
              accountId: command.accountId,
              gameId: command.gameId,
              scope: ProjectionScope.GAME,
              status: ProjectionStatus.CURRENT,
            },
            data: { status: ProjectionStatus.STALE },
          });
          return tx.projectionCheckpoint.create({
            data: {
              ...identity,
              scope: ProjectionScope.GAME,
              seasonId: null,
              status: ProjectionStatus.CURRENT,
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof StatisticDerivationError) throw error;
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === "P2002" || error.code === "P2034")
      ) {
        const existing = await this.prisma.projectionCheckpoint.findUnique({
          where: {
            accountId_gameId_sourceRevision_privacyOverlayRevision_derivationVersion:
              {
                accountId: command.accountId,
                gameId: command.gameId,
                sourceRevision: command.sourceRevision,
                privacyOverlayRevision: command.privacyOverlayRevision,
                derivationVersion: command.derivationVersion,
              },
          },
        });
        if (existing) return existing;
        throw new StatisticDerivationError(
          "STALE_PROJECTION_WRITE",
          "Concurrent projection publication lost freshness.",
        );
      }
      throw new StatisticDerivationError(
        "INTERNAL_INVARIANT_FAILURE",
        "Projection checkpoint persistence failed.",
      );
    }
  }

  async findCurrentGameCheckpoint(
    accountId: string,
    gameId: string,
    expected: {
      sourceRevision: number;
      privacyOverlayRevision: number;
      derivationVersion: number;
    },
  ): Promise<ProjectionCheckpoint | null> {
    return this.prisma.projectionCheckpoint.findFirst({
      where: {
        accountId,
        gameId,
        scope: ProjectionScope.GAME,
        seasonId: null,
        sourceRevision: expected.sourceRevision,
        privacyOverlayRevision: expected.privacyOverlayRevision,
        derivationVersion: expected.derivationVersion,
        status: ProjectionStatus.CURRENT,
      },
    });
  }
}
