import { createHash } from "node:crypto";

import { z } from "zod";

import { canonicalJson } from "@/domain/events/event-log";
import {
  assertFantasyAuthority,
  createFantasyRosterSnapshot,
  type FantasyDomainAuthority,
  type FantasyLeague,
  type FantasyPlayerEntry,
  type FantasyRosterSlot,
  type FantasyRosterSnapshot,
  type FantasyTeam,
} from "@/domain/fantasy-domain";
import {
  verifyFantasyScoringModel,
  type FantasyScoringModelVersion,
} from "@/domain/fantasy-rules";

export const FANTASY_TRANSACTION_CONTRACT_VERSION = 1 as const;

const stableId = z.string().trim().min(1).max(128);
const instant = z.iso
  .datetime({ offset: true })
  .refine((value) => new Date(value).toISOString() === value, {
    message: "Timestamp must use canonical UTC ISO representation.",
  });
const nonnegativeRevision = z.int().nonnegative();

export type FantasyTransactionAction =
  | "ADD_PLAYER"
  | "DROP_PLAYER"
  | "TRADE"
  | "LINEUP_CHANGE"
  | "SUBMIT_WAIVER_CLAIM"
  | "CANCEL_WAIVER_CLAIM"
  | "PROCESS_WAIVERS";

export type FantasyTransactionErrorCode =
  | "INVALID_INPUT"
  | "AUTHORIZATION_REQUIRED"
  | "ACCOUNT_MISMATCH"
  | "LEAGUE_MISMATCH"
  | "LEAGUE_INACTIVE"
  | "STALE_REVISION"
  | "IDEMPOTENCY_CONFLICT"
  | "PLAYER_UNAVAILABLE"
  | "OWNERSHIP_CONFLICT"
  | "ROSTER_CONFLICT"
  | "INITIAL_ASSIGNMENT_CLOSED"
  | "LINEUP_LOCKED"
  | "TRADE_ACCEPTANCE_REQUIRED"
  | "TRADE_DEADLINE_PASSED"
  | "PROCESSING_TIME_INVALID"
  | "WAIVER_CLAIM_UNAVAILABLE";

export class FantasyTransactionError extends Error {
  constructor(
    readonly code: FantasyTransactionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "FantasyTransactionError";
  }
}

export type FantasyLineupLock = Readonly<{
  id: string;
  startsAt: string;
  endsAt: string;
}>;

export type FantasyTransactionPolicy = Readonly<{
  initialAssignmentMethod: "DRAFT" | "COMMISSIONER_ASSIGNMENT";
  initialAssignmentDeadline: string;
  acquisitionMethod: "DAILY_WAIVERS";
  waiverProcessingInstants: readonly string[];
  initialWaiverPriority: readonly string[];
  tradeProcessingInstants: readonly string[];
  tradeDeadline: string;
  tradeAcceptance: "ALL_PARTICIPATING_MANAGERS";
  commissionerVeto: "NONE";
  lineupLocks: readonly FantasyLineupLock[];
}>;

export type FantasyWaiverClaim = Readonly<{
  id: string;
  operationId: string;
  accountId: string;
  fantasyLeagueId: string;
  fantasyTeamId: string;
  playerEntryId: string;
  conditionalDropPlayerEntryId: string | null;
  targetSlotId: string;
  rosterSnapshotId: string;
  processingAt: string;
  submittedAt: string;
  submittedByActorId: string;
  authorityReferenceIds: readonly string[];
  status: "PENDING" | "CANCELLED" | "APPLIED" | "REJECTED";
  resolvedAt: string | null;
  resultCode: FantasyTransactionErrorCode | null;
}>;

export type FantasyTransactionRecord = Readonly<{
  operationId: string;
  requestDigest: string;
  accountId: string;
  fantasyLeagueId: string;
  action: FantasyTransactionAction;
  affectedPlayerEntryIds: readonly string[];
  submittedAt: string;
  effectiveAt: string | null;
  status: "APPLIED" | "QUEUED" | "CANCELLED" | "DENIED";
  resultCode: FantasyTransactionErrorCode | null;
  beforeRevision: number;
  afterRevision: number;
  rosterSnapshotIds: readonly string[];
}>;

export type FantasyTransactionAudit = Readonly<{
  id: string;
  operationId: string;
  actorId: string;
  authoritySource: FantasyDomainAuthority["source"];
  authorityReferenceIds: readonly string[];
  accountId: string;
  fantasyLeagueId: string;
  action: FantasyTransactionAction;
  affectedPlayerEntryIds: readonly string[];
  acceptedAt: string;
  result: "APPLIED" | "QUEUED" | "CANCELLED" | "DENIED";
  reasonCode: FantasyTransactionErrorCode | null;
  commissionerCorrectionReason: string | null;
  beforeRevision: number;
  afterRevision: number;
}>;

export type FantasyTransactionState = Readonly<{
  contractVersion: typeof FANTASY_TRANSACTION_CONTRACT_VERSION;
  accountId: string;
  fantasyLeagueId: string;
  revision: number;
  policy: FantasyTransactionPolicy;
  playerEntries: readonly FantasyPlayerEntry[];
  currentRosters: readonly FantasyRosterSnapshot[];
  waiverPriority: readonly string[];
  waiverClaims: readonly FantasyWaiverClaim[];
  transactions: readonly FantasyTransactionRecord[];
  audits: readonly FantasyTransactionAudit[];
}>;

type CommandBase = Readonly<{
  operationId: string;
  auditId: string;
  accountId: string;
  fantasyLeagueId: string;
  expectedRevision: number;
  submittedAt: string;
  authority: FantasyDomainAuthority;
}>;

export type AddPlayerCommand = CommandBase &
  Readonly<{
    action: "ADD_PLAYER";
    fantasyTeamId: string;
    playerEntryId: string;
    targetSlotId: string;
    rosterSnapshotId: string;
    assignmentMethod: "DRAFT" | "COMMISSIONER_ASSIGNMENT";
  }>;

export type DropPlayerCommand = CommandBase &
  Readonly<{
    action: "DROP_PLAYER";
    fantasyTeamId: string;
    playerEntryId: string;
    rosterSnapshotId: string;
  }>;

export type TradeAcceptance = Readonly<{
  fantasyTeamId: string;
  accountMembershipId: string;
  acceptedAt: string;
  authorityReferenceIds: readonly string[];
}>;

export type TradeCommand = CommandBase &
  Readonly<{
    action: "TRADE";
    firstTeamId: string;
    secondTeamId: string;
    firstPlayerEntryId: string;
    secondPlayerEntryId: string;
    firstTargetSlotId: string;
    secondTargetSlotId: string;
    firstRosterSnapshotId: string;
    secondRosterSnapshotId: string;
    processingAt: string;
    acceptances: readonly TradeAcceptance[];
  }>;

export type LineupChangeCommand = CommandBase &
  Readonly<{
    action: "LINEUP_CHANGE";
    fantasyTeamId: string;
    rosterSnapshotId: string;
    slots: readonly FantasyRosterSlot[];
    commissionerCorrectionReason: string | null;
  }>;

