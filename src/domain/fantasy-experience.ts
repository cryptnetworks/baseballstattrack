import { z } from "zod";

import {
  createFantasyLeague,
  createFantasyPlayerEntry,
  createFantasyRosterSnapshot,
  createFantasyTeam,
  transitionFantasyLeague,
  transitionFantasyTeam,
  type FantasyDomainAuthority,
  type FantasyLeague,
  type FantasyRosterSlot,
  type FantasyTeam,
} from "@/domain/fantasy-domain";
import {
  INITIAL_FANTASY_FORMAT,
  createFantasyScoringModelVersion,
  transitionFantasyScoringModel,
  verifyFantasyScoringModel,
  type FantasyScoringModelVersion,
} from "@/domain/fantasy-rules";
import type {
  FantasyMatchupResult,
  FantasyStandingsResult,
  FantasyTeamPeriodResult,
} from "@/domain/fantasy-scoring";
import {
  createFantasyTransactionState,
  type FantasyTransactionState,
} from "@/domain/fantasy-transactions";

export const FANTASY_EXPERIENCE_SCHEMA_VERSION = 1 as const;

export const fantasyExperienceSections = [
  "overview",
  "team",
  "roster",
  "transactions",
  "standings",
  "scoring",
  "notifications",
  "commissioner",
] as const;
export type FantasyExperienceSection =
  (typeof fantasyExperienceSections)[number];

export const fantasyExperienceSectionSchema = z.enum(fantasyExperienceSections);

export type FantasyCommissionerCase = Readonly<{
  id: string;
  kind: "APPROVAL" | "DISPUTE";
  status: "OPEN" | "APPROVED" | "REJECTED" | "RESOLVED";
  summary: string;
  openedAt: string;
  resolvedAt: string | null;
}>;

export type FantasyLeagueWorkspaceSnapshot = Readonly<{
  schemaVersion: typeof FANTASY_EXPERIENCE_SCHEMA_VERSION;
  league: FantasyLeague;
  model: FantasyScoringModelVersion;
  teams: readonly FantasyTeam[];
  transactionState: FantasyTransactionState;
  commissioner: Readonly<{
    cases: readonly FantasyCommissionerCase[];
  }>;
}>;

export type StoredFantasyResult =
  | Readonly<{ kind: "TEAM_PERIOD"; payload: FantasyTeamPeriodResult }>
  | Readonly<{ kind: "MATCHUP"; payload: FantasyMatchupResult }>
  | Readonly<{ kind: "STANDINGS"; payload: FantasyStandingsResult }>;

const stableId = z.string().trim().min(1).max(128);
const instant = z.iso.datetime({ offset: true });
const commissionerCaseSchema = z
  .object({
    id: stableId,
    kind: z.enum(["APPROVAL", "DISPUTE"]),
    status: z.enum(["OPEN", "APPROVED", "REJECTED", "RESOLVED"]),
    summary: z.string().trim().min(1).max(240),
    openedAt: instant,
    resolvedAt: instant.nullable(),
  })
  .strict();

const workspaceEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(FANTASY_EXPERIENCE_SCHEMA_VERSION),
    league: z.object({ id: stableId, accountId: stableId }).passthrough(),
    model: z
      .object({ modelVersionId: stableId, contentDigest: stableId })
      .passthrough(),
    teams: z.array(
      z
        .object({
          id: stableId,
          accountId: stableId,
          fantasyLeagueId: stableId,
          owner: z.object({ accountMembershipId: stableId }).passthrough(),
        })
        .passthrough(),
    ),
    transactionState: z
      .object({
        accountId: stableId,
        fantasyLeagueId: stableId,
        revision: z.int().nonnegative(),
        playerEntries: z.array(z.unknown()),
        currentRosters: z.array(z.unknown()),
        transactions: z.array(z.unknown()),
        waiverClaims: z.array(z.unknown()),
      })
      .passthrough(),
    commissioner: z
      .object({ cases: z.array(commissionerCaseSchema).max(500) })
      .strict(),
  })
  .strict();

