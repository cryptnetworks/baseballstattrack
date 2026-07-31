import {
  MAX_PORTABLE_BYTES,
  PortableDataError,
  createPortableDataDocument,
  encodePortableDocument,
  normalizePortableHistory,
  portableGameSummary,
  validatePortableImport,
  type PortableData,
  type PortableImportPlan,
} from "@/domain/portable-data";
import { deriveGameStatistics } from "@/domain/statistics";
import type { TrustedActorContext } from "@/server/auth/types";
import { requireTrustedActor } from "@/server/auth/types";
import { PrismaGameBoxScoreRepository } from "@/server/data/game-box-score-repository";
import { PrismaGameEventRepository } from "@/server/data/game-event-repository";
import {
  PrismaPortableDataRepository,
  type PortableCatalog,
} from "@/server/data/portable-data-repository";
import { getPrismaClient } from "@/server/data/prisma";

function safeTimestamp(value: string) {
  return value.replaceAll(/[^0-9]/gu, "").slice(0, 14);
}

function logicalIds(bytes: Uint8Array): string[] {
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as {
    data: Record<string, Array<{ id: string }>>;
  };
  return Object.values(parsed.data).flatMap((records) =>
    records.map(({ id }) => id),
  );
}

export class PortableDataService {
  constructor(
    private readonly repository: Pick<
      PrismaPortableDataRepository,
      "loadCatalog" | "findExistingLogicalIds" | "audit"
    >,
    private readonly events: Pick<
      PrismaGameEventRepository,
      "loadAcceptedHistories"
    >,
    private readonly boxScores: Pick<
      PrismaGameBoxScoreRepository,
      "loadPresentationSources"
    >,
  ) {}