export type SubmitWaiverClaimCommand = CommandBase &
  Readonly<{
    action: "SUBMIT_WAIVER_CLAIM";
    claimId: string;
    fantasyTeamId: string;
    playerEntryId: string;
    conditionalDropPlayerEntryId: string | null;
    targetSlotId: string;
    rosterSnapshotId: string;
    processingAt: string;
  }>;

export type CancelWaiverClaimCommand = CommandBase &
  Readonly<{
    action: "CANCEL_WAIVER_CLAIM";
    claimId: string;
  }>;

export type ProcessWaiversCommand = CommandBase &
  Readonly<{
    action: "PROCESS_WAIVERS";
    processingAt: string;
  }>;

export type FantasyTransactionCommand =
  | AddPlayerCommand
  | DropPlayerCommand
  | TradeCommand
  | LineupChangeCommand
  | SubmitWaiverClaimCommand
  | CancelWaiverClaimCommand
  | ProcessWaiversCommand;

export type FantasyTransactionOutcome = Readonly<{
  state: FantasyTransactionState;
  record: FantasyTransactionRecord;
  audit: FantasyTransactionAudit;
  duplicate: boolean;
}>;

const authoritySchema = z
  .object({
    accountId: stableId,
    actorId: stableId,
    source: z.enum(["ACCOUNT_PERMISSION", "LEAGUE_DELEGATION"]),
    capability: z.literal("fantasy.roster.manage"),
    scope: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("ACCOUNT") }).strict(),
      z
        .object({
          kind: z.literal("FANTASY_LEAGUE"),
          fantasyLeagueId: stableId,
        })
        .strict(),
      z
        .object({
          kind: z.literal("FANTASY_TEAM"),
          fantasyLeagueId: stableId,
          fantasyTeamId: stableId,
        })
        .strict(),
    ]),
    authorityReferenceIds: z.array(stableId).min(1),
    authorizedAt: instant,
  })
  .strict();

const baseShape = {
  operationId: stableId,
  auditId: stableId,
  accountId: stableId,
  fantasyLeagueId: stableId,
  expectedRevision: nonnegativeRevision,
  submittedAt: instant,
  authority: authoritySchema,
};

const slotSchema = z
  .object({
    id: stableId,
    kind: z.enum(["ACTIVE", "BENCH", "INACTIVE"]),
    lineupSlotRuleId: stableId.nullable(),
    playerEntryId: stableId.nullable(),
  })
  .strict();

const tradeAcceptanceSchema = z
  .object({
    fantasyTeamId: stableId,
    accountMembershipId: stableId,
    acceptedAt: instant,
    authorityReferenceIds: z.array(stableId).min(1),
  })
  .strict();

const commandSchema = z.discriminatedUnion("action", [
  z
    .object({
      ...baseShape,
      action: z.literal("ADD_PLAYER"),
      fantasyTeamId: stableId,
      playerEntryId: stableId,
      targetSlotId: stableId,
      rosterSnapshotId: stableId,
      assignmentMethod: z.enum(["DRAFT", "COMMISSIONER_ASSIGNMENT"]),
    })
    .strict(),
  z
    .object({
      ...baseShape,
      action: z.literal("DROP_PLAYER"),
      fantasyTeamId: stableId,
      playerEntryId: stableId,
      rosterSnapshotId: stableId,
    })
    .strict(),
  z
    .object({
      ...baseShape,
      action: z.literal("TRADE"),
      firstTeamId: stableId,
      secondTeamId: stableId,
      firstPlayerEntryId: stableId,
      secondPlayerEntryId: stableId,
      firstTargetSlotId: stableId,
      secondTargetSlotId: stableId,
      firstRosterSnapshotId: stableId,
      secondRosterSnapshotId: stableId,
      processingAt: instant,
      acceptances: z.array(tradeAcceptanceSchema).max(2),
    })
    .strict(),
  z
    .object({
      ...baseShape,
      action: z.literal("LINEUP_CHANGE"),
      fantasyTeamId: stableId,
      rosterSnapshotId: stableId,
      slots: z.array(slotSchema),
      commissionerCorrectionReason: z
        .string()
        .trim()
        .min(1)
        .max(500)
        .nullable(),
    })
    .strict(),
  z
    .object({
      ...baseShape,
      action: z.literal("SUBMIT_WAIVER_CLAIM"),
      claimId: stableId,
      fantasyTeamId: stableId,
      playerEntryId: stableId,
      conditionalDropPlayerEntryId: stableId.nullable(),
      targetSlotId: stableId,
      rosterSnapshotId: stableId,
      processingAt: instant,
    })
    .strict(),
  z
    .object({
      ...baseShape,
      action: z.literal("CANCEL_WAIVER_CLAIM"),
      claimId: stableId,
    })
    .strict(),
  z
    .object({
      ...baseShape,
      action: z.literal("PROCESS_WAIVERS"),
      processingAt: instant,
    })
    .strict(),
]);

const policySchema = z
  .object({
    initialAssignmentMethod: z.enum(["DRAFT", "COMMISSIONER_ASSIGNMENT"]),
    initialAssignmentDeadline: instant,
    acquisitionMethod: z.literal("DAILY_WAIVERS"),
    waiverProcessingInstants: z.array(instant),
    initialWaiverPriority: z.array(stableId).min(1),
    tradeProcessingInstants: z.array(instant),
    tradeDeadline: instant,
    tradeAcceptance: z.literal("ALL_PARTICIPATING_MANAGERS"),
    commissionerVeto: z.literal("NONE"),
    lineupLocks: z.array(
      z.object({ id: stableId, startsAt: instant, endsAt: instant }).strict(),
    ),
  })
  .strict();

function parseCommand(value: unknown): FantasyTransactionCommand {
  const result = commandSchema.safeParse(value);
  if (!result.success) {
    throw new FantasyTransactionError(
      "INVALID_INPUT",
      "Fantasy transaction input is invalid or contains unsupported fields.",
    );
  }
  return result.data;
}

function requireUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new FantasyTransactionError(
      "INVALID_INPUT",
      `${label} must contain unique identifiers.`,
    );
  }
}

function assertOwnershipProjection(
  entries: readonly FantasyPlayerEntry[],
  rosters: readonly FantasyRosterSnapshot[],
): void {
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
  const rosteredIds: string[] = [];
  for (const roster of rosters) {
    for (const slot of roster.slots) {
      if (slot.playerEntryId === null) continue;
      const entry = entriesById.get(slot.playerEntryId);
      if (
        !entry ||
        entry.ownership.fantasyTeamId !== roster.fantasyTeamId ||
        (entry.ownership.state !== "ROSTERED" &&
          entry.ownership.state !== "INACTIVE")
      ) {
        throw new FantasyTransactionError(
          "OWNERSHIP_CONFLICT",
          "Roster and ownership projections disagree.",
        );
      }
      rosteredIds.push(entry.id);
    }
  }
  requireUnique(rosteredIds, "Rostered player entries");
  if (
    entries.some((entry) => {
      const shouldBeRostered =
        entry.ownership.state === "ROSTERED" ||
        entry.ownership.state === "INACTIVE";
      return shouldBeRostered !== rosteredIds.includes(entry.id);
    })
  ) {
    throw new FantasyTransactionError(
      "OWNERSHIP_CONFLICT",
      "Every owned player must appear exactly once on its current roster.",
    );
  }
}

