import { createHash, randomUUID } from "node:crypto";

import {
  ActorKind,
  AuditOutcome,
  AuditScope,
  FantasyLeagueEventType,
  FantasyResultKind,
  FantasyWorkspaceStatus,
  MembershipStatus,
  NotificationPreferenceStatus,
  Prisma,
  type PrismaClient,
} from "@prisma/client";

import { canonicalJson } from "@/domain/events/event-log";
import {
  parseFantasyWorkspaceSnapshot,
  type FantasyLeagueWorkspaceSnapshot,
  type StoredFantasyResult,
} from "@/domain/fantasy-experience";
import type { FantasyDomainAuthority } from "@/domain/fantasy-domain";
import type {
  FantasyMatchupResult,
  FantasyStandingsResult,
  FantasyTeamPeriodResult,
} from "@/domain/fantasy-scoring";
import {
  applyFantasyTransaction,
  type FantasyTransactionCommand,
  type FantasyTransactionOutcome,
} from "@/domain/fantasy-transactions";
import type { TrustedActorContext } from "@/server/auth/types";
import { enqueueWebhookEvent } from "@/server/data/webhook-repository";

function digest(value: unknown): string {
  return `sha256:v1:${createHash("sha256")
    .update(canonicalJson(value))
    .digest("hex")}`;
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function domainAuthority(
  actor: TrustedActorContext,
  fantasyLeagueId: string,
  fantasyTeamId?: string,
): FantasyDomainAuthority {
  return Object.freeze({
    accountId: actor.accountId,
    actorId: actor.actorId,
    source: "ACCOUNT_PERMISSION",
    capability: "fantasy.roster.manage",
    scope: fantasyTeamId
      ? Object.freeze({
          kind: "FANTASY_TEAM" as const,
          fantasyLeagueId,
          fantasyTeamId,
        })
      : Object.freeze({
          kind: "FANTASY_LEAGUE" as const,
          fantasyLeagueId,
        }),
    authorityReferenceIds: Object.freeze([...actor.authorityReferenceIds]),
    authorizedAt: actor.authorizedAt,
  });
}

function newestResults(
  rows: readonly ResultRow[],
): readonly StoredFantasyResult[] {
  const latest = new Map<string, ResultRow>();
  for (const row of rows) {
    const key = `${row.kind}:${row.logicalId}`;
    const current = latest.get(key);
    if (!current || row.revision > current.revision) latest.set(key, row);
  }
  return Object.freeze(
    [...latest.values()].map((row) => {
      if (row.kind === FantasyResultKind.TEAM_PERIOD) {
        return Object.freeze({
          kind: "TEAM_PERIOD" as const,
          payload: row.payload as unknown as FantasyTeamPeriodResult,
        });
      }
      if (row.kind === FantasyResultKind.MATCHUP) {
        return Object.freeze({
          kind: "MATCHUP" as const,
          payload: row.payload as unknown as FantasyMatchupResult,
        });
      }
      return Object.freeze({
        kind: "STANDINGS" as const,
        payload: row.payload as unknown as FantasyStandingsResult,
      });
    }),
  );
}

const resultSelection = {
  kind: true,
  logicalId: true,
  revision: true,
  payload: true,
} satisfies Prisma.FantasyResultSnapshotSelect;

type ResultRow = Prisma.FantasyResultSnapshotGetPayload<{
  select: typeof resultSelection;
}>;

export type FantasyWorkspaceChoice = Readonly<{
  id: string;
  name: string;
  status: FantasyWorkspaceStatus;
  seasonName: string;
  lineupDeadlineAt: Date;
}>;

export type FantasyProvisioningChoice = Readonly<{
  id: string;
  name: string;
  playerCount: number;
}>;

export type FantasyWorkspaceRead = Readonly<{
  internalId: string;
  externalId: string;
  status: FantasyWorkspaceStatus;
  visibility: "PRIVATE" | "LEAGUE_MEMBERS" | "PUBLIC_METADATA_ONLY";
  revision: number;
  lineupDeadlineAt: Date;
  snapshot: FantasyLeagueWorkspaceSnapshot;
  results: readonly StoredFantasyResult[];
  playerNames: ReadonlyMap<string, string>;
  notificationPreferences: readonly Readonly<{
    id: string;
    channel: "EMAIL" | "DISCORD";
    subscribedEvents: readonly string[];
    status: "ACTIVE" | "OPTED_OUT" | "DISABLED";
    recipientEnabled: boolean;
    digestMode: "IMMEDIATE" | "DAILY_DIGEST";
    digestMinute: number;
    timeZone: string;
    quietHoursEnabled: boolean;
    quietStartMinute: number;
    quietEndMinute: number;
  }>[];
}>;

export type FantasyUiTransaction =
  | Readonly<{
      action: "ADD_PLAYER";
      operationId: string;
      fantasyTeamId: string;
      playerEntryId: string;
      targetSlotId: string;
      expectedRevision: number;
    }>
  | Readonly<{
      action: "LINEUP_SWAP";
      operationId: string;
      fantasyTeamId: string;
      firstSlotId: string;
      secondSlotId: string;
      expectedRevision: number;
    }>
  | Readonly<{
      action: "DROP_PLAYER";
      operationId: string;
      fantasyTeamId: string;
      playerEntryId: string;
      expectedRevision: number;
    }>
  | Readonly<{
      action: "WAIVER_CLAIM";
      operationId: string;
      fantasyTeamId: string;
      playerEntryId: string;
      targetSlotId: string;
      conditionalDropPlayerEntryId: string | null;
      expectedRevision: number;
    }>;

export type FantasyControlAction = Readonly<{
  operationId: string;
  action:
    | "PAUSE"
    | "RESUME"
    | "ARCHIVE"
    | "REQUEST_DELETION"
    | "RESET_WEEK"
    | "OPEN_APPROVAL"
    | "OPEN_DISPUTE"
    | "RESOLVE_CASE";
  reason: string;
  caseId: string | null;
  resolution: "APPROVED" | "REJECTED" | "RESOLVED" | null;
}>;

function transactionCommand(
  input: FantasyUiTransaction,
  snapshot: FantasyLeagueWorkspaceSnapshot,
  actor: TrustedActorContext,
  acceptedAt: string,
): FantasyTransactionCommand {
  const authority = domainAuthority(
    actor,
    snapshot.league.id,
    input.fantasyTeamId,
  );
  const roster = snapshot.transactionState.currentRosters.find(
    (candidate) => candidate.fantasyTeamId === input.fantasyTeamId,
  );
  if (!roster) throw new Error("Fantasy roster is unavailable.");
  const base = {
    operationId: input.operationId,
    auditId: `${input.operationId}-audit`,
    accountId: snapshot.league.accountId,
    fantasyLeagueId: snapshot.league.id,
    expectedRevision: input.expectedRevision,
    submittedAt: acceptedAt,
    authority,
  };
  if (input.action === "ADD_PLAYER") {
    return {
      ...base,
      action: "ADD_PLAYER",
      fantasyTeamId: input.fantasyTeamId,
      playerEntryId: input.playerEntryId,
      targetSlotId: input.targetSlotId,
      rosterSnapshotId: `${input.operationId}-roster`,
      assignmentMethod: "COMMISSIONER_ASSIGNMENT",
    };
  }
  if (input.action === "LINEUP_SWAP") {
    const first = roster.slots.find(({ id }) => id === input.firstSlotId);
    const second = roster.slots.find(({ id }) => id === input.secondSlotId);
    if (!first || !second || first.id === second.id) {
      throw new Error("Two distinct current roster slots are required.");
    }
    return {
      ...base,
      action: "LINEUP_CHANGE",
      fantasyTeamId: input.fantasyTeamId,
      rosterSnapshotId: `${input.operationId}-roster`,
      slots: roster.slots.map((slot) =>
        slot.id === first.id
          ? { ...slot, playerEntryId: second.playerEntryId }
          : slot.id === second.id
            ? { ...slot, playerEntryId: first.playerEntryId }
            : slot,
      ),
      commissionerCorrectionReason: null,
    };
  }
  if (input.action === "DROP_PLAYER") {
    return {
      ...base,
      action: "DROP_PLAYER",
      fantasyTeamId: input.fantasyTeamId,
      playerEntryId: input.playerEntryId,
      rosterSnapshotId: `${input.operationId}-roster`,
    };
  }
  const processingAt = snapshot.transactionState.policy.waiverProcessingInstants
    .filter((value) => Date.parse(value) > Date.parse(acceptedAt))
    .sort()[0];
  if (!processingAt) throw new Error("No future waiver window is available.");
  return {
    ...base,
    action: "SUBMIT_WAIVER_CLAIM",
    claimId: `${input.operationId}-claim`,
    fantasyTeamId: input.fantasyTeamId,
    playerEntryId: input.playerEntryId,
    conditionalDropPlayerEntryId: input.conditionalDropPlayerEntryId,
    targetSlotId: input.targetSlotId,
    rosterSnapshotId: `${input.operationId}-roster`,
    processingAt,
  };
}

export class PrismaFantasyExperienceRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listChoices(
    accountId: string,
  ): Promise<readonly FantasyWorkspaceChoice[]> {
    const rows = await this.prisma.fantasyLeagueWorkspace.findMany({
      where: { accountId },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }, { id: "asc" }],
      take: 100,
      select: {
        externalId: true,
        name: true,
        status: true,
        lineupDeadlineAt: true,
        season: { select: { displayName: true } },
      },
    });
    return Object.freeze(
      rows.map((row) =>
        Object.freeze({
          id: row.externalId,
          name: row.name,
          status: row.status,
          seasonName: row.season.displayName,
          lineupDeadlineAt: row.lineupDeadlineAt,
        }),
      ),
    );
  }

  async listProvisioningChoices(
    accountId: string,
  ): Promise<readonly FantasyProvisioningChoice[]> {
    const rows = await this.prisma.season.findMany({
      where: { accountId, archivedAt: null },
      orderBy: [{ startsOn: "desc" }, { displayName: "asc" }, { id: "asc" }],
      take: 100,
      select: {
        id: true,
        displayName: true,
        teamSeasons: {
          where: { archivedAt: null },
          select: {
            rosterEntries: {
              where: { status: "ACTIVE" },
              select: { playerId: true },
            },
          },
        },
      },
    });
    return Object.freeze(
      rows.map((row) =>
        Object.freeze({
          id: row.id,
          name: row.displayName,
          playerCount: new Set(
            row.teamSeasons.flatMap(({ rosterEntries }) =>
              rosterEntries.map(({ playerId }) => playerId),
            ),
          ).size,
        }),
      ),
    );
  }

  async provisioningSources(
    accountId: string,
    seasonId: string,
    membershipId: string,
  ) {
    const [season, membership, players] = await this.prisma.$transaction([
      this.prisma.season.findUnique({
        where: { accountId_id: { accountId, id: seasonId } },
        select: { id: true, displayName: true },
      }),
      this.prisma.accountMembership.findFirst({
        where: {
          accountId,
          id: membershipId,
          status: MembershipStatus.ACTIVE,
        },
        select: { id: true },
      }),
      this.prisma.player.findMany({
        where: {
          accountId,
          archivedAt: null,
          rosterEntries: {
            some: {
              accountId,
              status: "ACTIVE",
              archivedAt: null,
              teamSeason: { seasonId, archivedAt: null },
            },
          },
        },
        orderBy: [{ displayName: "asc" }, { id: "asc" }],
        take: 500,
        select: { id: true, revision: true },
      }),
    ]);
    return season && membership ? { season, membership, players } : null;
  }

  async createWorkspace(input: {
    accountId: string;
    seasonId: string;
    ownerMembershipId: string;
    leagueExternalId: string;
    lineupDeadlineAt: Date;
    snapshot: FantasyLeagueWorkspaceSnapshot;
    actor: TrustedActorContext;
    operationId: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const payload = {
        leagueId: input.leagueExternalId,
        seasonId: input.seasonId,
        modelVersionId: input.snapshot.model.modelVersionId,
        modelDigest: input.snapshot.model.contentDigest,
      };
      const workspace = await tx.fantasyLeagueWorkspace.create({
        data: {
          externalId: input.leagueExternalId,
          accountId: input.accountId,
          seasonId: input.seasonId,
          ownerMembershipId: input.ownerMembershipId,
          name: input.snapshot.league.name,
          status: FantasyWorkspaceStatus.ACTIVE,
          visibility: input.snapshot.league.visibility,
          rulesModelVersionId: input.snapshot.model.modelVersionId,
          rulesModelDigest: input.snapshot.model.contentDigest,
          revision: 0,
          lineupDeadlineAt: input.lineupDeadlineAt,
          snapshot: asJson(input.snapshot),
        },
      });
      await tx.fantasyLeagueEvent.create({
        data: {
          accountId: input.accountId,
          fantasyLeagueId: workspace.id,
          operationId: input.operationId,
          type: FantasyLeagueEventType.LEAGUE_CREATED,
          payloadDigest: digest(payload),
          payload,
          actorId: input.actor.actorId,
          actorUserId: input.actor.actorUserId,
          acceptedAt: new Date(input.snapshot.league.createdAt),
        },
      });
      const inheritedPreferences = await tx.notificationPreference.findMany({
        where: {
          accountId: input.accountId,
          membershipId: input.ownerMembershipId,
          scopeKey: "ACCOUNT",
          status: NotificationPreferenceStatus.ACTIVE,
          recipientEnabled: true,
        },
        orderBy: [{ channel: "asc" }, { id: "asc" }],
        distinct: ["channel"],
      });
      for (const preference of inheritedPreferences) {
        await tx.notificationPreference.create({
          data: {
            accountId: input.accountId,
            membershipId: input.ownerMembershipId,
            fantasyLeagueId: workspace.id,
            scopeKey: `FANTASY_LEAGUE:${workspace.id}`,
            channel: preference.channel,
            destinationReference: preference.destinationReference,
            subscribedEvents: [
              "FANTASY_TRANSACTION_UPDATED",
              "FANTASY_SCORING_UPDATED",
              "FANTASY_MATCHUP_FINAL",
            ],
            sensitiveContent: false,
            recipientEnabled: true,
            digestMode: preference.digestMode,
            digestMinute: preference.digestMinute,
            timeZone: preference.timeZone,
            quietHoursEnabled: preference.quietHoursEnabled,
            quietStartMinute: preference.quietStartMinute,
            quietEndMinute: preference.quietEndMinute,
          },
        });
      }
      return workspace.externalId;
    });
  }

  async loadWorkspace(
    accountId: string,
    leagueExternalId: string,
    membershipId: string,
  ): Promise<FantasyWorkspaceRead | null> {
    const workspace = await this.prisma.fantasyLeagueWorkspace.findUnique({
      where: {
        accountId_externalId: { accountId, externalId: leagueExternalId },
      },
      select: {
        id: true,
        externalId: true,
        status: true,
        visibility: true,
        revision: true,
        lineupDeadlineAt: true,
        snapshot: true,
        results: {
          orderBy: [{ calculatedAt: "desc" }, { revision: "desc" }],
          take: 500,
          select: resultSelection,
        },
        notificationPreferences: {
          where: { membershipId },
          orderBy: [{ channel: "asc" }, { id: "asc" }],
          select: {
            externalId: true,
            channel: true,
            subscribedEvents: true,
            status: true,
            recipientEnabled: true,
            digestMode: true,
            digestMinute: true,
            timeZone: true,
            quietHoursEnabled: true,
            quietStartMinute: true,
            quietEndMinute: true,
          },
        },
      },
    });
    if (!workspace) return null;
    const snapshot = parseFantasyWorkspaceSnapshot(workspace.snapshot);
    if (
      snapshot.league.accountId !== accountId ||
      snapshot.league.id !== workspace.externalId ||
      snapshot.model.modelVersionId !== snapshot.league.rules.modelVersionId
    ) {
      throw new Error("Stored fantasy workspace identity is inconsistent.");
    }
    const baseballPlayerIds = snapshot.transactionState.playerEntries.map(
      ({ baseballPlayerId }) => baseballPlayerId,
    );
    const [players, overlays] = await this.prisma.$transaction([
      this.prisma.player.findMany({
        where: { accountId, id: { in: baseballPlayerIds }, archivedAt: null },
        select: { id: true, displayName: true },
      }),
      this.prisma.privacyOverlayField.findMany({
        where: { accountId, playerId: { in: baseballPlayerIds } },
        orderBy: [
          { privacyOverlay: { effectiveOrder: "desc" } },
          { createdAt: "desc" },
          { id: "asc" },
        ],
        select: { playerId: true, replacementValue: true },
      }),
    ]);
    const playerNames = new Map(
      players.map((player) => [player.id, player.displayName]),
    );
    const overlaidPlayerIds = new Set<string>();
    for (const overlay of overlays) {
      if (
        overlay.playerId &&
        playerNames.has(overlay.playerId) &&
        !overlaidPlayerIds.has(overlay.playerId)
      ) {
        playerNames.set(overlay.playerId, overlay.replacementValue);
        overlaidPlayerIds.add(overlay.playerId);
      }
    }
    return Object.freeze({
      internalId: workspace.id,
      externalId: workspace.externalId,
      status: workspace.status,
      visibility: workspace.visibility,
      revision: workspace.revision,
      lineupDeadlineAt: workspace.lineupDeadlineAt,
      snapshot,
      results: newestResults(workspace.results),
      playerNames,
      notificationPreferences: Object.freeze(
        workspace.notificationPreferences.map((preference) =>
          Object.freeze({
            id: preference.externalId,
            channel: preference.channel,
            subscribedEvents: Object.freeze([...preference.subscribedEvents]),
            status: preference.status,
            recipientEnabled: preference.recipientEnabled,
            digestMode: preference.digestMode,
            digestMinute: preference.digestMinute,
            timeZone: preference.timeZone,
            quietHoursEnabled: preference.quietHoursEnabled,
            quietStartMinute: preference.quietStartMinute,
            quietEndMinute: preference.quietEndMinute,
          }),
        ),
      ),
    });
  }

  async applyUiTransaction(input: {
    accountId: string;
    leagueExternalId: string;
    transaction: FantasyUiTransaction;
    actor: TrustedActorContext;
    commissioner: boolean;
    acceptedAt: Date;
  }): Promise<
    Readonly<{ outcome: FantasyTransactionOutcome; duplicate: boolean }>
  > {
    return this.prisma.$transaction(async (tx) => {
      const workspaceRows = await tx.$queryRaw<
        Array<{ id: string; revision: number }>
      >(Prisma.sql`
        SELECT "id", "revision"
        FROM "FantasyLeagueWorkspace"
        WHERE "accountId" = ${input.accountId}
          AND "externalId" = ${input.leagueExternalId}::uuid
        FOR UPDATE
      `);
      const locked = workspaceRows[0];
      if (!locked) throw new Error("Fantasy league is unavailable.");
      const duplicate = await tx.fantasyLeagueEvent.findUnique({
        where: {
          fantasyLeagueId_operationId: {
            fantasyLeagueId: locked.id,
            operationId: input.transaction.operationId,
          },
        },
        select: { payload: true },
      });
      if (duplicate) {
        return {
          outcome: (
            duplicate.payload as unknown as {
              outcome: FantasyTransactionOutcome;
            }
          ).outcome,
          duplicate: true,
        };
      }
      const workspace = await tx.fantasyLeagueWorkspace.findUnique({
        where: { id: locked.id },
        select: { id: true, status: true, revision: true, snapshot: true },
      });
      if (!workspace || workspace.status !== FantasyWorkspaceStatus.ACTIVE) {
        throw new Error("Fantasy league is not accepting roster changes.");
      }
      const snapshot = parseFantasyWorkspaceSnapshot(workspace.snapshot);
      const team = snapshot.teams.find(
        ({ id }) => id === input.transaction.fantasyTeamId,
      );
      if (
        !team ||
        (!input.commissioner &&
          team.owner.accountMembershipId !== input.actor.membershipId)
      ) {
        throw new Error("Fantasy team is unavailable.");
      }
      const command = transactionCommand(
        input.transaction,
        snapshot,
        input.actor,
        input.acceptedAt.toISOString(),
      );
      const outcome = applyFantasyTransaction(
        snapshot.transactionState,
        command,
        {
          league: snapshot.league,
          teams: snapshot.teams,
          model: snapshot.model,
        },
      );
      const nextSnapshot = Object.freeze({
        ...snapshot,
        transactionState: outcome.state,
      });
      const payload = { outcome };
      await tx.fantasyLeagueWorkspace.update({
        where: { id: workspace.id },
        data: {
          revision: workspace.revision + 1,
          snapshot: asJson(nextSnapshot),
        },
      });
      await tx.fantasyLeagueEvent.create({
        data: {
          accountId: input.accountId,
          fantasyLeagueId: workspace.id,
          operationId: input.transaction.operationId,
          type: FantasyLeagueEventType.TRANSACTION_RECORDED,
          payloadDigest: digest(payload),
          payload: asJson(payload),
          actorId: input.actor.actorId,
          actorUserId: input.actor.actorUserId,
          acceptedAt: input.acceptedAt,
        },
      });
      if (outcome.record.status !== "DENIED") {
        await enqueueWebhookEvent(tx, {
          accountId: input.accountId,
          eventName: "FANTASY_TRANSACTION_UPDATED",
          deduplicationKey: `fantasy.transaction:${workspace.id}:${input.transaction.operationId}`,
          payload: {
            fantasyLeagueId: input.leagueExternalId,
            fantasyTeamId: team.id,
            operationId: input.transaction.operationId,
            action: outcome.record.action,
            status: outcome.record.status,
            revision: outcome.state.revision,
          },
          occurredAt: input.acceptedAt,
        });
      }
      return { outcome, duplicate: false };
    });
  }

  async applyControl(input: {
    accountId: string;
    leagueExternalId: string;
    control: FantasyControlAction;
    actor: TrustedActorContext;
    acceptedAt: Date;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id"
        FROM "FantasyLeagueWorkspace"
        WHERE "accountId" = ${input.accountId}
          AND "externalId" = ${input.leagueExternalId}::uuid
        FOR UPDATE
      `);
      const id = rows[0]?.id;
      if (!id) throw new Error("Fantasy league is unavailable.");
      const duplicate = await tx.fantasyLeagueEvent.findUnique({
        where: {
          fantasyLeagueId_operationId: {
            fantasyLeagueId: id,
            operationId: input.control.operationId,
          },
        },
      });
      if (duplicate) return { duplicate: true };
      const workspace = await tx.fantasyLeagueWorkspace.findUniqueOrThrow({
        where: { id },
      });
      const snapshot = parseFantasyWorkspaceSnapshot(workspace.snapshot);
      let status = workspace.status;
      let pausedAt = workspace.pausedAt;
      let archivedAt = workspace.archivedAt;
      let deletionRequestedAt = workspace.deletionRequestedAt;
      let cases = [...snapshot.commissioner.cases];
      if (input.control.action === "PAUSE") {
        if (status !== FantasyWorkspaceStatus.ACTIVE) {
          throw new Error("Only an active fantasy league can be paused.");
        }
        status = FantasyWorkspaceStatus.PAUSED;
        pausedAt = input.acceptedAt;
      } else if (input.control.action === "RESUME") {
        if (status !== FantasyWorkspaceStatus.PAUSED) {
          throw new Error("Only a paused fantasy league can resume.");
        }
        status = FantasyWorkspaceStatus.ACTIVE;
        pausedAt = null;
      } else if (input.control.action === "ARCHIVE") {
        if (status === FantasyWorkspaceStatus.PENDING_DELETION) {
          throw new Error("A deletion-requested league cannot be archived.");
        }
        status = FantasyWorkspaceStatus.ARCHIVED;
        pausedAt = null;
        archivedAt = input.acceptedAt;
      } else if (input.control.action === "REQUEST_DELETION") {
        status = FantasyWorkspaceStatus.PENDING_DELETION;
        deletionRequestedAt = input.acceptedAt;
      } else if (
        input.control.action === "OPEN_APPROVAL" ||
        input.control.action === "OPEN_DISPUTE"
      ) {
        cases.push(
          Object.freeze({
            id: input.control.caseId ?? randomUUID(),
            kind:
              input.control.action === "OPEN_APPROVAL"
                ? ("APPROVAL" as const)
                : ("DISPUTE" as const),
            status: "OPEN" as const,
            summary: input.control.reason,
            openedAt: input.acceptedAt.toISOString(),
            resolvedAt: null,
          }),
        );
      } else if (input.control.action === "RESOLVE_CASE") {
        let found = false;
        cases = cases.map((entry) => {
          if (entry.id !== input.control.caseId || entry.status !== "OPEN") {
            return entry;
          }
          found = true;
          return Object.freeze({
            ...entry,
            status: input.control.resolution ?? "RESOLVED",
            resolvedAt: input.acceptedAt.toISOString(),
          });
        });
        if (!found) throw new Error("Open fantasy case is unavailable.");
      }
      const nextSnapshot = Object.freeze({
        ...snapshot,
        commissioner: Object.freeze({ cases: Object.freeze(cases) }),
      });
      const payload = {
        action: input.control.action,
        reason: input.control.reason,
        caseId: input.control.caseId,
        resolution: input.control.resolution,
        historicalResultsChanged: false,
      };
      await tx.fantasyLeagueWorkspace.update({
        where: { id },
        data: {
          status,
          pausedAt,
          archivedAt,
          deletionRequestedAt,
          revision: workspace.revision + 1,
          snapshot: asJson(nextSnapshot),
        },
      });
      await tx.fantasyLeagueEvent.create({
        data: {
          accountId: input.accountId,
          fantasyLeagueId: id,
          operationId: input.control.operationId,
          type: FantasyLeagueEventType.CONTROL_RECORDED,
          payloadDigest: digest(payload),
          payload,
          actorId: input.actor.actorId,
          actorUserId: input.actor.actorUserId,
          acceptedAt: input.acceptedAt,
        },
      });
      return { duplicate: false };
    });
  }

  async updateOwnNotificationPreference(input: {
    accountId: string;
    leagueExternalId: string;
    preferenceExternalId: string;
    membershipId: string;
    operationId: string;
    recipientEnabled: boolean;
    subscribedEvents: readonly (
      | "FANTASY_TRANSACTION_UPDATED"
      | "FANTASY_SCORING_UPDATED"
      | "FANTASY_MATCHUP_FINAL"
    )[];
    digestMode: "IMMEDIATE" | "DAILY_DIGEST";
    digestMinute: number;
    timeZone: string;
    quietHoursEnabled: boolean;
    quietStartMinute: number;
    quietEndMinute: number;
    actor: TrustedActorContext;
    acceptedAt: Date;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const workspace = await tx.fantasyLeagueWorkspace.findUnique({
        where: {
          accountId_externalId: {
            accountId: input.accountId,
            externalId: input.leagueExternalId,
          },
        },
        select: { id: true, revision: true },
      });
      if (!workspace) throw new Error("Fantasy league is unavailable.");
      const preference = await tx.notificationPreference.findUnique({
        where: {
          accountId_externalId: {
            accountId: input.accountId,
            externalId: input.preferenceExternalId,
          },
        },
      });
      if (
        !preference ||
        preference.membershipId !== input.membershipId ||
        preference.fantasyLeagueId !== workspace.id ||
        preference.status !== NotificationPreferenceStatus.ACTIVE
      ) {
        throw new Error("Fantasy notification preference is unavailable.");
      }
      await tx.notificationPreference.update({
        where: { id: preference.id },
        data: {
          recipientEnabled: input.recipientEnabled,
          subscribedEvents: [...input.subscribedEvents],
          digestMode: input.digestMode,
          digestMinute: input.digestMinute,
          timeZone: input.timeZone,
          quietHoursEnabled: input.quietHoursEnabled,
          quietStartMinute: input.quietStartMinute,
          quietEndMinute: input.quietEndMinute,
        },
      });
      const payload = {
        preferenceId: input.preferenceExternalId,
        channel: preference.channel,
        recipientEnabled: input.recipientEnabled,
        eventCount: input.subscribedEvents.length,
        digestMode: input.digestMode,
        quietHoursEnabled: input.quietHoursEnabled,
      };
      await tx.fantasyLeagueWorkspace.update({
        where: { id: workspace.id },
        data: { revision: workspace.revision + 1 },
      });
      await tx.fantasyLeagueEvent.create({
        data: {
          accountId: input.accountId,
          fantasyLeagueId: workspace.id,
          operationId: input.operationId,
          type: FantasyLeagueEventType.NOTIFICATION_SETTINGS_UPDATED,
          payloadDigest: digest(payload),
          payload,
          actorId: input.actor.actorId,
          actorUserId: input.actor.actorUserId,
          acceptedAt: input.acceptedAt,
        },
      });
    });
  }

  async appendResult(input: {
    accountId: string;
    leagueExternalId: string;
    result: StoredFantasyResult;
    actor: TrustedActorContext;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const workspace = await tx.fantasyLeagueWorkspace.findUnique({
        where: {
          accountId_externalId: {
            accountId: input.accountId,
            externalId: input.leagueExternalId,
          },
        },
      });
      if (!workspace) throw new Error("Fantasy league is unavailable.");
      const payload = input.result.payload;
      if (
        payload.accountId !== input.accountId ||
        payload.fantasyLeagueId !== input.leagueExternalId
      ) {
        throw new Error(
          "Fantasy result crossed an Account or league boundary.",
        );
      }
      const snapshot = parseFantasyWorkspaceSnapshot(workspace.snapshot);
      if (
        payload.lineage.fantasyModelId !== snapshot.model.modelId ||
        payload.lineage.fantasyModelVersionId !==
          workspace.rulesModelVersionId ||
        payload.lineage.fantasyModelVersion !== snapshot.model.version ||
        payload.lineage.fantasyModelDigest !== workspace.rulesModelDigest
      ) {
        throw new Error(
          "Fantasy result does not match the league's sealed scoring model.",
        );
      }
      const leagueTeamIds = new Set(snapshot.teams.map(({ id }) => id));
      let resultTeamIds: readonly string[];
      if (input.result.kind === "TEAM_PERIOD") {
        resultTeamIds = [input.result.payload.fantasyTeamId];
      } else if (input.result.kind === "MATCHUP") {
        resultTeamIds = [
          input.result.payload.first.fantasyTeamId,
          input.result.payload.second.fantasyTeamId,
        ];
      } else {
        resultTeamIds = input.result.payload.records.map(
          ({ fantasyTeamId }) => fantasyTeamId,
        );
      }
      if (resultTeamIds.some((teamId) => !leagueTeamIds.has(teamId))) {
        throw new Error("Fantasy result references a team outside its league.");
      }
      const { resultDigest, ...semanticResult } = payload;
      if (digest(semanticResult) !== resultDigest) {
        throw new Error("Fantasy result digest verification failed.");
      }
      const kind =
        input.result.kind === "TEAM_PERIOD"
          ? FantasyResultKind.TEAM_PERIOD
          : input.result.kind === "MATCHUP"
            ? FantasyResultKind.MATCHUP
            : FantasyResultKind.STANDINGS;
      if ((payload.revision === 0) !== (payload.previousResultId === null)) {
        throw new Error("Fantasy result revision lineage is incomplete.");
      }
      const previous =
        payload.revision === 0
          ? null
          : await tx.fantasyResultSnapshot.findFirst({
              where: {
                fantasyLeagueId: workspace.id,
                kind,
                revision: payload.revision - 1,
                payload: {
                  path: ["id"],
                  equals: payload.previousResultId!,
                },
              },
            });
      if (payload.revision > 0 !== Boolean(previous)) {
        throw new Error("Fantasy result predecessor is unavailable.");
      }
      if (
        previous &&
        (new Date(payload.calculatedAt).getTime() <=
          previous.calculatedAt.getTime() ||
          (payload.correction !== null &&
            (payload.correction.previousResultId !== payload.previousResultId ||
              payload.correction.previousResultDigest !==
                previous.resultDigest)))
      ) {
        throw new Error("Fantasy result predecessor evidence is inconsistent.");
      }
      const periodSequence =
        input.result.kind === "STANDINGS"
          ? input.result.payload.throughPeriodSequence || null
          : input.result.payload.period.sequence;
      const finalizedAt =
        input.result.kind === "TEAM_PERIOD"
          ? input.result.payload.finalizedAt
          : input.result.payload.status === "FINAL"
            ? input.result.payload.calculatedAt
            : null;
      const row = await tx.fantasyResultSnapshot.create({
        data: {
          accountId: input.accountId,
          fantasyLeagueId: workspace.id,
          kind,
          logicalId: previous?.logicalId ?? payload.id,
          revision: payload.revision,
          previousSnapshotId: previous?.id ?? null,
          resultStatus: payload.status,
          periodSequence,
          fantasyModelVersionId: payload.lineage.fantasyModelVersionId,
          fantasyModelDigest: payload.lineage.fantasyModelDigest,
          baseballRulesetVersionIds: [
            ...payload.lineage.baseballRulesetVersionIds,
          ],
          statisticDerivationVersions: [
            ...payload.lineage.statisticDerivationVersions,
          ],
          sourceRevisions: [...payload.lineage.sourceRevisions],
          payload: asJson(payload),
          sourceDigest: payload.sourceDigest,
          resultDigest: payload.resultDigest,
          calculatedAt: new Date(payload.calculatedAt),
          finalizedAt: finalizedAt ? new Date(finalizedAt) : null,
        },
      });
      await tx.securityAuditRecord.create({
        data: {
          scope: AuditScope.ACCOUNT,
          accountId: input.accountId,
          actorKind:
            input.actor.actorKind === "USER"
              ? ActorKind.USER
              : ActorKind.SERVICE,
          actorId: input.actor.actorId,
          actorUserId: input.actor.actorUserId,
          action: "fantasy.result.append",
          capability: input.actor.capability,
          targetType: "FantasyResultSnapshot",
          targetId: row.id,
          outcome: AuditOutcome.SUCCEEDED,
          metadata: {
            fantasyLeagueId: workspace.id,
            kind,
            revision: payload.revision,
            resultDigest: payload.resultDigest,
          },
        },
      });
      if (input.result.kind === "TEAM_PERIOD") {
        const teamResult = input.result.payload;
        await enqueueWebhookEvent(tx, {
          accountId: input.accountId,
          eventName: "FANTASY_SCORING_UPDATED",
          deduplicationKey: `fantasy.score:${workspace.id}:${row.id}`,
          payload: {
            fantasyLeagueId: input.leagueExternalId,
            fantasyTeamId: teamResult.fantasyTeamId,
            resultId: row.externalId,
            resultRevision: payload.revision,
            periodSequence: teamResult.period.sequence,
            status: teamResult.status,
            totalMilliPoints: teamResult.totalMilliPoints,
          },
          occurredAt: new Date(payload.calculatedAt),
        });
      } else if (
        input.result.kind === "MATCHUP" &&
        payload.status === "FINAL"
      ) {
        const matchupResult = input.result.payload;
        await enqueueWebhookEvent(tx, {
          accountId: input.accountId,
          eventName: "FANTASY_MATCHUP_FINAL",
          deduplicationKey: `fantasy.matchup:${workspace.id}:${row.id}`,
          payload: {
            fantasyLeagueId: input.leagueExternalId,
            matchupId: row.externalId,
            periodSequence: matchupResult.period.sequence,
            firstFantasyTeamId: matchupResult.first.fantasyTeamId,
            secondFantasyTeamId: matchupResult.second.fantasyTeamId,
            winnerFantasyTeamId: matchupResult.winnerTeamId,
            outcome: matchupResult.outcome,
            resultRevision: payload.revision,
          },
          occurredAt: new Date(payload.calculatedAt),
        });
      }
      return row.externalId;
    });
  }
}