export class FantasyExperienceError extends Error {
  constructor(
    readonly code:
      | "INVALID_WORKSPACE"
      | "ACCOUNT_MISMATCH"
      | "LEAGUE_MISMATCH"
      | "TEAM_UNAVAILABLE"
      | "RESULT_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "FantasyExperienceError";
  }
}

export function parseFantasyWorkspaceSnapshot(
  value: unknown,
): FantasyLeagueWorkspaceSnapshot {
  const parsed = workspaceEnvelopeSchema.safeParse(value);
  if (!parsed.success) {
    throw new FantasyExperienceError(
      "INVALID_WORKSPACE",
      "Fantasy workspace snapshot is invalid.",
    );
  }
  const snapshot = value as FantasyLeagueWorkspaceSnapshot;
  try {
    verifyFantasyScoringModel(snapshot.model);
  } catch {
    throw new FantasyExperienceError(
      "INVALID_WORKSPACE",
      "Fantasy workspace model evidence is invalid.",
    );
  }
  if (
    snapshot.league.rules.modelVersionId !== snapshot.model.modelVersionId ||
    snapshot.league.rules.modelDigest !== snapshot.model.contentDigest ||
    snapshot.transactionState.accountId !== snapshot.league.accountId ||
    snapshot.transactionState.fantasyLeagueId !== snapshot.league.id ||
    snapshot.teams.some(
      (team) =>
        team.accountId !== snapshot.league.accountId ||
        team.fantasyLeagueId !== snapshot.league.id,
    )
  ) {
    throw new FantasyExperienceError(
      "LEAGUE_MISMATCH",
      "Fantasy workspace ancestry or sealed model binding is inconsistent.",
    );
  }
  return snapshot;
}

export function createPlatformFantasyModel(): FantasyScoringModelVersion {
  const draft = createFantasyScoringModelVersion({
    modelId: "platform-weekly-points",
    modelVersionId: "platform-weekly-points-v1",
    owner: { kind: "PLATFORM", id: null },
    version: 1,
    name: "Platform weekly points",
    format: INITIAL_FANTASY_FORMAT,
    statisticRegistryVersion: "baseball-statistics:v1",
    categories: [
      {
        id: "runs",
        domain: "BATTING",
        sourceStatistic: "batting.runs",
        label: "Runs",
        milliPointsPerUnit: 1_000,
      },
      {
        id: "hits",
        domain: "BATTING",
        sourceStatistic: "batting.hits",
        label: "Hits",
        milliPointsPerUnit: 1_000,
      },
      {
        id: "home-runs",
        domain: "BATTING",
        sourceStatistic: "batting.home_runs",
        label: "Home runs",
        milliPointsPerUnit: 3_000,
      },
      {
        id: "runs-batted-in",
        domain: "BATTING",
        sourceStatistic: "batting.runs_batted_in",
        label: "RBI",
        milliPointsPerUnit: 1_000,
      },
      {
        id: "pitching-strikeouts",
        domain: "PITCHING",
        sourceStatistic: "pitching.strikeouts",
        label: "Pitching strikeouts",
        milliPointsPerUnit: 1_000,
      },
      {
        id: "earned-runs",
        domain: "PITCHING",
        sourceStatistic: "pitching.earned_runs",
        label: "Earned runs",
        milliPointsPerUnit: -1_000,
      },
    ],
    eligibility: {
      rosterSource: "EXACT_ACCOUNT_ROSTER_AT_LOCK",
      unknownEligibility: "INELIGIBLE",
      positionRules: [
        {
          positionCode: "UTIL",
          minimumAppearances: 0,
          minimumPitchingOuts: 0,
        },
      ],
    },
    roster: {
      maximumRosterSize: 8,
      benchSlots: 4,
      lineupSlots: [{ id: "UTIL", count: 4, eligiblePositionCodes: ["UTIL"] }],
      lineupLock: "WEEKLY_PERIOD_START",
      missingLineupBehavior: "ZERO_POINTS",
      benchScoring: "EXCLUDED",
    },
    cadence: {
      periodKind: "WEEKLY",
      boundarySource: "SEALED_UTC_INTERVALS",
      completionGraceHours: 48,
      correctionPolicy: "BEFORE_FINALIZATION_ONLY",
      regularSeasonTie: "TIE",
      playoffTieBreaker: "HIGHER_PREDECLARED_SEED",
    },
    lifecycle: "DRAFT",
  });
  return transitionFantasyScoringModel(
    transitionFantasyScoringModel(draft, "REVIEWED"),
    "ACTIVE",
  );
}