function freezeEntry(entry: FantasyPlayerEntry): FantasyPlayerEntry {
  return Object.freeze({
    ...entry,
    eligibility: Object.freeze({
      ...entry.eligibility,
      eligiblePositionCodes: Object.freeze([
        ...entry.eligibility.eligiblePositionCodes,
      ]),
    }),
    ownership: Object.freeze({ ...entry.ownership }),
  });
}

function freezeRoster(roster: FantasyRosterSnapshot): FantasyRosterSnapshot {
  return Object.freeze({
    ...roster,
    rules: Object.freeze({
      ...roster.rules,
      modelOwner: Object.freeze({ ...roster.rules.modelOwner }),
    }),
    slots: Object.freeze(
      roster.slots.map((slot) => Object.freeze({ ...slot })),
    ),
  });
}

function freezePolicy(
  policy: FantasyTransactionPolicy,
): FantasyTransactionPolicy {
  return Object.freeze({
    ...policy,
    waiverProcessingInstants: Object.freeze([
      ...policy.waiverProcessingInstants,
    ]),
    initialWaiverPriority: Object.freeze([...policy.initialWaiverPriority]),
    tradeProcessingInstants: Object.freeze([...policy.tradeProcessingInstants]),
    lineupLocks: Object.freeze(
      policy.lineupLocks.map((lock) => Object.freeze({ ...lock })),
    ),
  });
}

function freezeRecord(
  record: FantasyTransactionRecord,
): FantasyTransactionRecord {
  return Object.freeze({
    ...record,
    affectedPlayerEntryIds: Object.freeze([...record.affectedPlayerEntryIds]),
    rosterSnapshotIds: Object.freeze([...record.rosterSnapshotIds]),
  });
}

function freezeAudit(audit: FantasyTransactionAudit): FantasyTransactionAudit {
  return Object.freeze({
    ...audit,
    authorityReferenceIds: Object.freeze([...audit.authorityReferenceIds]),
    affectedPlayerEntryIds: Object.freeze([...audit.affectedPlayerEntryIds]),
  });
}

function freezeClaim(claim: FantasyWaiverClaim): FantasyWaiverClaim {
  return Object.freeze({
    ...claim,
    authorityReferenceIds: Object.freeze([...claim.authorityReferenceIds]),
  });
}

function freezeState(state: FantasyTransactionState): FantasyTransactionState {
  return Object.freeze({
    ...state,
    policy: freezePolicy(state.policy),
    playerEntries: Object.freeze(state.playerEntries.map(freezeEntry)),
    currentRosters: Object.freeze(state.currentRosters.map(freezeRoster)),
    waiverPriority: Object.freeze([...state.waiverPriority]),
    waiverClaims: Object.freeze(state.waiverClaims.map(freezeClaim)),
    transactions: Object.freeze(state.transactions.map(freezeRecord)),
    audits: Object.freeze(state.audits.map(freezeAudit)),
  });
}

export function createFantasyTransactionState(
  input: Readonly<{
    league: FantasyLeague;
    teams: readonly FantasyTeam[];
    model: FantasyScoringModelVersion;
    policy: FantasyTransactionPolicy;
    playerEntries: readonly FantasyPlayerEntry[];
    currentRosters: readonly FantasyRosterSnapshot[];
  }>,
): FantasyTransactionState {
  verifyFantasyScoringModel(input.model);
  const policyResult = policySchema.safeParse(input.policy);
  if (!policyResult.success || input.league.lifecycle !== "ACTIVE") {
    throw new FantasyTransactionError(
      "INVALID_INPUT",
      "Fantasy transaction policy or league lifecycle is invalid.",
    );
  }
  const policy = policyResult.data;
  requireUnique(policy.waiverProcessingInstants, "Waiver processing schedule");
  requireUnique(policy.tradeProcessingInstants, "Trade processing schedule");
  requireUnique(policy.initialWaiverPriority, "Waiver priority");
  requireUnique(
    policy.lineupLocks.map((lock) => lock.id),
    "Lineup lock ids",
  );
  for (const lock of policy.lineupLocks) {
    if (Date.parse(lock.startsAt) >= Date.parse(lock.endsAt)) {
      throw new FantasyTransactionError(
        "INVALID_INPUT",
        "Lineup lock end must follow its start.",
      );
    }
  }
  const teamIds = input.teams.map((team) => team.id);
  requireUnique(teamIds, "Fantasy teams");
  if (
    input.teams.some(
      (team) =>
        team.accountId !== input.league.accountId ||
        team.fantasyLeagueId !== input.league.id ||
        team.lifecycle !== "ACTIVE",
    ) ||
    policy.initialWaiverPriority.length !== teamIds.length ||
    policy.initialWaiverPriority.some((teamId) => !teamIds.includes(teamId))
  ) {
    throw new FantasyTransactionError(
      "LEAGUE_MISMATCH",
      "Teams and waiver priority must cover the exact active league.",
    );
  }
  requireUnique(
    input.playerEntries.map((entry) => entry.id),
    "Player entries",
  );
  requireUnique(
    input.playerEntries.map((entry) => entry.baseballPlayerId),
    "Canonical baseball players",
  );
  requireUnique(
    input.currentRosters.map((roster) => roster.fantasyTeamId),
    "Current fantasy rosters",
  );
  if (
    input.currentRosters.length !== input.teams.length ||
    input.playerEntries.some(
      (entry) =>
        entry.accountId !== input.league.accountId ||
        entry.fantasyLeagueId !== input.league.id,
    ) ||
    input.currentRosters.some(
      (roster) =>
        roster.accountId !== input.league.accountId ||
        roster.fantasyLeagueId !== input.league.id ||
        !teamIds.includes(roster.fantasyTeamId) ||
        roster.rules.modelVersionId !== input.model.modelVersionId ||
        roster.rules.modelDigest !== input.model.contentDigest,
    )
  ) {
    throw new FantasyTransactionError(
      "LEAGUE_MISMATCH",
      "Fantasy transaction state cannot cross Account or league boundaries.",
    );
  }
  if (
    input.league.rules.modelVersionId !== input.model.modelVersionId ||
    input.league.rules.modelDigest !== input.model.contentDigest
  ) {
    throw new FantasyTransactionError(
      "INVALID_INPUT",
      "Fantasy transaction state requires the league's exact rules model.",
    );
  }
  assertOwnershipProjection(input.playerEntries, input.currentRosters);
  return freezeState({
    contractVersion: FANTASY_TRANSACTION_CONTRACT_VERSION,
    accountId: input.league.accountId,
    fantasyLeagueId: input.league.id,
    revision: 0,
    policy,
    playerEntries: input.playerEntries,
    currentRosters: input.currentRosters,
    waiverPriority: policy.initialWaiverPriority,
    waiverClaims: [],
    transactions: [],
    audits: [],
  });
}

