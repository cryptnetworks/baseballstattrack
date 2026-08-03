import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  buildFantasyExperiencePresentation,
  provisionFantasyWorkspace,
  type FantasyExperiencePresentation,
  type StoredFantasyResult,
} from "@/domain/fantasy-experience";
import type {
  FantasyDomainAuthority,
  FantasyDomainCapability,
} from "@/domain/fantasy-domain";
import {
  PrismaFantasyExperienceRepository,
  type FantasyControlAction,
  type FantasyUiTransaction,
} from "@/server/data/fantasy-experience-repository";
import { getPrismaClient } from "@/server/data/prisma";
import {
  requireTrustedActor,
  type Capability,
  type TrustedActorContext,
} from "@/server/auth/types";

const id = z.string().trim().min(1).max(128);
const label = z.string().trim().min(1).max(120);
const operationId = z.uuid();
const instant = z.iso.datetime({ offset: true });

function domainAuthority(
  actor: TrustedActorContext,
  capability: FantasyDomainCapability,
  scope:
    | Readonly<{ kind: "ACCOUNT" }>
    | Readonly<{ kind: "FANTASY_LEAGUE"; fantasyLeagueId: string }>,
): FantasyDomainAuthority {
  return Object.freeze({
    accountId: actor.accountId,
    actorId: actor.actorId,
    source: "ACCOUNT_PERMISSION",
    capability,
    scope,
    authorityReferenceIds: Object.freeze([...actor.authorityReferenceIds]),
    authorizedAt: actor.authorizedAt,
  });
}

function futureDailyInstants(now: Date, count: number): readonly string[] {
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() + 1);
  start.setUTCHours(16, 0, 0, 0);
  return Object.freeze(
    Array.from({ length: count }, (_, index) =>
      new Date(start.getTime() + index * 86_400_000).toISOString(),
    ),
  );
}

function fantasyEvents(value: unknown) {
  return z
    .array(
      z.enum([
        "FANTASY_TRANSACTION_UPDATED",
        "FANTASY_SCORING_UPDATED",
        "FANTASY_MATCHUP_FINAL",
      ]),
    )
    .max(3)
    .refine((events) => new Set(events).size === events.length)
    .parse(value);
}

export class FantasyExperienceService {
  constructor(private readonly repository: PrismaFantasyExperienceRepository) {}

  async choices(accountIdInput: string, actorInput: TrustedActorContext) {
    const accountId = id.parse(accountIdInput);
    requireTrustedActor(actorInput, accountId, "fantasy.league.view");
    return this.repository.listChoices(accountId);
  }

  async provisioningChoices(
    accountIdInput: string,
    actorInput: TrustedActorContext,
  ) {
    const accountId = id.parse(accountIdInput);
    requireTrustedActor(actorInput, accountId, "fantasy.league.manage");
    return this.repository.listProvisioningChoices(accountId);
  }

  async workspace(
    input: Readonly<{
      accountId: string;
      leagueId: string;
      teamId: string | null;
    }>,
    viewActorInput: TrustedActorContext,
    manageActorInput: TrustedActorContext | null,
  ): Promise<
    Readonly<{
      presentation: FantasyExperiencePresentation;
      notificationPreferences: Awaited<
        ReturnType<PrismaFantasyExperienceRepository["loadWorkspace"]>
      > extends infer T
        ? T extends { notificationPreferences: infer P }
          ? P
          : never
        : never;
    }>
  > {
    const parsed = z
      .object({
        accountId: id,
        leagueId: z.uuid(),
        teamId: z.uuid().nullable(),
      })
      .strict()
      .parse(input);
    const viewActor = requireTrustedActor(
      viewActorInput,
      parsed.accountId,
      "fantasy.league.view",
    );
    const manageActor = manageActorInput
      ? requireTrustedActor(
          manageActorInput,
          parsed.accountId,
          "fantasy.league.manage",
        )
      : null;
    const workspace = await this.repository.loadWorkspace(
      parsed.accountId,
      parsed.leagueId,
      viewActor.membershipId!,
    );
    if (!workspace) throw new Error("Fantasy league is unavailable.");
    return Object.freeze({
      presentation: buildFantasyExperiencePresentation({
        snapshot: workspace.snapshot,
        status: workspace.status,
        lineupDeadlineAt: workspace.lineupDeadlineAt.toISOString(),
        membershipId: viewActor.membershipId!,
        requestedTeamId: parsed.teamId,
        canManageLeague: manageActor !== null,
        playerNames: workspace.playerNames,
        results: workspace.results,
      }),
      notificationPreferences: workspace.notificationPreferences,
    });
  }

