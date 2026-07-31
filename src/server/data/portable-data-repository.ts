import {
  ActorKind,
  AuditOutcome,
  AuditScope,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";

import type { PortableData } from "@/domain/portable-data";
import type { TrustedActorContext } from "@/server/auth/types";

export type PortableGameSource = {
  id: string;
  seasonId: string;
  teamSeasonId: string;
  scheduledAt: string | null;
  status: string;
  sourceRevision: number;
  setupSnapshotId: string | null;
};

export type PortableCatalog = Omit<PortableData, "games"> & {
  games: PortableGameSource[];
};

const READ_LIMIT = 10_001;

function actorKind(actor: TrustedActorContext): ActorKind {
  return actor.actorKind === "USER" ? ActorKind.USER : ActorKind.SERVICE;
}

function rulesetConfiguration(value: Prisma.JsonValue) {
  const source =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? value
      : {};
  const scheduledInnings =
    typeof source.scheduledInnings === "number"
      ? source.scheduledInnings
      : null;
  const maximumLineupSize =
    typeof source.maximumLineupSize === "number"
      ? source.maximumLineupSize
      : 30;
  const allowDefensiveOnly =
    typeof source.allowDefensiveOnly === "boolean"
      ? source.allowDefensiveOnly
      : true;
  if (
    scheduledInnings === null ||
    !Number.isSafeInteger(scheduledInnings) ||
    scheduledInnings < 1 ||
    scheduledInnings > 20 ||
    !Number.isSafeInteger(maximumLineupSize) ||
    maximumLineupSize < 1 ||
    maximumLineupSize > 30
  ) {
    throw new Error("Ruleset export configuration is invalid.");
  }
  return { scheduledInnings, maximumLineupSize, allowDefensiveOnly };
}

export class PrismaPortableDataRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async loadCatalog(accountId: string): Promise<PortableCatalog> {
    return this.prisma.$transaction(async (tx) => {
      const [
        teams,
        seasons,
        teamSeasons,
        players,
        rosters,
        rulesets,
        games,
        overlays,
      ] = await Promise.all([
        tx.team.findMany({
          where: { accountId },
          orderBy: { id: "asc" },
          take: READ_LIMIT,
        }),
        tx.season.findMany({
          where: { accountId },
          orderBy: { id: "asc" },
          take: READ_LIMIT,
        }),
        tx.teamSeason.findMany({
          where: { accountId },
          orderBy: { id: "asc" },
          take: READ_LIMIT,
        }),
        tx.player.findMany({
          where: { accountId },
          orderBy: { id: "asc" },
          take: READ_LIMIT,
        }),
        tx.rosterEntry.findMany({
          where: { accountId },
          orderBy: { id: "asc" },
          take: READ_LIMIT,
        }),
        tx.rulesetVersion.findMany({
          where: { accountId },
          orderBy: { id: "asc" },
          take: READ_LIMIT,
        }),
        tx.game.findMany({
          where: { accountId },
          orderBy: { id: "asc" },
          take: READ_LIMIT,
          select: {
            id: true,
            seasonId: true,
            teamSeasonId: true,
            scheduledAt: true,
            status: true,
            revision: true,
            readySetupSnapshotId: true,
          },
        }),
        tx.privacyOverlay.findMany({
          where: { accountId },
          orderBy: [{ effectiveOrder: "asc" }, { id: "asc" }],
          include: {
            fields: {
              where: {
                field: "PLAYER_DISPLAY_NAME",
                playerId: { not: null },
                lineupSlotSnapshotId: null,
              },
              orderBy: { id: "asc" },
            },
          },
        }),
      ]);
      const currentPlayerNames = new Map(
        players.map(({ id, displayName }) => [id, displayName]),
      );
      for (const overlay of overlays) {
        for (const field of overlay.fields) {
          if (field.playerId) {
            currentPlayerNames.set(field.playerId, field.replacementValue);
          }
        }
      }
      return {
        teams: teams.map((team) => ({
          id: team.id,
          displayName: team.displayName,
          status: team.status,
          archived: team.archivedAt !== null,
        })),
        seasons: seasons.map((season) => ({
          id: season.id,
          displayName: season.displayName,
          startsOn: season.startsOn?.toISOString().slice(0, 10) ?? null,
          endsOn: season.endsOn?.toISOString().slice(0, 10) ?? null,
          status: season.status,
          archived: season.archivedAt !== null,
        })),
        teamSeasons: teamSeasons.map((teamSeason) => ({
          id: teamSeason.id,
          teamId: teamSeason.teamId,
          seasonId: teamSeason.seasonId,
          archived: teamSeason.archivedAt !== null,
        })),
        players: players.map((player) => ({
          id: player.id,
          displayName:
            currentPlayerNames.get(player.id) ?? "Privacy-resolved player",
          battingSide: player.battingSide,
          throwingHand: player.throwingHand,
          archived: player.archivedAt !== null,
        })),
        rosters: rosters.map((roster) => ({
          id: roster.id,
          playerId: roster.playerId,
          teamSeasonId: roster.teamSeasonId,
          jerseyNumber: roster.jerseyNumber,
          primaryPosition: roster.primaryPosition,
          status: roster.status,
          startsAt: roster.startsAt.toISOString(),
          endsAt: roster.endsAt?.toISOString() ?? null,
          archived: roster.archivedAt !== null,
        })),
        rulesets: rulesets.map((ruleset) => ({
          id: ruleset.id,
          name: ruleset.name,
          version: ruleset.version,
          configuration: rulesetConfiguration(ruleset.configuration),
          status: ruleset.status,
        })),
        games: games.map((game) => ({
          id: game.id,
          seasonId: game.seasonId,
          teamSeasonId: game.teamSeasonId,
          scheduledAt: game.scheduledAt?.toISOString() ?? null,
          status: game.status,
          sourceRevision: game.revision,
          setupSnapshotId: game.readySetupSnapshotId,
        })),
      };
    });
  }

  async findExistingLogicalIds(
    accountId: string,
    ids: readonly string[],
  ): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const where = { accountId, id: { in: [...ids] } };
    const [teams, seasons, teamSeasons, players, rosters, rulesets, games] =
      await Promise.all([
        this.prisma.team.findMany({ where, select: { id: true } }),
        this.prisma.season.findMany({ where, select: { id: true } }),
        this.prisma.teamSeason.findMany({ where, select: { id: true } }),
        this.prisma.player.findMany({ where, select: { id: true } }),
        this.prisma.rosterEntry.findMany({ where, select: { id: true } }),
        this.prisma.rulesetVersion.findMany({ where, select: { id: true } }),
        this.prisma.game.findMany({ where, select: { id: true } }),
      ]);
    return new Set(
      [teams, seasons, teamSeasons, players, rosters, rulesets, games].flatMap(
        (records) => records.map(({ id }) => id),
      ),
    );
  }

  async audit(input: {
    actor: TrustedActorContext;
    action: "data.export.generate" | "data.import.validate";
    outcome: "SUCCEEDED" | "FAILED";
    reasonCode?: string;
    metadata: Prisma.InputJsonObject;
  }): Promise<void> {
    await this.prisma.securityAuditRecord.create({
      data: {
        scope: AuditScope.ACCOUNT,
        accountId: input.actor.accountId,
        actorKind: actorKind(input.actor),
        actorId: input.actor.actorId,
        actorUserId: input.actor.actorUserId,
        action: input.action,
        capability: input.actor.capability,
        targetType: "AccountPortableData",
        targetId: input.actor.accountId,
        outcome:
          input.outcome === "SUCCEEDED"
            ? AuditOutcome.SUCCEEDED
            : AuditOutcome.FAILED,
        ...(input.reasonCode === undefined
          ? {}
          : { reasonCode: input.reasonCode }),
        metadata: input.metadata,
      },
    });
  }
}