function commandDigest(command: FantasyTransactionCommand): string {
  const envelope = {
    ...command,
    authority: {
      accountId: command.authority.accountId,
      actorId: command.authority.actorId,
      source: command.authority.source,
      capability: command.authority.capability,
      scope: command.authority.scope,
      authorityReferenceIds: command.authority.authorityReferenceIds,
      authorizedAt: command.authority.authorizedAt,
    },
  };
  return `sha256:v1:${createHash("sha256")
    .update(canonicalJson(envelope))
    .digest("hex")}`;
}

function affectedPlayers(
  state: FantasyTransactionState,
  command: FantasyTransactionCommand,
): readonly string[] {
  if (command.action === "ADD_PLAYER" || command.action === "DROP_PLAYER") {
    return [command.playerEntryId];
  }
  if (command.action === "TRADE") {
    return [command.firstPlayerEntryId, command.secondPlayerEntryId];
  }
  if (command.action === "LINEUP_CHANGE") {
    return command.slots.flatMap((slot) =>
      slot.playerEntryId === null ? [] : [slot.playerEntryId],
    );
  }
  if (command.action === "SUBMIT_WAIVER_CLAIM") {
    return [
      command.playerEntryId,
      ...(command.conditionalDropPlayerEntryId
        ? [command.conditionalDropPlayerEntryId]
        : []),
    ];
  }
  if (command.action === "CANCEL_WAIVER_CLAIM") {
    const claim = state.waiverClaims.find(
      (candidate) => candidate.id === command.claimId,
    );
    return claim
      ? [
          claim.playerEntryId,
          ...(claim.conditionalDropPlayerEntryId
            ? [claim.conditionalDropPlayerEntryId]
            : []),
        ]
      : [];
  }
  return state.waiverClaims
    .filter(
      (claim) =>
        claim.status === "PENDING" &&
        claim.processingAt === command.processingAt,
    )
    .flatMap((claim) => [
      claim.playerEntryId,
      ...(claim.conditionalDropPlayerEntryId
        ? [claim.conditionalDropPlayerEntryId]
        : []),
    ]);
}

function teamFor(teams: readonly FantasyTeam[], teamId: string): FantasyTeam {
  const team = teams.find((candidate) => candidate.id === teamId);
  if (!team) {
    throw new FantasyTransactionError(
      "LEAGUE_MISMATCH",
      "Fantasy team does not belong to this league.",
    );
  }
  return team;
}

function entryFor(
  entries: readonly FantasyPlayerEntry[],
  playerEntryId: string,
): FantasyPlayerEntry {
  const entry = entries.find((candidate) => candidate.id === playerEntryId);
  if (!entry) {
    throw new FantasyTransactionError(
      "PLAYER_UNAVAILABLE",
      "Fantasy player entry is unavailable.",
    );
  }
  return entry;
}

function rosterFor(
  rosters: readonly FantasyRosterSnapshot[],
  teamId: string,
): FantasyRosterSnapshot {
  const roster = rosters.find(
    (candidate) => candidate.fantasyTeamId === teamId,
  );
  if (!roster) {
    throw new FantasyTransactionError(
      "ROSTER_CONFLICT",
      "Fantasy team has no current roster snapshot.",
    );
  }
  return roster;
}

function replaceEntry(
  entries: readonly FantasyPlayerEntry[],
  updated: FantasyPlayerEntry,
): readonly FantasyPlayerEntry[] {
  return entries.map((entry) => (entry.id === updated.id ? updated : entry));
}

function replaceRoster(
  rosters: readonly FantasyRosterSnapshot[],
  updated: FantasyRosterSnapshot,
): readonly FantasyRosterSnapshot[] {
  return rosters.map((roster) =>
    roster.fantasyTeamId === updated.fantasyTeamId ? updated : roster,
  );
}

function ownership(
  entry: FantasyPlayerEntry,
  state: FantasyPlayerEntry["ownership"]["state"],
  fantasyTeamId: string | null,
  effectiveAt: string,
): FantasyPlayerEntry {
  return freezeEntry({
    ...entry,
    ownership: {
      state,
      fantasyTeamId,
      revision: entry.ownership.revision + 1,
      effectiveAt,
    },
  });
}

function slotsWithAssignment(
  roster: FantasyRosterSnapshot,
  targetSlotId: string,
  playerEntryId: string,
): readonly FantasyRosterSlot[] {
  let found = false;
  const slots = roster.slots.map((slot) => {
    if (slot.id !== targetSlotId) return slot;
    found = true;
    if (slot.playerEntryId !== null) {
      throw new FantasyTransactionError(
        "ROSTER_CONFLICT",
        "Target fantasy roster slot is occupied.",
      );
    }
    return { ...slot, playerEntryId };
  });
  if (!found) {
    throw new FantasyTransactionError(
      "ROSTER_CONFLICT",
      "Target fantasy roster slot is unavailable.",
    );
  }
  return slots;
}

function slotsWithoutPlayer(
  roster: FantasyRosterSnapshot,
  playerEntryId: string,
): readonly FantasyRosterSlot[] {
  let found = false;
  const slots = roster.slots.map((slot) => {
    if (slot.playerEntryId !== playerEntryId) return slot;
    found = true;
    return { ...slot, playerEntryId: null };
  });
  if (!found) {
    throw new FantasyTransactionError(
      "OWNERSHIP_CONFLICT",
      "Fantasy player is not present on the team's current roster.",
    );
  }
  return slots;
}

function successorRoster(
  id: string,
  effectiveAt: string,
  league: FantasyLeague,
  team: FantasyTeam,
  model: FantasyScoringModelVersion,
  entries: readonly FantasyPlayerEntry[],
  previous: FantasyRosterSnapshot,
  slots: readonly FantasyRosterSlot[],
  authority: FantasyDomainAuthority,
): FantasyRosterSnapshot {
  return createFantasyRosterSnapshot(
    {
      id,
      accountId: league.accountId,
      fantasyLeagueId: league.id,
      fantasyTeamId: team.id,
      revision: previous.revision + 1,
      previousSnapshotId: previous.id,
      effectiveAt,
      slots,
    },
    league,
    team,
    model,
    entries,
    authority,
    previous,
  );
}

function lineupIsLocked(
  policy: FantasyTransactionPolicy,
  submittedAt: string,
): boolean {
  const time = Date.parse(submittedAt);
  return policy.lineupLocks.some(
    (lock) =>
      Date.parse(lock.startsAt) <= time && time < Date.parse(lock.endsAt),
  );
}

function managerCorrectionAllowed(command: LineupChangeCommand): boolean {
  return (
    command.commissionerCorrectionReason !== null &&
    command.authority.scope.kind !== "FANTASY_TEAM"
  );
}