  async provision(
    inputValue: unknown,
    actors: Readonly<{
      manageLeague: TrustedActorContext;
      activateLeague: TrustedActorContext;
      manageTeam: TrustedActorContext;
      manageRoster: TrustedActorContext;
    }>,
    now = new Date(),
  ) {
    const input = z
      .object({
        accountId: id,
        seasonId: id,
        leagueName: label,
        teamName: label,
        lineupDeadlineAt: instant,
        operationId,
      })
      .strict()
      .parse(inputValue);
    const manageLeague = requireTrustedActor(
      actors.manageLeague,
      input.accountId,
      "fantasy.league.manage",
    );
    const activateLeague = requireTrustedActor(
      actors.activateLeague,
      input.accountId,
      "fantasy.league.activate",
    );
    const manageTeam = requireTrustedActor(
      actors.manageTeam,
      input.accountId,
      "fantasy.team.manage",
    );
    const manageRoster = requireTrustedActor(
      actors.manageRoster,
      input.accountId,
      "fantasy.roster.manage",
    );
    if (
      !manageLeague.membershipId ||
      manageLeague.membershipId !== activateLeague.membershipId ||
      manageLeague.membershipId !== manageTeam.membershipId ||
      manageLeague.membershipId !== manageRoster.membershipId
    ) {
      throw new Error("Fantasy provisioning authority is inconsistent.");
    }
    const lineupDeadlineAt = new Date(input.lineupDeadlineAt);
    if (lineupDeadlineAt.getTime() <= now.getTime()) {
      throw new Error("Lineup deadline must be in the future.");
    }
    const sources = await this.repository.provisioningSources(
      input.accountId,
      input.seasonId,
      manageLeague.membershipId,
    );
    if (!sources)
      throw new Error("Fantasy provisioning sources are unavailable.");
    const fantasyLeagueId = randomUUID();
    const fantasyTeamId = randomUUID();
    const createdAt = now.toISOString();
    const waiverInstants = futureDailyInstants(now, 120);
    const snapshot = provisionFantasyWorkspace({
      accountId: input.accountId,
      seasonId: input.seasonId,
      fantasyLeagueId,
      fantasyTeamId,
      ownerMembershipId: manageLeague.membershipId,
      leagueName: input.leagueName,
      teamName: input.teamName,
      createdAt,
      playerIds: sources.players.map((player) => ({
        fantasyPlayerEntryId: randomUUID(),
        baseballPlayerId: player.id,
        rosterRevision: player.revision,
      })),
      manageLeagueAuthority: domainAuthority(
        manageLeague,
        "fantasy.league.manage",
        { kind: "ACCOUNT" },
      ),
      activateLeagueAuthority: domainAuthority(
        activateLeague,
        "fantasy.league.activate",
        { kind: "FANTASY_LEAGUE", fantasyLeagueId },
      ),
      manageTeamAuthority: domainAuthority(manageTeam, "fantasy.team.manage", {
        kind: "FANTASY_LEAGUE",
        fantasyLeagueId,
      }),
      manageRosterAuthority: domainAuthority(
        manageRoster,
        "fantasy.roster.manage",
        { kind: "FANTASY_LEAGUE", fantasyLeagueId },
      ),
      policy: {
        initialAssignmentMethod: "COMMISSIONER_ASSIGNMENT",
        initialAssignmentDeadline: lineupDeadlineAt.toISOString(),
        acquisitionMethod: "DAILY_WAIVERS",
        waiverProcessingInstants: waiverInstants,
        initialWaiverPriority: [fantasyTeamId],
        tradeProcessingInstants: waiverInstants,
        tradeDeadline: new Date(now.getTime() + 90 * 86_400_000).toISOString(),
        tradeAcceptance: "ALL_PARTICIPATING_MANAGERS",
        commissionerVeto: "NONE",
        lineupLocks: [
          {
            id: `${fantasyLeagueId}-first-lock`,
            startsAt: lineupDeadlineAt.toISOString(),
            endsAt: new Date(
              lineupDeadlineAt.getTime() + 5 * 60_000,
            ).toISOString(),
          },
        ],
      },
    });
    await this.repository.createWorkspace({
      accountId: input.accountId,
      seasonId: input.seasonId,
      ownerMembershipId: manageLeague.membershipId,
      leagueExternalId: fantasyLeagueId,
      lineupDeadlineAt,
      snapshot,
      actor: manageLeague,
      operationId: input.operationId,
    });
    return { leagueId: fantasyLeagueId, teamId: fantasyTeamId };
  }