function activeSlots(): readonly FantasyRosterSlot[] {
  return Object.freeze([
    ...Array.from({ length: 4 }, (_, index) => ({
      id: `active-${index + 1}`,
      kind: "ACTIVE" as const,
      lineupSlotRuleId: "UTIL",
      playerEntryId: null,
    })),
    ...Array.from({ length: 4 }, (_, index) => ({
      id: `bench-${index + 1}`,
      kind: "BENCH" as const,
      lineupSlotRuleId: null,
      playerEntryId: null,
    })),
  ]);
}

export function provisionFantasyWorkspace(
  input: Readonly<{
    accountId: string;
    seasonId: string;
    fantasyLeagueId: string;
    fantasyTeamId: string;
    ownerMembershipId: string;
    leagueName: string;
    teamName: string;
    createdAt: string;
    playerIds: readonly Readonly<{
      fantasyPlayerEntryId: string;
      baseballPlayerId: string;
      rosterRevision: number;
    }>[];
    manageLeagueAuthority: FantasyDomainAuthority;
    activateLeagueAuthority: FantasyDomainAuthority;
    manageTeamAuthority: FantasyDomainAuthority;
    manageRosterAuthority: FantasyDomainAuthority;
    policy: FantasyTransactionState["policy"];
  }>,
): FantasyLeagueWorkspaceSnapshot {
  const model = createPlatformFantasyModel();
  const draftLeague = createFantasyLeague(
    {
      id: input.fantasyLeagueId,
      accountId: input.accountId,
      administrativeScope: null,
      seasonId: input.seasonId,
      name: input.leagueName,
      visibility: "LEAGUE_MEMBERS",
      createdAt: input.createdAt,
    },
    model,
    input.manageLeagueAuthority,
  );
  const league = transitionFantasyLeague(
    draftLeague,
    "ACTIVE",
    input.createdAt,
    input.activateLeagueAuthority,
    model,
  );
  const draftTeam = createFantasyTeam(
    {
      id: input.fantasyTeamId,
      accountId: input.accountId,
      fantasyLeagueId: league.id,
      ownerAccountMembershipId: input.ownerMembershipId,
      name: input.teamName,
      createdAt: input.createdAt,
    },
    league,
    input.manageTeamAuthority,
  );
  const team = transitionFantasyTeam(
    draftTeam,
    league,
    "ACTIVE",
    input.createdAt,
    input.manageTeamAuthority,
  );
  const playerEntries = input.playerIds.map((player) =>
    createFantasyPlayerEntry(
      {
        id: player.fantasyPlayerEntryId,
        accountId: input.accountId,
        fantasyLeagueId: league.id,
        baseballPlayerId: player.baseballPlayerId,
        eligibility: {
          fantasyModelVersionId: model.modelVersionId,
          fantasyModelDigest: model.contentDigest,
          eligiblePositionCodes: ["UTIL"],
          sourceRosterRevision: player.rosterRevision,
          sourceStatisticsRevision: 0,
          verification: "VERIFIED",
          evaluatedAt: input.createdAt,
        },
        ownership: {
          state: "AVAILABLE",
          fantasyTeamId: null,
          revision: 0,
          effectiveAt: input.createdAt,
        },
        createdAt: input.createdAt,
      },
      league,
      input.manageRosterAuthority,
    ),
  );
  const roster = createFantasyRosterSnapshot(
    {
      id: `${input.fantasyTeamId}-roster-0`,
      accountId: input.accountId,
      fantasyLeagueId: league.id,
      fantasyTeamId: team.id,
      revision: 0,
      previousSnapshotId: null,
      effectiveAt: input.createdAt,
      slots: activeSlots(),
    },
    league,
    team,
    model,
    playerEntries,
    input.manageRosterAuthority,
  );
  return Object.freeze({
    schemaVersion: FANTASY_EXPERIENCE_SCHEMA_VERSION,
    league,
    model,
    teams: Object.freeze([team]),
    transactionState: createFantasyTransactionState({
      league,
      teams: [team],
      model,
      policy: input.policy,
      playerEntries,
      currentRosters: [roster],
    }),
    commissioner: Object.freeze({ cases: Object.freeze([]) }),
  });
}