function acceptedTrade(
  command: TradeCommand,
  first: FantasyTeam,
  second: FantasyTeam,
): boolean {
  if (first.id === second.id) return false;
  const byTeam = new Map(
    command.acceptances.map((acceptance) => [
      acceptance.fantasyTeamId,
      acceptance,
    ]),
  );
  const firstAcceptance = byTeam.get(first.id);
  const secondAcceptance = byTeam.get(second.id);
  return (
    byTeam.size === 2 &&
    firstAcceptance?.accountMembershipId === first.owner.accountMembershipId &&
    secondAcceptance?.accountMembershipId ===
      second.owner.accountMembershipId &&
    firstAcceptance.authorityReferenceIds.length > 0 &&
    secondAcceptance.authorityReferenceIds.length > 0 &&
    Date.parse(firstAcceptance.acceptedAt) <=
      Date.parse(command.processingAt) &&
    Date.parse(secondAcceptance.acceptedAt) <= Date.parse(command.processingAt)
  );
}

type MutationResult = Readonly<{
  entries: readonly FantasyPlayerEntry[];
  rosters: readonly FantasyRosterSnapshot[];
  claims?: readonly FantasyWaiverClaim[];
  priority?: readonly string[];
  additionalAudits?: readonly FantasyTransactionAudit[];
  status: FantasyTransactionRecord["status"];
  effectiveAt: string | null;
  rosterSnapshotIds: readonly string[];
}>;

function addPlayer(
  state: FantasyTransactionState,
  command: AddPlayerCommand,
  league: FantasyLeague,
  teams: readonly FantasyTeam[],
  model: FantasyScoringModelVersion,
): MutationResult {
  if (command.assignmentMethod !== state.policy.initialAssignmentMethod) {
    throw new FantasyTransactionError(
      "INVALID_INPUT",
      "Player assignment method does not match league policy.",
    );
  }
  if (
    Date.parse(command.submittedAt) >=
    Date.parse(state.policy.initialAssignmentDeadline)
  ) {
    throw new FantasyTransactionError(
      "INITIAL_ASSIGNMENT_CLOSED",
      "Initial fantasy roster assignment window is closed.",
    );
  }
  if (command.authority.scope.kind === "FANTASY_TEAM") {
    throw new FantasyTransactionError(
      "AUTHORIZATION_REQUIRED",
      "Initial roster assignment requires league-wide processor authority.",
    );
  }
  const team = teamFor(teams, command.fantasyTeamId);
  assertFantasyAuthority(
    command.authority,
    state.accountId,
    "fantasy.roster.manage",
    state.fantasyLeagueId,
    team.id,
  );
  const entry = entryFor(state.playerEntries, command.playerEntryId);
  if (
    entry.ownership.state === "ROSTERED" ||
    entry.ownership.state === "INACTIVE"
  ) {
    throw new FantasyTransactionError(
      "OWNERSHIP_CONFLICT",
      "Fantasy player is already owned.",
    );
  }
  const updated = ownership(entry, "ROSTERED", team.id, command.submittedAt);
  const entries = replaceEntry(state.playerEntries, updated);
  const previous = rosterFor(state.currentRosters, team.id);
  const roster = successorRoster(
    command.rosterSnapshotId,
    command.submittedAt,
    league,
    team,
    model,
    entries,
    previous,
    slotsWithAssignment(previous, command.targetSlotId, entry.id),
    command.authority,
  );
  return {
    entries,
    rosters: replaceRoster(state.currentRosters, roster),
    status: "APPLIED",
    effectiveAt: command.submittedAt,
    rosterSnapshotIds: [roster.id],
  };
}

function dropPlayer(
  state: FantasyTransactionState,
  command: DropPlayerCommand,
  league: FantasyLeague,
  teams: readonly FantasyTeam[],
  model: FantasyScoringModelVersion,
): MutationResult {
  const team = teamFor(teams, command.fantasyTeamId);
  assertFantasyAuthority(
    command.authority,
    state.accountId,
    "fantasy.roster.manage",
    state.fantasyLeagueId,
    team.id,
  );
  const entry = entryFor(state.playerEntries, command.playerEntryId);
  if (entry.ownership.fantasyTeamId !== team.id) {
    throw new FantasyTransactionError(
      "OWNERSHIP_CONFLICT",
      "Fantasy player is not owned by the requested team.",
    );
  }
  const previous = rosterFor(state.currentRosters, team.id);
  const updated = ownership(entry, "RELEASED", null, command.submittedAt);
  const entries = replaceEntry(state.playerEntries, updated);
  const roster = successorRoster(
    command.rosterSnapshotId,
    command.submittedAt,
    league,
    team,
    model,
    entries,
    previous,
    slotsWithoutPlayer(previous, entry.id),
    command.authority,
  );
  return {
    entries,
    rosters: replaceRoster(state.currentRosters, roster),
    status: "APPLIED",
    effectiveAt: command.submittedAt,
    rosterSnapshotIds: [roster.id],
  };
}

function tradePlayers(
  state: FantasyTransactionState,
  command: TradeCommand,
  league: FantasyLeague,
  teams: readonly FantasyTeam[],
  model: FantasyScoringModelVersion,
): MutationResult {
  if (
    !state.policy.tradeProcessingInstants.includes(command.processingAt) ||
    command.submittedAt !== command.processingAt
  ) {
    throw new FantasyTransactionError(
      "PROCESSING_TIME_INVALID",
      "Trade must execute at its sealed processing instant.",
    );
  }
  if (
    Date.parse(command.processingAt) >= Date.parse(state.policy.tradeDeadline)
  ) {
    throw new FantasyTransactionError(
      "TRADE_DEADLINE_PASSED",
      "Trade processing instant is at or after the sealed deadline.",
    );
  }
  const firstTeam = teamFor(teams, command.firstTeamId);
  const secondTeam = teamFor(teams, command.secondTeamId);
  if (command.authority.scope.kind === "FANTASY_TEAM") {
    throw new FantasyTransactionError(
      "AUTHORIZATION_REQUIRED",
      "Atomic trade processing requires league-wide transaction authority.",
    );
  }
  assertFantasyAuthority(
    command.authority,
    state.accountId,
    "fantasy.roster.manage",
    state.fantasyLeagueId,
  );
  if (!acceptedTrade(command, firstTeam, secondTeam)) {
    throw new FantasyTransactionError(
      "TRADE_ACCEPTANCE_REQUIRED",
      "Trade requires exact acceptance from both team owners.",
    );
  }
  const firstPlayer = entryFor(state.playerEntries, command.firstPlayerEntryId);
  const secondPlayer = entryFor(
    state.playerEntries,
    command.secondPlayerEntryId,
  );
  if (
    firstPlayer.ownership.fantasyTeamId !== firstTeam.id ||
    secondPlayer.ownership.fantasyTeamId !== secondTeam.id ||
    firstPlayer.id === secondPlayer.id
  ) {
    throw new FantasyTransactionError(
      "OWNERSHIP_CONFLICT",
      "Trade players must be uniquely owned by the participating teams.",
    );
  }
  const firstUpdated = ownership(
    firstPlayer,
    "ROSTERED",
    secondTeam.id,
    command.processingAt,
  );
  const secondUpdated = ownership(
    secondPlayer,
    "ROSTERED",
    firstTeam.id,
    command.processingAt,
  );
  let entries = replaceEntry(state.playerEntries, firstUpdated);
  entries = replaceEntry(entries, secondUpdated);
  const firstPrevious = rosterFor(state.currentRosters, firstTeam.id);
  const secondPrevious = rosterFor(state.currentRosters, secondTeam.id);
  const firstSlots = slotsWithAssignment(
    {
      ...firstPrevious,
      slots: slotsWithoutPlayer(firstPrevious, firstPlayer.id),
    },
    command.firstTargetSlotId,
    secondPlayer.id,
  );
  const secondSlots = slotsWithAssignment(
    {
      ...secondPrevious,
      slots: slotsWithoutPlayer(secondPrevious, secondPlayer.id),
    },
    command.secondTargetSlotId,
    firstPlayer.id,
  );
  const firstRoster = successorRoster(
    command.firstRosterSnapshotId,
    command.processingAt,
    league,
    firstTeam,
    model,
    entries,
    firstPrevious,
    firstSlots,
    command.authority,
  );
  const secondRoster = successorRoster(
    command.secondRosterSnapshotId,
    command.processingAt,
    league,
    secondTeam,
    model,
    entries,
    secondPrevious,
    secondSlots,
    command.authority,
  );
  let rosters = replaceRoster(state.currentRosters, firstRoster);
  rosters = replaceRoster(rosters, secondRoster);
  return {
    entries,
    rosters,
    status: "APPLIED",
    effectiveAt: command.processingAt,
    rosterSnapshotIds: [firstRoster.id, secondRoster.id],
  };
}