  async transact(
    inputValue: unknown,
    actorInput: TrustedActorContext,
    commissioner: boolean,
    now = new Date(),
  ) {
    const common = {
      accountId: id,
      leagueId: z.uuid(),
      operationId,
      fantasyTeamId: z.uuid(),
      expectedRevision: z.int().nonnegative(),
    };
    const input = z
      .discriminatedUnion("action", [
        z
          .object({
            ...common,
            action: z.literal("ADD_PLAYER"),
            playerEntryId: id,
            targetSlotId: id,
          })
          .strict(),
        z
          .object({
            ...common,
            action: z.literal("LINEUP_SWAP"),
            firstSlotId: id,
            secondSlotId: id,
          })
          .strict(),
        z
          .object({
            ...common,
            action: z.literal("DROP_PLAYER"),
            playerEntryId: id,
          })
          .strict(),
        z
          .object({
            ...common,
            action: z.literal("WAIVER_CLAIM"),
            playerEntryId: id,
            targetSlotId: id,
            conditionalDropPlayerEntryId: id.nullable(),
          })
          .strict(),
      ])
      .parse(inputValue);
    const capability: Capability = commissioner
      ? "fantasy.league.manage"
      : "fantasy.roster.manage";
    const actor = requireTrustedActor(actorInput, input.accountId, capability);
    return this.repository.applyUiTransaction({
      accountId: input.accountId,
      leagueExternalId: input.leagueId,
      transaction: input as FantasyUiTransaction,
      actor,
      commissioner,
      acceptedAt: now,
    });
  }

  async control(
    inputValue: unknown,
    actorInput: TrustedActorContext,
    now = new Date(),
  ) {
    const input = z
      .object({
        accountId: id,
        leagueId: z.uuid(),
        operationId,
        action: z.enum([
          "PAUSE",
          "RESUME",
          "ARCHIVE",
          "REQUEST_DELETION",
          "RESET_WEEK",
          "OPEN_APPROVAL",
          "OPEN_DISPUTE",
          "RESOLVE_CASE",
        ]),
        reason: z.string().trim().min(3).max(240),
        caseId: id.nullable(),
        resolution: z.enum(["APPROVED", "REJECTED", "RESOLVED"]).nullable(),
      })
      .strict()
      .parse(inputValue);
    const actor = requireTrustedActor(
      actorInput,
      input.accountId,
      "fantasy.league.manage",
    );
    return this.repository.applyControl({
      accountId: input.accountId,
      leagueExternalId: input.leagueId,
      control: input as FantasyControlAction,
      actor,
      acceptedAt: now,
    });
  }

  async updateNotifications(
    inputValue: unknown,
    actorInput: TrustedActorContext,
    now = new Date(),
  ) {
    const input = z
      .object({
        accountId: id,
        leagueId: z.uuid(),
        preferenceId: z.uuid(),
        operationId,
        recipientEnabled: z.boolean(),
        subscribedEvents: z.unknown(),
        digestMode: z.enum(["IMMEDIATE", "DAILY_DIGEST"]),
        digestMinute: z.int().min(0).max(1_439),
        timeZone: z
          .string()
          .trim()
          .min(1)
          .max(128)
          .refine((value) => {
            try {
              new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
              return true;
            } catch {
              return false;
            }
          }),
        quietHoursEnabled: z.boolean(),
        quietStartMinute: z.int().min(0).max(1_439),
        quietEndMinute: z.int().min(0).max(1_439),
      })
      .strict()
      .superRefine((value, context) => {
        const events = fantasyEvents(value.subscribedEvents);
        if (value.recipientEnabled && events.length === 0) {
          context.addIssue({
            code: "custom",
            path: ["subscribedEvents"],
            message: "Choose an update type or disable this destination.",
          });
        }
        if (value.quietStartMinute === value.quietEndMinute) {
          context.addIssue({
            code: "custom",
            path: ["quietEndMinute"],
            message: "Quiet hours must have distinct boundaries.",
          });
        }
      })
      .parse(inputValue);
    const actor = requireTrustedActor(
      actorInput,
      input.accountId,
      "fantasy.league.view",
    );
    if (!actor.membershipId)
      throw new Error("Fantasy recipient is unavailable.");
    return this.repository.updateOwnNotificationPreference({
      ...input,
      subscribedEvents: fantasyEvents(input.subscribedEvents),
      leagueExternalId: input.leagueId,
      preferenceExternalId: input.preferenceId,
      membershipId: actor.membershipId,
      actor,
      acceptedAt: now,
    });
  }