  async exportAccount(
    accountId: string,
    actorInput: TrustedActorContext,
  ): Promise<{
    bytes: Uint8Array;
    fileName: string;
    checksum: string;
  }> {
    const actor = requireTrustedActor(actorInput, accountId, "report.export");
    if (actor.target.kind !== "ACCOUNT") {
      throw new PortableDataError(
        "OWNERSHIP_VIOLATION",
        "Exact Account export authorization is required.",
      );
    }
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const catalog = await this.repository.loadCatalog(accountId);
        const ready = catalog.games.filter(
          (
            game,
          ): game is typeof game & {
            setupSnapshotId: string;
          } => game.setupSnapshotId !== null,
        );
        const histories = await this.events.loadAcceptedHistories(
          accountId,
          ready.map(({ id, setupSnapshotId }) => ({
            gameId: id,
            setupSnapshotId,
          })),
        );
        const presentations = await this.boxScores.loadPresentationSources(
          accountId,
          ready.map((game) => ({
            gameId: game.id,
            setupSnapshotId: game.setupSnapshotId,
          })),
        );
        const data = this.assembleData(
          accountId,
          catalog,
          histories,
          presentations,
        );
        if (
          data.games.some(
            (game) =>
              game.history !== null &&
              game.sourceRevision !== game.history.summary.sourceRevision,
          )
        ) {
          continue;
        }
        const exportedAt = new Date().toISOString();
        const document = createPortableDataDocument({ exportedAt, data });
        const bytes = encodePortableDocument(document);
        if (bytes.byteLength > MAX_PORTABLE_BYTES) {
          throw new PortableDataError(
            "OVERSIZED_FILE",
            "Generated export exceeds the file limit.",
          );
        }
        await this.repository.audit({
          actor,
          action: "data.export.generate",
          outcome: "SUCCEEDED",
          metadata: {
            checksum: document.manifest.checksum,
            bytes: bytes.byteLength,
            counts: document.manifest.counts,
            ephemeral: true,
          },
        });
        return {
          bytes,
          fileName: `baseballstattrack-export-${safeTimestamp(exportedAt)}.json`,
          checksum: document.manifest.checksum,
        };
      }
      throw new PortableDataError(
        "EVENT_INTEGRITY",
        "Account history changed while the export was generated.",
      );
    } catch (error) {
      const code =
        error instanceof PortableDataError ? error.code : "EVENT_INTEGRITY";
      await this.repository.audit({
        actor,
        action: "data.export.generate",
        outcome: "FAILED",
        reasonCode: code,
        metadata: { ephemeral: true },
      });
      if (error instanceof PortableDataError) throw error;
      throw new PortableDataError(
        "EVENT_INTEGRITY",
        "Export generation failed safely.",
      );
    }
  }

  private assembleData(
    accountId: string,
    catalog: PortableCatalog,
    histories: Awaited<
      ReturnType<PrismaGameEventRepository["loadAcceptedHistories"]>
    >,
    presentations: Array<{
      gameId: string;
      source: Awaited<
        ReturnType<PrismaGameBoxScoreRepository["loadPresentationSource"]>
      >;
    }>,
  ): PortableData {
    return {
      ...catalog,
      games: catalog.games.map((game) => {
        if (!game.setupSnapshotId) return { ...game, history: null };
        const history = histories.find(
          (candidate) =>
            candidate.gameId === game.id &&
            candidate.setupSnapshotId === game.setupSnapshotId,
        )?.history;
        const presentation = presentations.find(
          (candidate) => candidate.gameId === game.id,
        )?.source;
        if (!history || !presentation) {
          throw new PortableDataError(
            "EVENT_INTEGRITY",
            "Accepted game export source is unavailable.",
            { section: "games", recordId: game.id },
          );
        }
        if (history.setup.accountId !== accountId) {
          throw new PortableDataError(
            "OWNERSHIP_VIOLATION",
            "Mixed-Account setup was rejected.",
            { section: "games", recordId: game.id },
          );
        }
        for (const event of history.events) {
          if (event.accountId !== accountId) {
            throw new PortableDataError(
              "OWNERSHIP_VIOLATION",
              "Mixed-Account event was rejected.",
              { section: "games", recordId: game.id },
            );
          }
        }
        const portableHistory = normalizePortableHistory(
          history.setup,
          history.events,
        );
        const projection = deriveGameStatistics({
          setup: portableHistory.acceptedSetup,
          events: portableHistory.acceptedEvents,
          privacyOverlayRevision: presentation.privacyOverlayRevision,
        });
        return {
          id: game.id,
          seasonId: game.seasonId,
          teamSeasonId: game.teamSeasonId,
          scheduledAt: game.scheduledAt,
          status: game.status,
          sourceRevision: game.sourceRevision,
          history: {
            setup: portableHistory.setup,
            events: portableHistory.events,
            presentation: {
              teams: {
                AWAY: presentation.presentation.teams.AWAY.displayName,
                HOME: presentation.presentation.teams.HOME.displayName,
              },
              players: Object.fromEntries(
                presentation.presentation.players.map((player) => [
                  player.playerId,
                  player.displayName,
                ]),
              ),
              privacyOverlayRevision: presentation.privacyOverlayRevision,
            },
            summary: portableGameSummary(projection),
          },
        };
      }),
    };
  }

  async validateImport(
    accountId: string,
    bytes: Uint8Array,
    actorInput: TrustedActorContext,
  ): Promise<PortableImportPlan> {
    const actor = requireTrustedActor(actorInput, accountId, "account.manage");
    if (actor.target.kind !== "ACCOUNT") {
      throw new PortableDataError(
        "OWNERSHIP_VIOLATION",
        "Exact Account import authorization is required.",
      );
    }
    try {
      validatePortableImport({ bytes, targetAccountId: accountId });
      const existingLogicalIds = await this.repository.findExistingLogicalIds(
        accountId,
        logicalIds(bytes),
      );
      const plan = validatePortableImport({
        bytes,
        targetAccountId: accountId,
        existingLogicalIds,
      });
      await this.repository.audit({
        actor,
        action: "data.import.validate",
        outcome: "SUCCEEDED",
        metadata: {
          checksum: plan.documentChecksum,
          counts: plan.counts,
          mutationCount: 0,
          mode: plan.mode,
        },
      });
      return plan;
    } catch (error) {
      const code =
        error instanceof PortableDataError ? error.code : "MALFORMED_DOCUMENT";
      await this.repository.audit({
        actor,
        action: "data.import.validate",
        outcome: "FAILED",
        reasonCode: code,
        metadata: { bytes: bytes.byteLength, mutationCount: 0 },
      });
      if (error instanceof PortableDataError) throw error;
      throw new PortableDataError(
        "MALFORMED_DOCUMENT",
        "Import validation failed safely.",
      );
    }
  }
}

export function getPortableDataService() {
  const prisma = getPrismaClient();
  return new PortableDataService(
    new PrismaPortableDataRepository(prisma),
    new PrismaGameEventRepository(prisma),
    new PrismaGameBoxScoreRepository(prisma),
  );
}
