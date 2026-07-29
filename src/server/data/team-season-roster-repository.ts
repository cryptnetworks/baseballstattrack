import {
  ActorKind,
  AuditOutcome,
  AuditScope,
  Prisma,
  RosterStatus,
  SeasonStatus,
  TeamStatus,
  type PrismaClient,
} from "@prisma/client";

import {
  ManagementError,
  toDate,
  toInstant,
  type AddRosterPeriodCommand,
  type AddTeamSeasonCommand,
  type ChangeJerseyCommand,
  type CreatePlayerCommand,
  type CreateSeasonCommand,
  type CreateTeamCommand,
  type EndRosterPeriodCommand,
  type ManagementActorContext,
  type NamePage,
  type RosterHistoryPage,
  type SetPlayerArchivedCommand,
  type SetTeamArchivedCommand,
  type SetTeamSeasonArchivedCommand,
  type TransitionSeasonCommand,
  type UpdatePlayerCommand,
  type UpdateSeasonCommand,
  type UpdateTeamCommand,
} from "@/domain/management/team-season-roster";

type Transaction = Prisma.TransactionClient;

const serializable = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
} as const;

function actorKind(actor: ManagementActorContext): ActorKind {
  return actor.actorKind === "USER" ? ActorKind.USER : ActorKind.SERVICE;
}

async function audit(
  tx: Transaction,
  actor: ManagementActorContext,
  action: string,
  targetType: string,
  targetId: string,
  metadata?: Prisma.InputJsonObject,
): Promise<void> {
  await tx.securityAuditRecord.create({
    data: {
      scope: AuditScope.ACCOUNT,
      accountId: actor.accountId,
      actorKind: actorKind(actor),
      actorId: actor.actorId,
      actorUserId: actor.actorUserId,
      action,
      capability: actor.capability,
      targetType,
      targetId,
      outcome: AuditOutcome.SUCCEEDED,
      ...(metadata === undefined ? {} : { metadata }),
    },
  });
}

function translatePersistenceError(error: unknown): never {
  if (error instanceof ManagementError) throw error;
  const diagnostic =
    error instanceof Error
      ? `${error.name}:${error.message}`
      : JSON.stringify(error ?? {});
  if (diagnostic.includes("RosterEntry_no_overlapping_periods")) {
    throw new ManagementError(
      "LIFECYCLE_CONFLICT",
      "Roster periods cannot overlap.",
    );
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const metadata = JSON.stringify(error.meta ?? {});
    if (error.code === "P2002") {
      throw new ManagementError(
        metadata.includes("RosterEntry")
          ? "DUPLICATE_ACTIVE_RELATIONSHIP"
          : "LIFECYCLE_CONFLICT",
        "A conflicting active relationship already exists.",
      );
    }
    if (
      error.code === "P2004" &&
      metadata.includes("RosterEntry_no_overlapping_periods")
    ) {
      throw new ManagementError(
        "LIFECYCLE_CONFLICT",
        "Roster periods cannot overlap.",
      );
    }
    if (error.code === "P2003") {
      throw new ManagementError(
        "ACCOUNT_MISMATCH",
        "A related resource is unavailable in the requested Account.",
      );
    }
    if (error.code === "P2034") {
      throw new ManagementError(
        "PERSISTENCE_CONFLICT",
        "A concurrent management operation conflicted.",
      );
    }
  }
  throw new ManagementError(
    "PERSISTENCE_CONFLICT",
    "Management persistence failed.",
  );
}

async function requireCurrentRevision(
  tx: Transaction,
  model: "team" | "season" | "teamSeason" | "player" | "rosterEntry",
  accountId: string,
  id: string,
  expected: number,
): Promise<void> {
  const where = { accountId_id: { accountId, id } };
  const record =
    model === "team"
      ? await tx.team.findUnique({ where, select: { revision: true } })
      : model === "season"
        ? await tx.season.findUnique({ where, select: { revision: true } })
        : model === "teamSeason"
          ? await tx.teamSeason.findUnique({
              where,
              select: { revision: true },
            })
          : model === "player"
            ? await tx.player.findUnique({ where, select: { revision: true } })
            : await tx.rosterEntry.findUnique({
                where,
                select: { revision: true },
              });
  if (!record) {
    throw new ManagementError(
      "NOT_FOUND_OR_INACCESSIBLE",
      "Management resource is unavailable.",
    );
  }
  if ((record as { revision: number }).revision !== expected) {
    throw new ManagementError(
      "STALE_REVISION",
      "Expected management revision is stale.",
      { expectedRevision: expected },
    );
  }
}

export class PrismaTeamSeasonRosterRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getTeamSeasonScope(accountId: string, teamSeasonId: string) {
    return this.prisma.teamSeason.findUnique({
      where: { accountId_id: { accountId, id: teamSeasonId } },
      select: { teamId: true, seasonId: true },
    });
  }

  async getRosterEntryScope(accountId: string, rosterEntryId: string) {
    return this.prisma.rosterEntry.findUnique({
      where: { accountId_id: { accountId, id: rosterEntryId } },
      select: {
        teamSeason: { select: { teamId: true, seasonId: true } },
      },
    });
  }

  async createTeam(command: CreateTeamCommand, actor: ManagementActorContext) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const team = await tx.team.create({
          data: {
            accountId: command.accountId,
            displayName: command.displayName,
            color: command.color,
          },
        });
        await audit(tx, actor, "team.create", "Team", team.id);
        return team;
      }, serializable);
    } catch (error) {
      translatePersistenceError(error);
    }
  }

  async updateTeam(command: UpdateTeamCommand, actor: ManagementActorContext) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const current = await tx.team.findUnique({
          where: {
            accountId_id: {
              accountId: command.accountId,
              id: command.teamId,
            },
          },
        });
        if (!current) {
          throw new ManagementError(
            "NOT_FOUND_OR_INACCESSIBLE",
            "Team is unavailable.",
          );
        }
        if (current.revision !== command.expectedRevision) {
          throw new ManagementError(
            "STALE_REVISION",
            "Expected team revision is stale.",
          );
        }
        if (current.status !== TeamStatus.ACTIVE) {
          throw new ManagementError(
            "LIFECYCLE_CONFLICT",
            "Archived teams cannot be edited.",
          );
        }
        const updated = await tx.team.updateMany({
          where: {
            accountId: command.accountId,
            id: command.teamId,
            revision: command.expectedRevision,
            status: TeamStatus.ACTIVE,
          },
          data: {
            ...(command.displayName === undefined
              ? {}
              : { displayName: command.displayName }),
            ...(command.color === undefined ? {} : { color: command.color }),
            revision: { increment: 1 },
          },
        });
        if (updated.count !== 1) {
          await requireCurrentRevision(
            tx,
            "team",
            command.accountId,
            command.teamId,
            command.expectedRevision,
          );
          throw new ManagementError(
            "PERSISTENCE_CONFLICT",
            "Team update conflicted.",
          );
        }
        await audit(tx, actor, "team.update", "Team", command.teamId, {
          priorRevision: command.expectedRevision,
          newRevision: command.expectedRevision + 1,
        });
        return tx.team.findUniqueOrThrow({ where: { id: command.teamId } });
      }, serializable);
    } catch (error) {
      translatePersistenceError(error);
    }
  }

  async setTeamArchived(
    command: SetTeamArchivedCommand,
    actor: ManagementActorContext,
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const team = await tx.team.findUnique({
          where: {
            accountId_id: {
              accountId: command.accountId,
              id: command.teamId,
            },
          },
        });
        if (!team) {
          throw new ManagementError(
            "NOT_FOUND_OR_INACCESSIBLE",
            "Team is unavailable.",
          );
        }
        if (team.revision !== command.expectedRevision) {
          throw new ManagementError(
            "STALE_REVISION",
            "Expected team revision is stale.",
          );
        }
        if (
          command.archived &&
          (await tx.teamSeason.count({
            where: {
              accountId: command.accountId,
              teamId: command.teamId,
              archivedAt: null,
            },
          })) > 0
        ) {
          throw new ManagementError(
            "LIFECYCLE_CONFLICT",
            "A team with active season participation cannot be archived.",
          );
        }
        const status = command.archived
          ? TeamStatus.ARCHIVED
          : TeamStatus.ACTIVE;
        const updated = await tx.team.updateMany({
          where: {
            accountId: command.accountId,
            id: command.teamId,
            revision: command.expectedRevision,
          },
          data: {
            status,
            archivedAt: command.archived ? new Date() : null,
            revision: { increment: 1 },
          },
        });
        if (updated.count !== 1) {
          await requireCurrentRevision(
            tx,
            "team",
            command.accountId,
            command.teamId,
            command.expectedRevision,
          );
          throw new ManagementError(
            "PERSISTENCE_CONFLICT",
            "Team lifecycle update conflicted.",
          );
        }
        await audit(
          tx,
          actor,
          command.archived ? "team.archive" : "team.restore",
          "Team",
          command.teamId,
        );
        return tx.team.findUniqueOrThrow({ where: { id: command.teamId } });
      }, serializable);
    } catch (error) {
      translatePersistenceError(error);
    }
  }

  async createSeason(
    command: CreateSeasonCommand,
    actor: ManagementActorContext,
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const season = await tx.season.create({
          data: {
            accountId: command.accountId,
            displayName: command.displayName,
            startsOn: toDate(command.startsOn),
            endsOn: toDate(command.endsOn),
          },
        });
        await audit(tx, actor, "season.create", "Season", season.id);
        return season;
      }, serializable);
    } catch (error) {
      translatePersistenceError(error);
    }
  }

  async updateSeason(
    command: UpdateSeasonCommand,
    actor: ManagementActorContext,
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const season = await tx.season.findUnique({
          where: {
            accountId_id: {
              accountId: command.accountId,
              id: command.seasonId,
            },
          },
        });
        if (!season) {
          throw new ManagementError(
            "NOT_FOUND_OR_INACCESSIBLE",
            "Season is unavailable.",
          );
        }
        if (season.revision !== command.expectedRevision) {
          throw new ManagementError(
            "STALE_REVISION",
            "Expected season revision is stale.",
          );
        }
        if (
          season.status === SeasonStatus.COMPLETED ||
          season.status === SeasonStatus.ARCHIVED
        ) {
          throw new ManagementError(
            "LIFECYCLE_CONFLICT",
            "Closed seasons cannot be edited.",
          );
        }
        const startsOn =
          command.startsOn === undefined
            ? season.startsOn
            : toDate(command.startsOn);
        const endsOn =
          command.endsOn === undefined ? season.endsOn : toDate(command.endsOn);
        if (startsOn !== null && endsOn !== null && endsOn < startsOn) {
          throw new ManagementError(
            "INVALID_INPUT",
            "Season end cannot precede its start.",
          );
        }
        const updated = await tx.season.updateMany({
          where: {
            accountId: command.accountId,
            id: command.seasonId,
            revision: command.expectedRevision,
            status: { in: [SeasonStatus.DRAFT, SeasonStatus.ACTIVE] },
          },
          data: {
            ...(command.displayName === undefined
              ? {}
              : { displayName: command.displayName }),
            startsOn,
            endsOn,
            revision: { increment: 1 },
          },
        });
        if (updated.count !== 1) {
          await requireCurrentRevision(
            tx,
            "season",
            command.accountId,
            command.seasonId,
            command.expectedRevision,
          );
          throw new ManagementError(
            "PERSISTENCE_CONFLICT",
            "Season update conflicted.",
          );
        }
        await audit(tx, actor, "season.update", "Season", command.seasonId);
        return tx.season.findUniqueOrThrow({ where: { id: command.seasonId } });
      }, serializable);
    } catch (error) {
      translatePersistenceError(error);
    }
  }

  async transitionSeason(
    command: TransitionSeasonCommand,
    actor: ManagementActorContext,
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const season = await tx.season.findUnique({
          where: {
            accountId_id: {
              accountId: command.accountId,
              id: command.seasonId,
            },
          },
        });
        if (!season) {
          throw new ManagementError(
            "NOT_FOUND_OR_INACCESSIBLE",
            "Season is unavailable.",
          );
        }
        if (season.revision !== command.expectedRevision) {
          throw new ManagementError(
            "STALE_REVISION",
            "Expected season revision is stale.",
          );
        }
        const allowed: Record<SeasonStatus, readonly SeasonStatus[]> = {
          DRAFT: [SeasonStatus.ACTIVE, SeasonStatus.ARCHIVED],
          ACTIVE: [SeasonStatus.COMPLETED],
          COMPLETED: [SeasonStatus.ARCHIVED],
          ARCHIVED: [],
        };
        const next = SeasonStatus[command.status];
        if (!allowed[season.status].includes(next)) {
          throw new ManagementError(
            "LIFECYCLE_CONFLICT",
            "Season lifecycle transition is not permitted.",
          );
        }
        if (
          next === SeasonStatus.ARCHIVED &&
          (await tx.rosterEntry.count({
            where: {
              accountId: command.accountId,
              teamSeason: { seasonId: command.seasonId },
              status: RosterStatus.ACTIVE,
            },
          })) > 0
        ) {
          throw new ManagementError(
            "LIFECYCLE_CONFLICT",
            "A season with active roster periods cannot be archived.",
          );
        }
        const updated = await tx.season.updateMany({
          where: {
            accountId: command.accountId,
            id: command.seasonId,
            revision: command.expectedRevision,
          },
          data: {
            status: next,
            archivedAt: next === SeasonStatus.ARCHIVED ? new Date() : null,
            revision: { increment: 1 },
          },
        });
        if (updated.count !== 1) {
          await requireCurrentRevision(
            tx,
            "season",
            command.accountId,
            command.seasonId,
            command.expectedRevision,
          );
          throw new ManagementError(
            "PERSISTENCE_CONFLICT",
            "Season transition conflicted.",
          );
        }
        await audit(
          tx,
          actor,
          "season.transition",
          "Season",
          command.seasonId,
          {
            priorStatus: season.status,
            newStatus: next,
          },
        );
        return tx.season.findUniqueOrThrow({ where: { id: command.seasonId } });
      }, serializable);
    } catch (error) {
      translatePersistenceError(error);
    }
  }

  async addTeamSeason(
    command: AddTeamSeasonCommand,
    actor: ManagementActorContext,
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const team = await tx.team.findUnique({
          where: {
            accountId_id: {
              accountId: command.accountId,
              id: command.teamId,
            },
          },
        });
        const season = await tx.season.findUnique({
          where: {
            accountId_id: {
              accountId: command.accountId,
              id: command.seasonId,
            },
          },
        });
        if (!team || !season) {
          throw new ManagementError(
            "NOT_FOUND_OR_INACCESSIBLE",
            "Team or season is unavailable.",
          );
        }
        if (
          team.status !== TeamStatus.ACTIVE ||
          (season.status !== SeasonStatus.DRAFT &&
            season.status !== SeasonStatus.ACTIVE)
        ) {
          throw new ManagementError(
            "LIFECYCLE_CONFLICT",
            "Team-season participation is not permitted in this lifecycle.",
          );
        }
        const participation = await tx.teamSeason.create({
          data: command,
        });
        await audit(
          tx,
          actor,
          "team_season.create",
          "TeamSeason",
          participation.id,
        );
        return participation;
      }, serializable);
    } catch (error) {
      translatePersistenceError(error);
    }
  }

  async setTeamSeasonArchived(
    command: SetTeamSeasonArchivedCommand,
    actor: ManagementActorContext,
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const participation = await tx.teamSeason.findUnique({
          where: {
            accountId_id: {
              accountId: command.accountId,
              id: command.teamSeasonId,
            },
          },
          include: { team: true, season: true },
        });
        if (!participation) {
          throw new ManagementError(
            "NOT_FOUND_OR_INACCESSIBLE",
            "Team-season participation is unavailable.",
          );
        }
        if (participation.revision !== command.expectedRevision) {
          throw new ManagementError(
            "STALE_REVISION",
            "Expected team-season revision is stale.",
          );
        }
        if (
          !command.archived &&
          (participation.team.status !== TeamStatus.ACTIVE ||
            (participation.season.status !== SeasonStatus.DRAFT &&
              participation.season.status !== SeasonStatus.ACTIVE))
        ) {
          throw new ManagementError(
            "LIFECYCLE_CONFLICT",
            "Participation cannot be restored under closed parents.",
          );
        }
        if (
          command.archived &&
          ((await tx.rosterEntry.count({
            where: {
              accountId: command.accountId,
              teamSeasonId: command.teamSeasonId,
              status: RosterStatus.ACTIVE,
            },
          })) > 0 ||
            (await tx.game.count({
              where: {
                accountId: command.accountId,
                teamSeasonId: command.teamSeasonId,
                status: {
                  in: [
                    "DRAFT",
                    "READY",
                    "IN_PROGRESS",
                    "SUSPENDED",
                    "CORRECTED",
                  ],
                },
              },
            })) > 0)
        ) {
          throw new ManagementError(
            "LIFECYCLE_CONFLICT",
            "Active roster or game dependencies block participation archival.",
          );
        }
        const updated = await tx.teamSeason.updateMany({
          where: {
            accountId: command.accountId,
            id: command.teamSeasonId,
            revision: command.expectedRevision,
          },
          data: {
            archivedAt: command.archived ? new Date() : null,
            revision: { increment: 1 },
          },
        });
        if (updated.count !== 1) {
          await requireCurrentRevision(
            tx,
            "teamSeason",
            command.accountId,
            command.teamSeasonId,
            command.expectedRevision,
          );
          throw new ManagementError(
            "PERSISTENCE_CONFLICT",
            "Team-season lifecycle update conflicted.",
          );
        }
        await audit(
          tx,
          actor,
          command.archived ? "team_season.archive" : "team_season.restore",
          "TeamSeason",
          command.teamSeasonId,
        );
        return tx.teamSeason.findUniqueOrThrow({
          where: { id: command.teamSeasonId },
        });
      }, serializable);
    } catch (error) {
      translatePersistenceError(error);
    }
  }

  async createPlayer(
    command: CreatePlayerCommand,
    actor: ManagementActorContext,
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const player = await tx.player.create({ data: command });
        await audit(tx, actor, "player.create", "Player", player.id);
        return player;
      }, serializable);
    } catch (error) {
      translatePersistenceError(error);
    }
  }

  async updatePlayer(
    command: UpdatePlayerCommand,
    actor: ManagementActorContext,
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const player = await tx.player.findUnique({
          where: {
            accountId_id: {
              accountId: command.accountId,
              id: command.playerId,
            },
          },
        });
        if (!player) {
          throw new ManagementError(
            "NOT_FOUND_OR_INACCESSIBLE",
            "Player is unavailable.",
          );
        }
        if (player.revision !== command.expectedRevision) {
          throw new ManagementError(
            "STALE_REVISION",
            "Expected player revision is stale.",
          );
        }
        if (player.archivedAt !== null) {
          throw new ManagementError(
            "LIFECYCLE_CONFLICT",
            "Archived players cannot be edited.",
          );
        }
        const updated = await tx.player.updateMany({
          where: {
            accountId: command.accountId,
            id: command.playerId,
            revision: command.expectedRevision,
            archivedAt: null,
          },
          data: {
            ...(command.displayName === undefined
              ? {}
              : { displayName: command.displayName }),
            ...(command.battingSide === undefined
              ? {}
              : { battingSide: command.battingSide }),
            ...(command.throwingHand === undefined
              ? {}
              : { throwingHand: command.throwingHand }),
            revision: { increment: 1 },
          },
        });
        if (updated.count !== 1) {
          await requireCurrentRevision(
            tx,
            "player",
            command.accountId,
            command.playerId,
            command.expectedRevision,
          );
          throw new ManagementError(
            "PERSISTENCE_CONFLICT",
            "Player update conflicted.",
          );
        }
        await audit(tx, actor, "player.update", "Player", command.playerId);
        return tx.player.findUniqueOrThrow({ where: { id: command.playerId } });
      }, serializable);
    } catch (error) {
      translatePersistenceError(error);
    }
  }

  async setPlayerArchived(
    command: SetPlayerArchivedCommand,
    actor: ManagementActorContext,
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const player = await tx.player.findUnique({
          where: {
            accountId_id: {
              accountId: command.accountId,
              id: command.playerId,
            },
          },
        });
        if (!player) {
          throw new ManagementError(
            "NOT_FOUND_OR_INACCESSIBLE",
            "Player is unavailable.",
          );
        }
        if (player.revision !== command.expectedRevision) {
          throw new ManagementError(
            "STALE_REVISION",
            "Expected player revision is stale.",
          );
        }
        if (
          command.archived &&
          (await tx.rosterEntry.count({
            where: {
              accountId: command.accountId,
              playerId: command.playerId,
              status: RosterStatus.ACTIVE,
            },
          })) > 0
        ) {
          throw new ManagementError(
            "LIFECYCLE_CONFLICT",
            "A player with an active roster period cannot be archived.",
          );
        }
        const updated = await tx.player.updateMany({
          where: {
            accountId: command.accountId,
            id: command.playerId,
            revision: command.expectedRevision,
          },
          data: {
            archivedAt: command.archived ? new Date() : null,
            revision: { increment: 1 },
          },
        });
        if (updated.count !== 1) {
          await requireCurrentRevision(
            tx,
            "player",
            command.accountId,
            command.playerId,
            command.expectedRevision,
          );
          throw new ManagementError(
            "PERSISTENCE_CONFLICT",
            "Player lifecycle update conflicted.",
          );
        }
        await audit(
          tx,
          actor,
          command.archived ? "player.archive" : "player.restore",
          "Player",
          command.playerId,
        );
        return tx.player.findUniqueOrThrow({ where: { id: command.playerId } });
      }, serializable);
    } catch (error) {
      translatePersistenceError(error);
    }
  }

  async addRosterPeriod(
    command: AddRosterPeriodCommand,
    actor: ManagementActorContext,
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const participation = await tx.teamSeason.findUnique({
          where: {
            accountId_id: {
              accountId: command.accountId,
              id: command.teamSeasonId,
            },
          },
          include: { team: true, season: true },
        });
        const player = await tx.player.findUnique({
          where: {
            accountId_id: {
              accountId: command.accountId,
              id: command.playerId,
            },
          },
        });
        if (!participation || !player) {
          throw new ManagementError(
            "NOT_FOUND_OR_INACCESSIBLE",
            "Roster relationship is unavailable.",
          );
        }
        if (
          participation.archivedAt !== null ||
          participation.team.status !== TeamStatus.ACTIVE ||
          (participation.season.status !== SeasonStatus.DRAFT &&
            participation.season.status !== SeasonStatus.ACTIVE) ||
          player.archivedAt !== null
        ) {
          throw new ManagementError(
            "LIFECYCLE_CONFLICT",
            "Roster period cannot start in the current lifecycle.",
          );
        }
        const entry = await tx.rosterEntry.create({
          data: {
            accountId: command.accountId,
            teamSeasonId: command.teamSeasonId,
            playerId: command.playerId,
            startsAt: toInstant(command.startsAt),
            jerseyNumber: command.jerseyNumber,
            primaryPosition: command.primaryPosition,
            status: RosterStatus.ACTIVE,
          },
        });
        await audit(tx, actor, "roster_period.start", "RosterEntry", entry.id);
        return entry;
      }, serializable);
    } catch (error) {
      translatePersistenceError(error);
    }
  }

  async endRosterPeriod(
    command: EndRosterPeriodCommand,
    actor: ManagementActorContext,
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const entry = await tx.rosterEntry.findUnique({
          where: {
            accountId_id: {
              accountId: command.accountId,
              id: command.rosterEntryId,
            },
          },
        });
        if (!entry) {
          throw new ManagementError(
            "NOT_FOUND_OR_INACCESSIBLE",
            "Roster period is unavailable.",
          );
        }
        if (entry.revision !== command.expectedRevision) {
          throw new ManagementError(
            "STALE_REVISION",
            "Expected roster revision is stale.",
          );
        }
        const endsAt = toInstant(command.endsAt);
        if (entry.status !== RosterStatus.ACTIVE || endsAt <= entry.startsAt) {
          throw new ManagementError(
            "LIFECYCLE_CONFLICT",
            "Roster period cannot end at the requested instant.",
          );
        }
        const updated = await tx.rosterEntry.updateMany({
          where: {
            accountId: command.accountId,
            id: command.rosterEntryId,
            revision: command.expectedRevision,
            status: RosterStatus.ACTIVE,
            endsAt: null,
          },
          data: {
            status: RosterStatus[command.status],
            endsAt,
            archivedAt:
              command.status === "ARCHIVED" ? new Date() : entry.archivedAt,
            revision: { increment: 1 },
          },
        });
        if (updated.count !== 1) {
          await requireCurrentRevision(
            tx,
            "rosterEntry",
            command.accountId,
            command.rosterEntryId,
            command.expectedRevision,
          );
          throw new ManagementError(
            "PERSISTENCE_CONFLICT",
            "Roster deactivation conflicted.",
          );
        }
        await audit(
          tx,
          actor,
          "roster_period.end",
          "RosterEntry",
          command.rosterEntryId,
        );
        return tx.rosterEntry.findUniqueOrThrow({
          where: { id: command.rosterEntryId },
        });
      }, serializable);
    } catch (error) {
      translatePersistenceError(error);
    }
  }

  async changeJersey(
    command: ChangeJerseyCommand,
    actor: ManagementActorContext,
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const entry = await tx.rosterEntry.findUnique({
          where: {
            accountId_id: {
              accountId: command.accountId,
              id: command.rosterEntryId,
            },
          },
          include: {
            player: true,
            teamSeason: { include: { team: true, season: true } },
          },
        });
        if (!entry) {
          throw new ManagementError(
            "NOT_FOUND_OR_INACCESSIBLE",
            "Roster period is unavailable.",
          );
        }
        if (entry.revision !== command.expectedRevision) {
          throw new ManagementError(
            "STALE_REVISION",
            "Expected roster revision is stale.",
          );
        }
        const effectiveAt = toInstant(command.effectiveAt);
        if (
          entry.status !== RosterStatus.ACTIVE ||
          effectiveAt <= entry.startsAt ||
          entry.player.archivedAt !== null ||
          entry.teamSeason.archivedAt !== null ||
          entry.teamSeason.team.status !== TeamStatus.ACTIVE ||
          (entry.teamSeason.season.status !== SeasonStatus.DRAFT &&
            entry.teamSeason.season.status !== SeasonStatus.ACTIVE)
        ) {
          throw new ManagementError(
            "LIFECYCLE_CONFLICT",
            "Jersey change cannot create a new roster period.",
          );
        }
        const ended = await tx.rosterEntry.updateMany({
          where: {
            accountId: command.accountId,
            id: command.rosterEntryId,
            revision: command.expectedRevision,
            status: RosterStatus.ACTIVE,
            endsAt: null,
          },
          data: {
            status: RosterStatus.INACTIVE,
            endsAt: effectiveAt,
            revision: { increment: 1 },
          },
        });
        if (ended.count !== 1) {
          await requireCurrentRevision(
            tx,
            "rosterEntry",
            command.accountId,
            command.rosterEntryId,
            command.expectedRevision,
          );
          throw new ManagementError(
            "PERSISTENCE_CONFLICT",
            "Concurrent jersey change conflicted.",
          );
        }
        const replacement = await tx.rosterEntry.create({
          data: {
            accountId: command.accountId,
            teamSeasonId: entry.teamSeasonId,
            playerId: entry.playerId,
            startsAt: effectiveAt,
            jerseyNumber: command.jerseyNumber,
            primaryPosition:
              command.primaryPosition === undefined
                ? entry.primaryPosition
                : command.primaryPosition,
            status: RosterStatus.ACTIVE,
          },
        });
        await audit(
          tx,
          actor,
          "roster_period.jersey_change",
          "RosterEntry",
          replacement.id,
          {
            priorRosterEntryId: entry.id,
            priorRevision: command.expectedRevision,
          },
        );
        return { endedRosterEntryId: entry.id, rosterEntry: replacement };
      }, serializable);
    } catch (error) {
      translatePersistenceError(error);
    }
  }

  async listTeams(page: NamePage, actor: ManagementActorContext) {
    const items = await this.prisma.team.findMany({
      where: {
        accountId: page.accountId,
        ...(actor.scope.kind === "TEAM"
          ? { id: actor.scope.teamId }
          : actor.scope.kind === "SEASON"
            ? { teamSeasons: { some: { seasonId: actor.scope.seasonId } } }
            : {}),
        ...(page.after === null
          ? {}
          : {
              OR: [
                { displayName: { gt: page.after.displayName } },
                {
                  displayName: page.after.displayName,
                  id: { gt: page.after.id },
                },
              ],
            }),
      },
      orderBy: [{ displayName: "asc" }, { id: "asc" }],
      take: page.limit + 1,
    });
    const hasMore = items.length > page.limit;
    const visible = items.slice(0, page.limit);
    const last = visible.at(-1);
    return {
      items: visible,
      next:
        hasMore && last ? { displayName: last.displayName, id: last.id } : null,
    };
  }

  async listSeasons(page: NamePage, actor: ManagementActorContext) {
    const items = await this.prisma.season.findMany({
      where: {
        accountId: page.accountId,
        ...(actor.scope.kind === "SEASON"
          ? { id: actor.scope.seasonId }
          : actor.scope.kind === "TEAM"
            ? { teamSeasons: { some: { teamId: actor.scope.teamId } } }
            : {}),
        ...(page.after === null
          ? {}
          : {
              OR: [
                { displayName: { gt: page.after.displayName } },
                {
                  displayName: page.after.displayName,
                  id: { gt: page.after.id },
                },
              ],
            }),
      },
      orderBy: [{ displayName: "asc" }, { id: "asc" }],
      take: page.limit + 1,
    });
    const hasMore = items.length > page.limit;
    const visible = items.slice(0, page.limit);
    const last = visible.at(-1);
    return {
      items: visible,
      next:
        hasMore && last ? { displayName: last.displayName, id: last.id } : null,
    };
  }

  async listPlayers(page: NamePage, actor: ManagementActorContext) {
    const items = await this.prisma.player.findMany({
      where: {
        accountId: page.accountId,
        ...(actor.scope.kind === "TEAM"
          ? {
              rosterEntries: {
                some: { teamSeason: { teamId: actor.scope.teamId } },
              },
            }
          : actor.scope.kind === "SEASON"
            ? {
                rosterEntries: {
                  some: { teamSeason: { seasonId: actor.scope.seasonId } },
                },
              }
            : {}),
        ...(page.after === null
          ? {}
          : {
              OR: [
                { displayName: { gt: page.after.displayName } },
                {
                  displayName: page.after.displayName,
                  id: { gt: page.after.id },
                },
              ],
            }),
      },
      orderBy: [{ displayName: "asc" }, { id: "asc" }],
      take: page.limit + 1,
    });
    const hasMore = items.length > page.limit;
    const visible = items.slice(0, page.limit);
    const last = visible.at(-1);
    return {
      items: visible,
      next:
        hasMore && last ? { displayName: last.displayName, id: last.id } : null,
    };
  }

  async listRosterHistory(
    page: RosterHistoryPage,
    actor: ManagementActorContext,
  ) {
    const items = await this.prisma.rosterEntry.findMany({
      where: {
        accountId: page.accountId,
        ...(actor.scope.kind === "TEAM"
          ? { teamSeason: { teamId: actor.scope.teamId } }
          : actor.scope.kind === "SEASON"
            ? { teamSeason: { seasonId: actor.scope.seasonId } }
            : {}),
        ...(page.teamSeasonId === undefined
          ? {}
          : { teamSeasonId: page.teamSeasonId }),
        ...(page.playerId === undefined ? {} : { playerId: page.playerId }),
        ...(page.after === null
          ? {}
          : {
              OR: [
                { startsAt: { lt: toInstant(page.after.startsAt) } },
                {
                  startsAt: toInstant(page.after.startsAt),
                  id: { gt: page.after.id },
                },
              ],
            }),
      },
      orderBy: [{ startsAt: "desc" }, { id: "asc" }],
      take: page.limit + 1,
    });
    const hasMore = items.length > page.limit;
    const visible = items.slice(0, page.limit);
    const last = visible.at(-1);
    return {
      items: visible,
      next:
        hasMore && last
          ? { startsAt: last.startsAt.toISOString(), id: last.id }
          : null,
    };
  }
}