  async recordResult(
    input: Readonly<{
      accountId: string;
      leagueId: string;
      result: StoredFantasyResult;
    }>,
    actorInput: TrustedActorContext,
  ) {
    const actor = requireTrustedActor(
      actorInput,
      id.parse(input.accountId),
      "fantasy.scoring.calculate",
    );
    return this.repository.appendResult({
      accountId: input.accountId,
      leagueExternalId: z.uuid().parse(input.leagueId),
      result: input.result,
      actor,
    });
  }

  async exportLeague(
    accountIdInput: string,
    leagueIdInput: string,
    actorInput: TrustedActorContext,
  ) {
    const accountId = id.parse(accountIdInput);
    const leagueId = z.uuid().parse(leagueIdInput);
    const actor = requireTrustedActor(
      actorInput,
      accountId,
      "fantasy.league.manage",
    );
    const workspace = await this.repository.loadWorkspace(
      accountId,
      leagueId,
      actor.membershipId!,
    );
    if (!workspace) throw new Error("Fantasy league is unavailable.");
    const presentation = buildFantasyExperiencePresentation({
      snapshot: workspace.snapshot,
      status: workspace.status,
      lineupDeadlineAt: workspace.lineupDeadlineAt.toISOString(),
      membershipId: actor.membershipId!,
      requestedTeamId: null,
      canManageLeague: true,
      playerNames: workspace.playerNames,
      results: workspace.results,
    });
    const exportResults = workspace.results.map((result) => ({
      kind: result.kind,
      id: result.payload.id,
      revision: result.payload.revision,
      previousResultId: result.payload.previousResultId,
      status: result.payload.status,
      calculatedAt: result.payload.calculatedAt,
      sourceDigest: result.payload.sourceDigest,
      resultDigest: result.payload.resultDigest,
      lineage: result.payload.lineage,
      correction:
        result.payload.correction === null
          ? null
          : {
              previousResultId: result.payload.correction.previousResultId,
              previousResultDigest:
                result.payload.correction.previousResultDigest,
            },
      ...(result.kind === "TEAM_PERIOD"
        ? {
            fantasyTeamId: result.payload.fantasyTeamId,
            periodSequence: result.payload.period.sequence,
            totalMilliPoints: result.payload.totalMilliPoints,
            categoryTotals: result.payload.categoryTotals,
            uncertainties: result.payload.uncertainties,
          }
        : result.kind === "MATCHUP"
          ? {
              periodSequence: result.payload.period.sequence,
              first: result.payload.first,
              second: result.payload.second,
              outcome: result.payload.outcome,
              winnerTeamId: result.payload.winnerTeamId,
            }
          : {
              throughPeriodSequence: result.payload.throughPeriodSequence,
              records: result.payload.records,
              completedMatchupCount: result.payload.completedMatchupCount,
              pendingMatchupCount: result.payload.pendingMatchupCount,
            }),
    }));
    return Object.freeze({
      formatVersion: 1,
      generatedAt: new Date().toISOString(),
      accountId,
      league: {
        id: presentation.leagueId,
        name: presentation.leagueName,
        status: presentation.leagueStatus,
        lineupDeadlineAt: presentation.lineupDeadlineAt,
        rulesModelVersionId: workspace.snapshot.league.rules.modelVersionId,
        rulesModelDigest: workspace.snapshot.league.rules.modelDigest,
      },
      teams: presentation.teams.map(({ id: teamId, name }) => ({
        id: teamId,
        name,
      })),
      roster: presentation.roster,
      transactions: presentation.transactions,
      results: exportResults,
      privacy: {
        privatePlayerFieldsExcluded: true,
        authorityReferencesExcluded: true,
        authenticationDataExcluded: true,
      },
    });
  }
}

let service: FantasyExperienceService | undefined;

export function getFantasyExperienceService() {
  service ??= new FantasyExperienceService(
    new PrismaFantasyExperienceRepository(getPrismaClient()),
  );
  return service;
}