function changeLineup(
  state: FantasyTransactionState,
  command: LineupChangeCommand,
  league: FantasyLeague,
  teams: readonly FantasyTeam[],
  model: FantasyScoringModelVersion,
): MutationResult {
  const team = teamFor(teams, command.fantasyTeamId);
  assertFantasyAuthority(
    command.authority,
    state.accountId,
    "fantasy.roster.manage",
    state.fantasyLeagueId,
    team.id,
  );
  if (
    lineupIsLocked(state.policy, command.submittedAt) &&
    !managerCorrectionAllowed(command)
  ) {
    throw new FantasyTransactionError(
      "LINEUP_LOCKED",
      "Lineup changes cannot rewrite a sealed lock window.",
    );
  }
  const previous = rosterFor(state.currentRosters, team.id);
  const roster = successorRoster(
    command.rosterSnapshotId,
    command.submittedAt,
    league,
    team,
    model,
    state.playerEntries,
    previous,
    command.slots,
    command.authority,
  );
  return {
    entries: state.playerEntries,
    rosters: replaceRoster(state.currentRosters, roster),
    status: "APPLIED",
    effectiveAt: command.submittedAt,
    rosterSnapshotIds: [roster.id],
  };
}

function submitWaiver(
  state: FantasyTransactionState,
  command: SubmitWaiverClaimCommand,
  teams: readonly FantasyTeam[],
): MutationResult {
  const team = teamFor(teams, command.fantasyTeamId);
  assertFantasyAuthority(
    command.authority,
    state.accountId,
    "fantasy.roster.manage",
    state.fantasyLeagueId,
    team.id,
  );
  if (
    !state.policy.waiverProcessingInstants.includes(command.processingAt) ||
    Date.parse(command.processingAt) <= Date.parse(command.submittedAt)
  ) {
    throw new FantasyTransactionError(
      "PROCESSING_TIME_INVALID",
      "Waiver claim requires a future sealed processing instant.",
    );
  }
  const entry = entryFor(state.playerEntries, command.playerEntryId);
  if (
    entry.ownership.state === "ROSTERED" ||
    entry.ownership.state === "INACTIVE"
  ) {
    throw new FantasyTransactionError(
      "OWNERSHIP_CONFLICT",
      "Waiver target is already owned.",
    );
  }
  if (
    command.conditionalDropPlayerEntryId !== null &&
    entryFor(state.playerEntries, command.conditionalDropPlayerEntryId)
      .ownership.fantasyTeamId !== team.id
  ) {
    throw new FantasyTransactionError(
      "OWNERSHIP_CONFLICT",
      "Conditional drop is not owned by the claiming team.",
    );
  }
  if (state.waiverClaims.some((claim) => claim.id === command.claimId)) {
    throw new FantasyTransactionError(
      "WAIVER_CLAIM_UNAVAILABLE",
      "Waiver claim id is already in use.",
    );
  }
  if (
    state.waiverClaims.some(
      (claim) =>
        claim.status === "PENDING" &&
        claim.processingAt === command.processingAt &&
        claim.fantasyTeamId === command.fantasyTeamId &&
        claim.playerEntryId === command.playerEntryId,
    )
  ) {
    throw new FantasyTransactionError(
      "WAIVER_CLAIM_UNAVAILABLE",
      "Team already has a pending claim for this player and batch.",
    );
  }
  const claim = freezeClaim({
    id: command.claimId,
    operationId: command.operationId,
    accountId: state.accountId,
    fantasyLeagueId: state.fantasyLeagueId,
    fantasyTeamId: team.id,
    playerEntryId: command.playerEntryId,
    conditionalDropPlayerEntryId: command.conditionalDropPlayerEntryId,
    targetSlotId: command.targetSlotId,
    rosterSnapshotId: command.rosterSnapshotId,
    processingAt: command.processingAt,
    submittedAt: command.submittedAt,
    submittedByActorId: command.authority.actorId,
    authorityReferenceIds: command.authority.authorityReferenceIds,
    status: "PENDING",
    resolvedAt: null,
    resultCode: null,
  });
  return {
    entries: state.playerEntries,
    rosters: state.currentRosters,
    claims: [...state.waiverClaims, claim],
    status: "QUEUED",
    effectiveAt: command.processingAt,
    rosterSnapshotIds: [],
  };
}

function cancelWaiver(
  state: FantasyTransactionState,
  command: CancelWaiverClaimCommand,
  teams: readonly FantasyTeam[],
): MutationResult {
  const claim = state.waiverClaims.find(
    (candidate) => candidate.id === command.claimId,
  );
  if (!claim || claim.status !== "PENDING") {
    throw new FantasyTransactionError(
      "WAIVER_CLAIM_UNAVAILABLE",
      "Pending waiver claim is unavailable.",
    );
  }
  teamFor(teams, claim.fantasyTeamId);
  assertFantasyAuthority(
    command.authority,
    state.accountId,
    "fantasy.roster.manage",
    state.fantasyLeagueId,
    claim.fantasyTeamId,
  );
  return {
    entries: state.playerEntries,
    rosters: state.currentRosters,
    claims: state.waiverClaims.map((candidate) =>
      candidate.id === claim.id
        ? freezeClaim({
            ...candidate,
            status: "CANCELLED",
            resolvedAt: command.submittedAt,
          })
        : candidate,
    ),
    status: "CANCELLED",
    effectiveAt: null,
    rosterSnapshotIds: [],
  };
}