function latestByRevision<T extends { revision: number }>(
  values: readonly T[],
): T | null {
  return (
    [...values].sort((left, right) => right.revision - left.revision)[0] ?? null
  );
}

export type FantasyExperiencePresentation = Readonly<{
  accountId: string;
  leagueId: string;
  leagueName: string;
  leagueStatus: "ACTIVE" | "PAUSED" | "ARCHIVED" | "PENDING_DELETION";
  lineupDeadlineAt: string;
  teams: readonly Readonly<{ id: string; name: string; owned: boolean }>[];
  selectedTeam: Readonly<{ id: string; name: string }> | null;
  roster: readonly Readonly<{
    slotId: string;
    kind: "ACTIVE" | "BENCH" | "INACTIVE";
    lineupSlot: string | null;
    playerEntryId: string | null;
    playerName: string;
  }>[];
  availablePlayers: readonly Readonly<{
    playerEntryId: string;
    playerName: string;
    eligiblePositions: readonly string[];
  }>[];
  transactions: FantasyTransactionState["transactions"];
  waiverClaims: FantasyTransactionState["waiverClaims"];
  teamResult: FantasyTeamPeriodResult | null;
  matchup: FantasyMatchupResult | null;
  standings: FantasyStandingsResult | null;
  rosterHealth: Readonly<{
    filled: number;
    total: number;
    uncertainty: number;
  }>;
  availableMoveCount: number;
  nextAction: string;
  canManageRoster: boolean;
  canManageLeague: boolean;
  transactionRevision: number;
  commissionerCases: readonly FantasyCommissionerCase[];
}>;

