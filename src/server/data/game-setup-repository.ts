import { createHash, randomUUID } from "node:crypto";

import {
  ActorKind,
  AuditOutcome,
  AuditScope,
  GameStatus,
  Prisma,
  RulesetStatus,
  SeasonStatus,
  TeamStatus,
  type PrismaClient,
} from "@prisma/client";
import { z } from "zod";

import {
  GameSetupError,
  assertGameCreateScope,
  type CreateDraftGameCommand,
  type GameSetupActorContext,
  type LoadCurrentSetupQuery,
  type MarkSetupReadyCommand,
  type RosterCandidatePage,
  type SaveSetupRevisionCommand,
} from "@/domain/setup/game-setup";
import {
  GameEventError,
  canonicalJson,
  createInitialState,
  type AcceptedSetup,
} from "@/domain/events/event-log";

type Transaction = Prisma.TransactionClient;

const serializable = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
} as const;

const rulesetSetupSchema = z
  .object({
    scheduledInnings: z.int().min(1).max(20),
    maximumLineupSize: z.int().min(1).max(30).default(30),
    allowDefensiveOnly: z.boolean().default(true),
  })
  .passthrough();

function actorKind(actor: GameSetupActorContext): ActorKind {
  return actor.actorKind === "USER" ? ActorKind.USER : ActorKind.SERVICE;
}

async function audit(
  tx: Transaction,
  actor: GameSetupActorContext,
  action: string,
  gameId: string,
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
      targetType: "Game",
      targetId: gameId,
      outcome: AuditOutcome.SUCCEEDED,
      ...(metadata === undefined ? {} : { metadata }),
    },
  });
}

function payloadHash(command: SaveSetupRevisionCommand): string {
  return createHash("sha256").update(canonicalJson(command)).digest("hex");
}

function translatePersistenceError(error: unknown): never {
  if (error instanceof GameSetupError) throw error;
  const diagnostic =
    error instanceof Error
      ? `${error.name}:${error.message}`
      : JSON.stringify(error ?? {});
  if (
    diagnostic.includes("LineupSlotSnapshot") ||
    diagnostic.includes("GameTeamSnapshot")
  ) {
    throw new GameSetupError("INVALID_LINEUP", "Setup assignments conflict.");
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      throw new GameSetupError(
        "DUPLICATE_SUBMISSION",
        "A setup identity or submission already exists.",
      );
    }
    if (error.code === "P2003") {
      throw new GameSetupError(
        "ACCOUNT_MISMATCH",
        "A setup relationship is unavailable in this Account.",
      );
    }
    if (error.code === "P2034") {
      throw new GameSetupError(
        "PERSISTENCE_CONFLICT",
        "A concurrent setup operation conflicted.",
      );
    }
  }
  throw new GameSetupError(
    "PERSISTENCE_CONFLICT",
    "Game setup persistence failed.",
  );
}

function parseRuleset(configuration: Prisma.JsonValue) {
  const result = rulesetSetupSchema.safeParse(configuration);
  if (!result.success) {
    throw new GameSetupError(
      "INVALID_INPUT",
      "Ruleset setup configuration is invalid.",
      [{ field: "rulesetVersionId", code: "invalid_ruleset_configuration" }],
    );
  }
  return result.data;
}

function mapAcceptedSetup(
  snapshot: Prisma.GameSetupSnapshotGetPayload<{
    include: {
      teamSnapshots: true;
      lineupSlots: true;
    };
  }>,
): AcceptedSetup {
  const side = (name: "HOME" | "AWAY") => {
    const team = snapshot.teamSnapshots.find(
      (candidate) => candidate.side === name,
    );
    if (!team) {
      throw new GameSetupError("SETUP_INCOMPLETE", "Both sides are required.", [
        { field: `sides.${name}`, code: "missing_side" },
      ]);
    }
    const slots = snapshot.lineupSlots.filter(
      (candidate) => candidate.gameTeamSnapshotId === team.id,
    );
    const pitchers = slots.filter((candidate) => candidate.isStartingPitcher);
    const pitcher = pitchers[0];
    if (pitchers.length !== 1 || !pitcher) {
      throw new GameSetupError(
        "INVALID_PITCHER",
        "Each side requires one starting pitcher.",
        [{ field: `sides.${name}.lineup`, code: "starting_pitcher_count" }],
      );
    }
    return {
      startingPitcherId: pitcher.playerId ?? pitcher.id,
      lineup: slots.map((slot) => ({
        playerId: slot.playerId ?? slot.id,
        battingOrder: slot.battingOrder,
        position: slot.defensivePosition,
        active:
          slot.battingOrder !== null ||
          slot.defensivePosition !== null ||
          slot.isStartingPitcher,
      })),
    };
  };

  return {
    id: snapshot.id,
    accountId: snapshot.accountId,
    gameId: snapshot.gameId,
    setupRevision: snapshot.setupRevision,
    rulesetVersionId: snapshot.rulesetVersionId,
    scheduledInnings: snapshot.scheduledInnings,
    status: "READY",
    sides: { HOME: side("HOME"), AWAY: side("AWAY") },
  };
}