function waiverClaimOrder(
  claims: readonly FantasyWaiverClaim[],
  priority: readonly string[],
): readonly FantasyWaiverClaim[] {
  const rank = new Map(priority.map((teamId, index) => [teamId, index]));
  return [...claims].sort((left, right) => {
    const priorityDifference =
      (rank.get(left.fantasyTeamId) ?? Number.MAX_SAFE_INTEGER) -
      (rank.get(right.fantasyTeamId) ?? Number.MAX_SAFE_INTEGER);
    if (priorityDifference !== 0) return priorityDifference;
    const timeDifference =
      Date.parse(left.submittedAt) - Date.parse(right.submittedAt);
    if (timeDifference !== 0) return timeDifference;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
}

function waiverResolutionAudit(
  state: FantasyTransactionState,
  command: ProcessWaiversCommand,
  claim: FantasyWaiverClaim,
  result: "APPLIED" | "DENIED",
  reasonCode: FantasyTransactionErrorCode | null,
): FantasyTransactionAudit {
  const affectedPlayerEntryIds = [
    claim.playerEntryId,
    ...(claim.conditionalDropPlayerEntryId
      ? [claim.conditionalDropPlayerEntryId]
      : []),
  ];
  const idDigest = createHash("sha256")
    .update(`${command.auditId}:${claim.id}`)
    .digest("hex")
    .slice(0, 32);
  return freezeAudit({
    id: `waiver-resolution-${idDigest}`,
    operationId: `${command.operationId}:${claim.id}`,
    actorId: command.authority.actorId,
    authoritySource: command.authority.source,
    authorityReferenceIds: command.authority.authorityReferenceIds,
    accountId: state.accountId,
    fantasyLeagueId: state.fantasyLeagueId,
    action: "PROCESS_WAIVERS",
    affectedPlayerEntryIds,
    acceptedAt: command.processingAt,
    result,
    reasonCode,
    commissionerCorrectionReason: null,
    beforeRevision: state.revision,
    afterRevision: state.revision + 1,
  });
}

function processWaivers(
  state: FantasyTransactionState,
  command: ProcessWaiversCommand,
  league: FantasyLeague,
  teams: readonly FantasyTeam[],
  model: FantasyScoringModelVersion,
): MutationResult {
  assertFantasyAuthority(
    command.authority,
    state.accountId,
    "fantasy.roster.manage",
    state.fantasyLeagueId,
  );
  if (
    !state.policy.waiverProcessingInstants.includes(command.processingAt) ||
    command.processingAt !== command.submittedAt
  ) {
    throw new FantasyTransactionError(
      "PROCESSING_TIME_INVALID",
      "Waiver batch must execute at its sealed processing instant.",
    );
  }
  const due = waiverClaimOrder(
    state.waiverClaims.filter(
      (claim) =>
        claim.status === "PENDING" &&
        claim.processingAt === command.processingAt,
    ),
    state.waiverPriority,
  );
  let entries = state.playerEntries;
  let rosters = state.currentRosters;
  let priority = [...state.waiverPriority];
  const resolved = new Map<string, FantasyWaiverClaim>();
  const snapshotIds: string[] = [];
  const resolutionAudits: FantasyTransactionAudit[] = [];
  for (const claim of due) {
    try {
      let candidateEntries = entries;
      let candidateRosters = rosters;
      const team = teamFor(teams, claim.fantasyTeamId);
      const target = entryFor(candidateEntries, claim.playerEntryId);
      if (
        target.ownership.state === "ROSTERED" ||
        target.ownership.state === "INACTIVE"
      ) {
        throw new FantasyTransactionError(
          "OWNERSHIP_CONFLICT",
          "Waiver target was claimed earlier in this batch.",
        );
      }
      const previous = rosterFor(rosters, team.id);
      let slots: readonly FantasyRosterSlot[] = previous.slots;
      if (claim.conditionalDropPlayerEntryId !== null) {
        const dropped = entryFor(
          candidateEntries,
          claim.conditionalDropPlayerEntryId,
        );
        if (dropped.ownership.fantasyTeamId !== team.id) {
          throw new FantasyTransactionError(
            "OWNERSHIP_CONFLICT",
            "Conditional waiver drop is no longer owned by the team.",
          );
        }
        candidateEntries = replaceEntry(
          candidateEntries,
          ownership(dropped, "RELEASED", null, command.processingAt),
        );
        slots = slotsWithoutPlayer(previous, dropped.id);
      }
      const acquired = ownership(
        target,
        "ROSTERED",
        team.id,
        command.processingAt,
      );
      candidateEntries = replaceEntry(candidateEntries, acquired);
      const roster = successorRoster(
        claim.rosterSnapshotId,
        command.processingAt,
        league,
        team,
        model,
        candidateEntries,
        previous,
        slotsWithAssignment(
          { ...previous, slots },
          claim.targetSlotId,
          target.id,
        ),
        command.authority,
      );
      candidateRosters = replaceRoster(candidateRosters, roster);
      entries = candidateEntries;
      rosters = candidateRosters;
      snapshotIds.push(roster.id);
      priority = [...priority.filter((teamId) => teamId !== team.id), team.id];
      resolved.set(
        claim.id,
        freezeClaim({
          ...claim,
          status: "APPLIED",
          resolvedAt: command.processingAt,
          resultCode: null,
        }),
      );
      resolutionAudits.push(
        waiverResolutionAudit(state, command, claim, "APPLIED", null),
      );
    } catch (error) {
      const code =
        error instanceof FantasyTransactionError
          ? error.code
          : "ROSTER_CONFLICT";
      resolved.set(
        claim.id,
        freezeClaim({
          ...claim,
          status: "REJECTED",
          resolvedAt: command.processingAt,
          resultCode: code,
        }),
      );
      resolutionAudits.push(
        waiverResolutionAudit(state, command, claim, "DENIED", code),
      );
    }
  }
  return {
    entries,
    rosters,
    claims: state.waiverClaims.map((claim) => resolved.get(claim.id) ?? claim),
    priority,
    additionalAudits: resolutionAudits,
    status: "APPLIED",
    effectiveAt: command.processingAt,
    rosterSnapshotIds: snapshotIds,
  };
}

function mutate(
  state: FantasyTransactionState,
  command: FantasyTransactionCommand,
  league: FantasyLeague,
  teams: readonly FantasyTeam[],
  model: FantasyScoringModelVersion,
): MutationResult {
  switch (command.action) {
    case "ADD_PLAYER":
      return addPlayer(state, command, league, teams, model);
    case "DROP_PLAYER":
      return dropPlayer(state, command, league, teams, model);
    case "TRADE":
      return tradePlayers(state, command, league, teams, model);
    case "LINEUP_CHANGE":
      return changeLineup(state, command, league, teams, model);
    case "SUBMIT_WAIVER_CLAIM":
      return submitWaiver(state, command, teams);
    case "CANCEL_WAIVER_CLAIM":
      return cancelWaiver(state, command, teams);
    case "PROCESS_WAIVERS":
      return processWaivers(state, command, league, teams, model);
  }
}

function authorizeCommand(
  state: FantasyTransactionState,
  command: FantasyTransactionCommand,
): void {
  let fantasyTeamId: string | undefined;
  if (
    command.action === "ADD_PLAYER" ||
    command.action === "DROP_PLAYER" ||
    command.action === "LINEUP_CHANGE" ||
    command.action === "SUBMIT_WAIVER_CLAIM"
  ) {
    fantasyTeamId = command.fantasyTeamId;
  } else if (command.action === "CANCEL_WAIVER_CLAIM") {
    fantasyTeamId = state.waiverClaims.find(
      (claim) => claim.id === command.claimId,
    )?.fantasyTeamId;
  }
  assertFantasyAuthority(
    command.authority,
    state.accountId,
    "fantasy.roster.manage",
    state.fantasyLeagueId,
    fantasyTeamId,
  );
  if (
    (command.action === "TRADE" || command.action === "PROCESS_WAIVERS") &&
    command.authority.scope.kind === "FANTASY_TEAM"
  ) {
    throw new FantasyTransactionError(
      "AUTHORIZATION_REQUIRED",
      "League-wide transaction processing requires league-wide authority.",
    );
  }
}

function denialCode(error: unknown): FantasyTransactionErrorCode {
  if (error instanceof FantasyTransactionError) return error.code;
  if (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    if (error.code === "ACCOUNT_MISMATCH") return "ACCOUNT_MISMATCH";
    if (
      error.code === "SCOPE_MISMATCH" ||
      error.code === "AUTHORIZATION_REQUIRED"
    ) {
      return "AUTHORIZATION_REQUIRED";
    }
    if (
      error.code === "ROSTER_CONFLICT" ||
      error.code === "POSITION_INELIGIBLE" ||
      error.code === "RULES_MISMATCH" ||
      error.code === "HISTORY_CONFLICT"
    ) {
      return "ROSTER_CONFLICT";
    }
  }
  return "INVALID_INPUT";
}

function resultEvidence(
  state: FantasyTransactionState,
  command: FantasyTransactionCommand,
  requestDigest: string,
  status: FantasyTransactionRecord["status"],
  resultCode: FantasyTransactionErrorCode | null,
  effectiveAt: string | null,
  rosterSnapshotIds: readonly string[],
  afterRevision: number,
): Readonly<{
  record: FantasyTransactionRecord;
  audit: FantasyTransactionAudit;
}> {
  const affected = [...new Set(affectedPlayers(state, command))];
  const record = freezeRecord({
    operationId: command.operationId,
    requestDigest,
    accountId: command.accountId,
    fantasyLeagueId: command.fantasyLeagueId,
    action: command.action,
    affectedPlayerEntryIds: affected,
    submittedAt: command.submittedAt,
    effectiveAt,
    status,
    resultCode,
    beforeRevision: state.revision,
    afterRevision,
    rosterSnapshotIds,
  });
  const audit = freezeAudit({
    id: command.auditId,
    operationId: command.operationId,
    actorId: command.authority.actorId,
    authoritySource: command.authority.source,
    authorityReferenceIds: command.authority.authorityReferenceIds,
    accountId: command.accountId,
    fantasyLeagueId: command.fantasyLeagueId,
    action: command.action,
    affectedPlayerEntryIds: affected,
    acceptedAt: command.submittedAt,
    result: status,
    reasonCode: resultCode,
    commissionerCorrectionReason:
      command.action === "LINEUP_CHANGE"
        ? command.commissionerCorrectionReason
        : null,
    beforeRevision: state.revision,
    afterRevision,
  });
  return { record, audit };
}

function deniedOutcome(
  state: FantasyTransactionState,
  command: FantasyTransactionCommand,
  requestDigest: string,
  code: FantasyTransactionErrorCode,
): FantasyTransactionOutcome {
  const { record, audit } = resultEvidence(
    state,
    command,
    requestDigest,
    "DENIED",
    code,
    null,
    [],
    state.revision,
  );
  return Object.freeze({
    state: freezeState({
      ...state,
      transactions:
        code === "IDEMPOTENCY_CONFLICT"
          ? state.transactions
          : [...state.transactions, record],
      audits: [...state.audits, audit],
    }),
    record,
    audit,
    duplicate: false,
  });
}

export function applyFantasyTransaction(
  state: FantasyTransactionState,
  commandValue: unknown,
  context: Readonly<{
    league: FantasyLeague;
    teams: readonly FantasyTeam[];
    model: FantasyScoringModelVersion;
  }>,
): FantasyTransactionOutcome {
  const command = parseCommand(commandValue);
  const requestDigest = commandDigest(command);
  const existing = state.transactions.find(
    (transaction) => transaction.operationId === command.operationId,
  );
  if (existing) {
    if (existing.requestDigest !== requestDigest) {
      return deniedOutcome(
        state,
        command,
        requestDigest,
        "IDEMPOTENCY_CONFLICT",
      );
    }
    const audit = state.audits.find(
      (candidate) => candidate.operationId === command.operationId,
    );
    if (!audit) {
      throw new FantasyTransactionError(
        "INVALID_INPUT",
        "Committed transaction is missing audit evidence.",
      );
    }
    return Object.freeze({ state, record: existing, audit, duplicate: true });
  }
  if (
    command.accountId !== state.accountId ||
    command.accountId !== context.league.accountId
  ) {
    return deniedOutcome(state, command, requestDigest, "ACCOUNT_MISMATCH");
  }
  if (
    command.fantasyLeagueId !== state.fantasyLeagueId ||
    command.fantasyLeagueId !== context.league.id ||
    context.teams.some(
      (team) =>
        team.accountId !== state.accountId ||
        team.fantasyLeagueId !== state.fantasyLeagueId,
    )
  ) {
    return deniedOutcome(state, command, requestDigest, "LEAGUE_MISMATCH");
  }
  if (context.league.lifecycle !== "ACTIVE") {
    return deniedOutcome(state, command, requestDigest, "LEAGUE_INACTIVE");
  }
  if (
    Date.parse(command.authority.authorizedAt) > Date.parse(command.submittedAt)
  ) {
    return deniedOutcome(
      state,
      command,
      requestDigest,
      "AUTHORIZATION_REQUIRED",
    );
  }
  try {
    authorizeCommand(state, command);
  } catch (error) {
    return deniedOutcome(state, command, requestDigest, denialCode(error));
  }
  if (command.expectedRevision !== state.revision) {
    return deniedOutcome(state, command, requestDigest, "STALE_REVISION");
  }
  try {
    verifyFantasyScoringModel(context.model);
    const mutation = mutate(
      state,
      command,
      context.league,
      context.teams,
      context.model,
    );
    assertOwnershipProjection(mutation.entries, mutation.rosters);
    const afterRevision = state.revision + 1;
    const { record, audit } = resultEvidence(
      state,
      command,
      requestDigest,
      mutation.status,
      null,
      mutation.effectiveAt,
      mutation.rosterSnapshotIds,
      afterRevision,
    );
    const next = freezeState({
      ...state,
      revision: afterRevision,
      playerEntries: mutation.entries,
      currentRosters: mutation.rosters,
      waiverClaims: mutation.claims ?? state.waiverClaims,
      waiverPriority: mutation.priority ?? state.waiverPriority,
      transactions: [...state.transactions, record],
      audits: [...state.audits, audit, ...(mutation.additionalAudits ?? [])],
    });
    return Object.freeze({
      state: next,
      record,
      audit,
      duplicate: false,
    });
  } catch (error) {
    return deniedOutcome(state, command, requestDigest, denialCode(error));
  }
}