export function buildFantasyExperiencePresentation(
  input: Readonly<{
    snapshot: FantasyLeagueWorkspaceSnapshot;
    status: FantasyExperiencePresentation["leagueStatus"];
    lineupDeadlineAt: string;
    membershipId: string;
    requestedTeamId: string | null;
    canManageLeague: boolean;
    playerNames: ReadonlyMap<string, string>;
    results: readonly StoredFantasyResult[];
  }>,
): FantasyExperiencePresentation {
  const snapshot = parseFantasyWorkspaceSnapshot(input.snapshot);
  const selectedTeam =
    snapshot.teams.find((team) => team.id === input.requestedTeamId) ??
    snapshot.teams.find(
      (team) => team.owner.accountMembershipId === input.membershipId,
    ) ??
    snapshot.teams[0] ??
    null;
  const canManageRoster = Boolean(
    selectedTeam &&
    input.status === "ACTIVE" &&
    (input.canManageLeague ||
      selectedTeam.owner.accountMembershipId === input.membershipId),
  );
  const currentRoster = selectedTeam
    ? (snapshot.transactionState.currentRosters.find(
        (roster) => roster.fantasyTeamId === selectedTeam.id,
      ) ?? null)
    : null;
  const entries = new Map(
    snapshot.transactionState.playerEntries.map((entry) => [entry.id, entry]),
  );
  const playerName = (entryId: string | null) => {
    if (entryId === null) return "Open slot";
    const entry = entries.get(entryId);
    return entry
      ? (input.playerNames.get(entry.baseballPlayerId) ?? "Private player")
      : "Unavailable player";
  };
  const teamResults = input.results.flatMap((result) =>
    result.kind === "TEAM_PERIOD" &&
    result.payload.fantasyTeamId === selectedTeam?.id
      ? [result.payload]
      : [],
  );
  const matchups = input.results.flatMap((result) =>
    result.kind === "MATCHUP" &&
    selectedTeam &&
    [
      result.payload.first.fantasyTeamId,
      result.payload.second.fantasyTeamId,
    ].includes(selectedTeam.id)
      ? [result.payload]
      : [],
  );
  const standingsResults = input.results.flatMap((result) =>
    result.kind === "STANDINGS" ? [result.payload] : [],
  );
  const teamResult = latestByRevision(teamResults);
  const matchup = latestByRevision(matchups);
  const standings = latestByRevision(standingsResults);
  const roster = Object.freeze(
    (currentRoster?.slots ?? []).map((slot) =>
      Object.freeze({
        slotId: slot.id,
        kind: slot.kind,
        lineupSlot: slot.lineupSlotRuleId,
        playerEntryId: slot.playerEntryId,
        playerName: playerName(slot.playerEntryId),
      }),
    ),
  );
  const availablePlayers = Object.freeze(
    snapshot.transactionState.playerEntries
      .filter(
        (entry) =>
          entry.ownership.state === "AVAILABLE" ||
          entry.ownership.state === "RELEASED",
      )
      .map((entry) =>
        Object.freeze({
          playerEntryId: entry.id,
          playerName:
            input.playerNames.get(entry.baseballPlayerId) ?? "Private player",
          eligiblePositions: Object.freeze([
            ...entry.eligibility.eligiblePositionCodes,
          ]),
        }),
      )
      .sort((left, right) =>
        left.playerName === right.playerName
          ? left.playerEntryId < right.playerEntryId
            ? -1
            : 1
          : left.playerName.localeCompare(right.playerName, "en"),
      ),
  );
  const uncertainty = teamResult?.uncertainties.length ?? 0;
  const filled = roster.filter(({ playerEntryId }) => playerEntryId).length;
  const total = roster.length;
  const nextAction =
    input.status === "PAUSED"
      ? "League activity is paused by the commissioner."
      : input.status === "ARCHIVED" || input.status === "PENDING_DELETION"
        ? "This league is read-only."
        : !selectedTeam
          ? "Create or join a fantasy team."
          : filled < total
            ? "Review open roster slots before the lineup deadline."
            : uncertainty > 0
              ? "Review scoring uncertainty before results finalize."
              : "Your lineup is ready for the current period.";
  return Object.freeze({
    accountId: snapshot.league.accountId,
    leagueId: snapshot.league.id,
    leagueName: snapshot.league.name,
    leagueStatus: input.status,
    lineupDeadlineAt: input.lineupDeadlineAt,
    teams: Object.freeze(
      snapshot.teams.map((team) =>
        Object.freeze({
          id: team.id,
          name: team.name,
          owned: team.owner.accountMembershipId === input.membershipId,
        }),
      ),
    ),
    selectedTeam:
      selectedTeam === null
        ? null
        : Object.freeze({ id: selectedTeam.id, name: selectedTeam.name }),
    roster,
    availablePlayers,
    transactions: snapshot.transactionState.transactions,
    waiverClaims: snapshot.transactionState.waiverClaims,
    teamResult,
    matchup,
    standings,
    rosterHealth: Object.freeze({ filled, total, uncertainty }),
    availableMoveCount: availablePlayers.length,
    nextAction,
    canManageRoster,
    canManageLeague: input.canManageLeague,
    transactionRevision: snapshot.transactionState.revision,
    commissionerCases: snapshot.commissioner.cases,
  });
}
