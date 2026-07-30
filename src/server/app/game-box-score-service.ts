import { z } from "zod";

import { GameBoxScoreError, buildGameBoxScore } from "@/domain/reports";
import type { TrustedActorContext } from "@/server/auth/types";
import { requireTrustedActor } from "@/server/auth/types";
import { PrismaGameBoxScoreRepository } from "@/server/data/game-box-score-repository";
import { PrismaGameEventRepository } from "@/server/data/game-event-repository";
import { getPrismaClient } from "@/server/data/prisma";

const id = z.string().trim().min(1).max(128);
const querySchema = z
  .object({
    accountId: id,
    gameId: id,
    setupSnapshotId: id,
  })
  .strict();

export class GameBoxScoreService {
  constructor(
    private readonly events: PrismaGameEventRepository,
    private readonly reports: PrismaGameBoxScoreRepository,
  ) {}

  async load(input: unknown, actorInput: TrustedActorContext) {
    const query = querySchema.parse(input);
    const actor = requireTrustedActor(
      actorInput,
      query.accountId,
      "report.view",
    );
    if (actor.target.kind !== "GAME" || actor.target.gameId !== query.gameId) {
      throw new GameBoxScoreError(
        "INVALID_REPORT_INPUT",
        "Exact game report authorization is required.",
      );
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const history = await this.events.loadAcceptedHistory(
        query.accountId,
        query.gameId,
        query.setupSnapshotId,
      );
      const presentation = await this.reports.loadPresentationSource(
        query.accountId,
        query.gameId,
        query.setupSnapshotId,
      );
      const sourceRevision = history.events.at(-1)?.acceptedRevision ?? 0;
      if (sourceRevision !== presentation.sourceRevision) continue;
      return buildGameBoxScore({
        setup: history.setup,
        events: history.events,
        presentation: presentation.presentation,
        privacyOverlayRevision: presentation.privacyOverlayRevision,
        projectionCheckpoint: presentation.projectionCheckpoint,
        generatedAt: new Date().toISOString(),
      });
    }
    throw new GameBoxScoreError(
      "STALE_PROJECTION",
      "Game history changed while the report was generated. Reload it.",
    );
  }
}

export function getGameBoxScoreService() {
  const prisma = getPrismaClient();
  return new GameBoxScoreService(
    new PrismaGameEventRepository(prisma),
    new PrismaGameBoxScoreRepository(prisma),
  );
}