export class PrismaGameSetupRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getTeamSeasonTarget(accountId: string, teamSeasonId: string) {
    return this.prisma.teamSeason.findUnique({
      where: { accountId_id: { accountId, id: teamSeasonId } },
      select: { teamId: true, seasonId: true },
    });
  }

  async createDraftGame(
    command: CreateDraftGameCommand,
    actor: GameSetupActorContext,
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const participation = await tx.teamSeason.findUnique({
          where: {
            accountId_id: {
              accountId: command.accountId,
              id: command.managedTeamSeasonId,
            },
          },
          include: { team: true, season: true },
        });
        if (!participation) {
          throw new GameSetupError(
            "NOT_FOUND_OR_INACCESSIBLE",
            "Managed team-season is unavailable.",
          );
        }
        assertGameCreateScope(actor, {
          teamId: participation.teamId,
          seasonId: participation.seasonId,
        });
        if (
          participation.seasonId !== command.seasonId ||
          participation.archivedAt !== null ||
          participation.team.status !== TeamStatus.ACTIVE ||
          (participation.season.status !== SeasonStatus.DRAFT &&
            participation.season.status !== SeasonStatus.ACTIVE)
        ) {
          throw new GameSetupError(
            "LIFECYCLE_CONFLICT",
            "Game creation is not permitted for this participation.",
          );
        }
        const game = await tx.game.create({
          data: {
            accountId: command.accountId,
            seasonId: command.seasonId,
            teamSeasonId: command.managedTeamSeasonId,
            scheduledAt: new Date(command.scheduledAt),
            location: command.location,
            weatherCondition: command.weatherCondition,
            temperatureF: command.temperatureF,
          },
        });
        await audit(tx, actor, "game.create_draft", game.id);
        return game;
      }, serializable);
    } catch (error) {
      translatePersistenceError(error);
    }
  }

  async saveSetupRevision(
    command: SaveSetupRevisionCommand,
    actor: GameSetupActorContext,
  ) {
    const digest = payloadHash(command);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const prior = await tx.gameSetupSnapshot.findUnique({
          where: {
            accountId_gameId_createdByActorId_clientSubmissionId: {
              accountId: command.accountId,
              gameId: command.gameId,
              createdByActorId: actor.actorId,
              clientSubmissionId: command.clientSubmissionId,
            },
          },
          include: {
            teamSnapshots: { orderBy: [{ side: "asc" }, { id: "asc" }] },
            lineupSlots: { orderBy: [{ battingOrder: "asc" }, { id: "asc" }] },
          },
        });
        if (prior) {
          if (prior.payloadHash !== digest) {
            throw new GameSetupError(
              "DUPLICATE_SUBMISSION",
              "Setup submission was already used for different input.",
            );
          }
          return { setup: prior, idempotentReplay: true };
        }

        const game = await tx.game.findUnique({
          where: {
            accountId_id: {
              accountId: command.accountId,
              id: command.gameId,
            },
          },
        });
        if (!game) {
          throw new GameSetupError(
            "NOT_FOUND_OR_INACCESSIBLE",
            "Draft game is unavailable.",
          );
        }
        if (
          game.revision !== 0 ||
          (game.status !== GameStatus.DRAFT && game.status !== GameStatus.READY)
        ) {
          throw new GameSetupError(
            "IMMUTABLE_SETUP",
            "Setup cannot be edited after scoring starts.",
          );
        }
        if (game.setupRevision !== command.expectedSetupRevision) {
          throw new GameSetupError(
            "STALE_SETUP_REVISION",
            "Expected setup revision is stale.",
          );
        }

        const ruleset = await tx.rulesetVersion.findUnique({
          where: {
            accountId_id: {
              accountId: command.accountId,
              id: command.rulesetVersionId,
            },
          },
        });
        if (!ruleset || ruleset.status !== RulesetStatus.ACTIVE) {
          throw new GameSetupError(
            "NOT_FOUND_OR_INACCESSIBLE",
            "Active ruleset version is unavailable.",
          );
        }
        const setupRules = parseRuleset(ruleset.configuration);
        const managedTeamSeasonIds = command.sides
          .filter((side) => side.kind === "MANAGED")
          .map(({ teamSeasonId }) => teamSeasonId);
        const participations = await tx.teamSeason.findMany({
          where: {
            accountId: command.accountId,
            id: { in: managedTeamSeasonIds },
          },
          include: { team: true, season: true },
        });
        if (participations.length !== managedTeamSeasonIds.length) {
          throw new GameSetupError(
            "INVALID_PARTICIPANT",
            "Managed participant is unavailable.",
          );
        }
        const participationById = new Map(
          participations.map((participation) => [
            participation.id,
            participation,
          ]),
        );
        for (const participation of participations) {
          if (
            participation.seasonId !== game.seasonId ||
            participation.archivedAt !== null ||
            participation.team.status !== TeamStatus.ACTIVE ||
            (participation.season.status !== SeasonStatus.DRAFT &&
              participation.season.status !== SeasonStatus.ACTIVE)
          ) {
            throw new GameSetupError(
              "INVALID_PARTICIPANT",
              "Managed participant is not eligible for this game.",
            );
          }
        }

        const scheduledAt = new Date(command.scheduledAt);
        const managedSlots = command.sides.flatMap((side) =>
          side.kind === "MANAGED" ? side.lineup : [],
        );
        const rosterIds = managedSlots.map(
          ({ rosterEntryId }) => rosterEntryId,
        );
        const rosterEntries = await tx.rosterEntry.findMany({
          where: {
            accountId: command.accountId,
            id: { in: rosterIds },
          },
          include: { player: true },
        });
        if (rosterEntries.length !== rosterIds.length) {
          throw new GameSetupError(
            "ROSTER_INELIGIBLE",
            "A managed lineup roster entry is unavailable.",
          );
        }
        const rosterById = new Map(
          rosterEntries.map((entry) => [entry.id, entry]),
        );
        for (const side of command.sides) {
          if (side.kind !== "MANAGED") continue;
          for (const slot of side.lineup) {
            const entry = rosterById.get(slot.rosterEntryId);
            if (
              !entry ||
              entry.playerId !== slot.playerId ||
              entry.teamSeasonId !== side.teamSeasonId ||
              entry.status !== "ACTIVE" ||
              entry.endsAt !== null ||
              entry.startsAt > scheduledAt ||
              entry.player.archivedAt !== null
            ) {
              throw new GameSetupError(
                "ROSTER_INELIGIBLE",
                "Managed lineup does not match an eligible roster period.",
              );
            }
          }
        }

        const participantLabels = command.sides.map((side) =>
          side.kind === "MANAGED"
            ? participationById.get(side.teamSeasonId)!.team.displayName
            : side.displayName,
        );
        if (
          new Set(
            participantLabels.map((label) => label.toLocaleLowerCase("en-US")),
          ).size !== participantLabels.length
        ) {
          throw new GameSetupError(
            "INVALID_PARTICIPANT",
            "Home and away participant identities must be distinct.",
          );
        }

        const setupSnapshotId = randomUUID();
        const setupRevision = command.expectedSetupRevision + 1;
        await tx.gameSetupSnapshot.create({
          data: {
            id: setupSnapshotId,
            accountId: command.accountId,
            gameId: command.gameId,
            setupRevision,
            rulesetVersionId: command.rulesetVersionId,
            scheduledAt,
            location: command.location,
            weatherCondition: command.weatherCondition,
            temperatureF: command.temperatureF,
            scheduledInnings: setupRules.scheduledInnings,
            createdByActorId: actor.actorId,
            clientSubmissionId: command.clientSubmissionId,
            payloadHash: digest,
          },
        });

        for (const side of command.sides) {
          const teamSnapshotId = randomUUID();
          const participation =
            side.kind === "MANAGED"
              ? participationById.get(side.teamSeasonId)!
              : null;
          await tx.gameTeamSnapshot.create({
            data: {
              id: teamSnapshotId,
              accountId: command.accountId,
              gameId: command.gameId,
              setupSnapshotId,
              side: side.side,
              teamId: participation?.teamId ?? null,
              teamSeasonId: participation?.id ?? null,
              displayName:
                participation?.team.displayName ??
                (side.kind === "EXTERNAL" ? side.displayName : ""),
              isAccountTeam: side.kind === "MANAGED",
            },
          });
          for (const slot of side.lineup) {
            const entry =
              slot.kind === "MANAGED"
                ? rosterById.get(slot.rosterEntryId)!
                : null;
            await tx.lineupSlotSnapshot.create({
              data: {
                id: randomUUID(),
                accountId: command.accountId,
                gameId: command.gameId,
                setupSnapshotId,
                gameTeamSnapshotId: teamSnapshotId,
                playerId: slot.kind === "MANAGED" ? slot.playerId : null,
                rosterEntryId:
                  slot.kind === "MANAGED" ? slot.rosterEntryId : null,
                displayName:
                  entry?.player.displayName ??
                  (slot.kind === "EXTERNAL" ? slot.displayName : ""),
                jerseyNumber:
                  entry?.jerseyNumber ??
                  (slot.kind === "EXTERNAL" ? slot.jerseyNumber : null),
                battingOrder: slot.battingOrder,
                defensivePosition: slot.defensivePosition,
                isStartingPitcher: slot.isStartingPitcher,
              },
            });
          }
        }

        const updated = await tx.game.updateMany({
          where: {
            accountId: command.accountId,
            id: command.gameId,
            setupRevision: command.expectedSetupRevision,
            revision: 0,
            status: { in: [GameStatus.DRAFT, GameStatus.READY] },
          },
          data: {
            setupRevision,
            readySetupSnapshotId: null,
            status: GameStatus.DRAFT,
            scheduledAt,
            location: command.location,
            weatherCondition: command.weatherCondition,
            temperatureF: command.temperatureF,
          },
        });
        if (updated.count !== 1) {
          throw new GameSetupError(
            "STALE_SETUP_REVISION",
            "Concurrent setup writer advanced the draft.",
          );
        }
        await audit(tx, actor, "game.setup_revision.create", command.gameId, {
          setupSnapshotId,
          setupRevision,
        });
        const setup = await tx.gameSetupSnapshot.findUniqueOrThrow({
          where: { id: setupSnapshotId },
          include: {
            teamSnapshots: { orderBy: [{ side: "asc" }, { id: "asc" }] },
            lineupSlots: { orderBy: [{ battingOrder: "asc" }, { id: "asc" }] },
          },
        });
        return { setup, idempotentReplay: false };
      }, serializable);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === "P2002" || error.code === "P2034")
      ) {
        const prior = await this.prisma.gameSetupSnapshot.findUnique({
          where: {
            accountId_gameId_createdByActorId_clientSubmissionId: {
              accountId: command.accountId,
              gameId: command.gameId,
              createdByActorId: actor.actorId,
              clientSubmissionId: command.clientSubmissionId,
            },
          },
          include: {
            teamSnapshots: { orderBy: [{ side: "asc" }, { id: "asc" }] },
            lineupSlots: { orderBy: [{ battingOrder: "asc" }, { id: "asc" }] },
          },
        });
        if (prior) {
          if (prior.payloadHash !== digest) {
            throw new GameSetupError(
              "DUPLICATE_SUBMISSION",
              "Setup submission was already used for different input.",
            );
          }
          return { setup: prior, idempotentReplay: true };
        }
      }
      translatePersistenceError(error);
    }
  }

  async markSetupReady(
    command: MarkSetupReadyCommand,
    actor: GameSetupActorContext,
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const game = await tx.game.findUnique({
          where: {
            accountId_id: {
              accountId: command.accountId,
              id: command.gameId,
            },
          },
        });
        if (!game) {
          throw new GameSetupError(
            "NOT_FOUND_OR_INACCESSIBLE",
            "Draft game is unavailable.",
          );
        }
        if (
          game.status === GameStatus.READY &&
          game.readySetupSnapshotId === command.setupSnapshotId &&
          game.setupRevision === command.expectedSetupRevision
        ) {
          return {
            game,
            setupSnapshotId: command.setupSnapshotId,
            setupRevision: command.expectedSetupRevision,
            idempotentReplay: true,
          };
        }
        if (game.revision !== 0 || game.status !== GameStatus.DRAFT) {
          throw new GameSetupError(
            "IMMUTABLE_SETUP",
            "Only an unstarted draft game can become ready.",
          );
        }
        if (game.setupRevision !== command.expectedSetupRevision) {
          throw new GameSetupError(
            "STALE_SETUP_REVISION",
            "Expected setup revision is stale.",
          );
        }
        const snapshot = await tx.gameSetupSnapshot.findUnique({
          where: {
            accountId_gameId_id: {
              accountId: command.accountId,
              gameId: command.gameId,
              id: command.setupSnapshotId,
            },
          },
          include: {
            teamSnapshots: { orderBy: [{ side: "asc" }, { id: "asc" }] },
            lineupSlots: {
              orderBy: [{ battingOrder: "asc" }, { id: "asc" }],
              include: { player: true, rosterEntry: true },
            },
          },
        });
        if (
          !snapshot ||
          snapshot.setupRevision !== command.expectedSetupRevision
        ) {
          throw new GameSetupError(
            "STALE_SETUP_REVISION",
            "Named setup is not the current revision.",
          );
        }
        if (snapshot.teamSnapshots.length !== 2) {
          throw new GameSetupError(
            "SETUP_INCOMPLETE",
            "Ready setup requires home and away participants.",
          );
        }
        if (
          !snapshot.teamSnapshots.some(
            ({ teamSeasonId }) => teamSeasonId === game.teamSeasonId,
          )
        ) {
          throw new GameSetupError(
            "INVALID_PARTICIPANT",
            "Ready setup must include the game's managed team.",
          );
        }

        const scheduledAt = snapshot.scheduledAt ?? game.scheduledAt;
        if (!scheduledAt) {
          throw new GameSetupError(
            "SETUP_INCOMPLETE",
            "Ready setup requires a scheduled date.",
          );
        }
        const managedParticipationIds = snapshot.teamSnapshots
          .map(({ teamSeasonId }) => teamSeasonId)
          .filter((id): id is string => id !== null);
        const participations = await tx.teamSeason.findMany({
          where: {
            accountId: command.accountId,
            id: { in: managedParticipationIds },
          },
          include: { team: true, season: true },
        });
        if (
          participations.length !== managedParticipationIds.length ||
          participations.some(
            (participation) =>
              participation.seasonId !== game.seasonId ||
              participation.archivedAt !== null ||
              participation.team.status !== TeamStatus.ACTIVE ||
              (participation.season.status !== SeasonStatus.DRAFT &&
                participation.season.status !== SeasonStatus.ACTIVE),
          )
        ) {
          throw new GameSetupError(
            "INVALID_PARTICIPANT",
            "A managed participant is no longer eligible.",
          );
        }
        for (const slot of snapshot.lineupSlots) {
          if (slot.playerId === null && slot.rosterEntryId === null) continue;
          if (
            !slot.player ||
            !slot.rosterEntry ||
            slot.player.archivedAt !== null ||
            slot.rosterEntry.status !== "ACTIVE" ||
            slot.rosterEntry.endsAt !== null ||
            slot.rosterEntry.startsAt > scheduledAt
          ) {
            throw new GameSetupError(
              "ROSTER_INELIGIBLE",
              "A managed lineup player is no longer eligible.",
            );
          }
        }

        const ruleset = await tx.rulesetVersion.findUnique({
          where: {
            accountId_id: {
              accountId: command.accountId,
              id: snapshot.rulesetVersionId,
            },
          },
        });
        if (!ruleset || ruleset.status !== RulesetStatus.ACTIVE) {
          throw new GameSetupError(
            "SETUP_INCOMPLETE",
            "Ready setup requires an active ruleset.",
          );
        }
        const setupRules = parseRuleset(ruleset.configuration);
        for (const team of snapshot.teamSnapshots) {
          const slots = snapshot.lineupSlots.filter(
            ({ gameTeamSnapshotId }) => gameTeamSnapshotId === team.id,
          );
          if (slots.length > setupRules.maximumLineupSize) {
            throw new GameSetupError(
              "INVALID_LINEUP",
              "Lineup exceeds the ruleset maximum.",
            );
          }
          if (
            !setupRules.allowDefensiveOnly &&
            slots.some(
              ({ battingOrder: order, defensivePosition, isStartingPitcher }) =>
                order === null &&
                (defensivePosition !== null || isStartingPitcher),
            )
          ) {
            throw new GameSetupError(
              "INVALID_LINEUP",
              "Ruleset does not allow defensive-only starters.",
            );
          }
        }
        try {
          createInitialState(mapAcceptedSetup(snapshot));
        } catch (error) {
          if (error instanceof GameSetupError) throw error;
          if (error instanceof GameEventError) {
            throw new GameSetupError(
              error.code === "INVALID_PITCHER"
                ? "INVALID_PITCHER"
                : "INVALID_LINEUP",
              "Setup is not ready for deterministic replay.",
            );
          }
          throw error;
        }

        const updated = await tx.game.updateMany({
          where: {
            accountId: command.accountId,
            id: command.gameId,
            status: GameStatus.DRAFT,
            revision: 0,
            setupRevision: command.expectedSetupRevision,
            readySetupSnapshotId: null,
          },
          data: {
            status: GameStatus.READY,
            readySetupSnapshotId: command.setupSnapshotId,
          },
        });
        if (updated.count !== 1) {
          throw new GameSetupError(
            "PERSISTENCE_CONFLICT",
            "Concurrent readiness or setup edit won.",
          );
        }
        await audit(tx, actor, "game.setup_ready", command.gameId, {
          setupSnapshotId: command.setupSnapshotId,
          setupRevision: command.expectedSetupRevision,
        });
        return {
          game: await tx.game.findUniqueOrThrow({
            where: { id: command.gameId },
          }),
          setupSnapshotId: command.setupSnapshotId,
          setupRevision: command.expectedSetupRevision,
          idempotentReplay: false,
        };
      }, serializable);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === "P2002" || error.code === "P2034")
      ) {
        const game = await this.prisma.game.findUnique({
          where: {
            accountId_id: {
              accountId: command.accountId,
              id: command.gameId,
            },
          },
        });
        if (
          game?.status === GameStatus.READY &&
          game.readySetupSnapshotId === command.setupSnapshotId &&
          game.setupRevision === command.expectedSetupRevision
        ) {
          return {
            game,
            setupSnapshotId: command.setupSnapshotId,
            setupRevision: command.expectedSetupRevision,
            idempotentReplay: true,
          };
        }
      }
      translatePersistenceError(error);
    }
  }

  async loadCurrentSetup(query: LoadCurrentSetupQuery) {
    const game = await this.prisma.game.findUnique({
      where: {
        accountId_id: { accountId: query.accountId, id: query.gameId },
      },
    });
    if (!game) {
      throw new GameSetupError(
        "NOT_FOUND_OR_INACCESSIBLE",
        "Game is unavailable.",
      );
    }
    const setup =
      game.setupRevision === 0
        ? null
        : await this.prisma.gameSetupSnapshot.findUnique({
            where: {
              gameId_setupRevision: {
                gameId: query.gameId,
                setupRevision: game.setupRevision,
              },
            },
            include: {
              teamSnapshots: { orderBy: [{ side: "asc" }, { id: "asc" }] },
              lineupSlots: {
                orderBy: [{ battingOrder: "asc" }, { id: "asc" }],
              },
            },
          });
    return { game, setup };
  }

  async listRosterCandidates(page: RosterCandidatePage) {
    const game = await this.prisma.game.findUnique({
      where: {
        accountId_id: { accountId: page.accountId, id: page.gameId },
      },
      select: { scheduledAt: true, seasonId: true },
    });
    const participation = await this.prisma.teamSeason.findUnique({
      where: {
        accountId_id: {
          accountId: page.accountId,
          id: page.teamSeasonId,
        },
      },
      select: { seasonId: true, archivedAt: true },
    });
    if (
      !game ||
      !participation ||
      participation.seasonId !== game.seasonId ||
      participation.archivedAt !== null ||
      game.scheduledAt === null
    ) {
      throw new GameSetupError(
        "INVALID_PARTICIPANT",
        "Roster candidate scope is unavailable.",
      );
    }
    const players = await this.prisma.player.findMany({
      where: {
        accountId: page.accountId,
        archivedAt: null,
        rosterEntries: {
          some: {
            accountId: page.accountId,
            teamSeasonId: page.teamSeasonId,
            status: "ACTIVE",
            endsAt: null,
            startsAt: { lte: game.scheduledAt },
          },
        },
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
      include: {
        rosterEntries: {
          where: {
            accountId: page.accountId,
            teamSeasonId: page.teamSeasonId,
            status: "ACTIVE",
            endsAt: null,
            startsAt: { lte: game.scheduledAt },
          },
          take: 1,
        },
      },
      orderBy: [{ displayName: "asc" }, { id: "asc" }],
      take: page.limit + 1,
    });
    const hasMore = players.length > page.limit;
    const visible = players.slice(0, page.limit);
    const last = visible.at(-1);
    return {
      items: visible.map((player) => ({
        player,
        rosterEntry: player.rosterEntries[0]!,
      })),
      next:
        hasMore && last ? { displayName: last.displayName, id: last.id } : null,
    };
  }
}
