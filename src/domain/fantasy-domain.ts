import { z } from "zod";

import {
  verifyFantasyScoringModel,
  type FantasyModelOwner,
  type FantasyScoringModelVersion,
} from "@/domain/fantasy-rules";
import type { DelegationDecision } from "@/domain/league-delegation";

export const FANTASY_DOMAIN_CONTRACT_VERSION = 1 as const;

const stableId = z.string().trim().min(1).max(128);
const label = z.string().trim().min(1).max(120);
const instant = z.iso.datetime({ offset: true });
const uniqueIds = z
  .array(stableId)
  .min(1)
  .superRefine((ids, context) => {
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        message: "Identifiers must be unique.",
      });
    }
  });

export type FantasyDomainCapability =
  | "fantasy.league.manage"
  | "fantasy.league.activate"
  | "fantasy.team.manage"
  | "fantasy.roster.manage";

export type FantasyDomainErrorCode =
  | "INVALID_INPUT"
  | "AUTHORIZATION_REQUIRED"
  | "ACCOUNT_MISMATCH"
  | "SCOPE_MISMATCH"
  | "RULES_MISMATCH"
  | "INVALID_TRANSITION"
  | "HISTORY_CONFLICT"
  | "ROSTER_CONFLICT"
  | "POSITION_INELIGIBLE";

export class FantasyDomainError extends Error {
  constructor(
    readonly code: FantasyDomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "FantasyDomainError";
  }
}

export type FantasyAuthorityScope =
  | Readonly<{ kind: "ACCOUNT" }>
  | Readonly<{ kind: "FANTASY_LEAGUE"; fantasyLeagueId: string }>
  | Readonly<{
      kind: "FANTASY_TEAM";
      fantasyLeagueId: string;
      fantasyTeamId: string;
    }>;

export type FantasyDomainAuthority = Readonly<{
  accountId: string;
  actorId: string;
  source: "ACCOUNT_PERMISSION" | "LEAGUE_DELEGATION";
  capability: FantasyDomainCapability;
  scope: FantasyAuthorityScope;
  authorityReferenceIds: readonly string[];
  authorizedAt: string;
}>;

export type FantasyAdministrativeScope = Readonly<{
  organizationId: string;
  leagueId: string;
}> | null;

export type FantasyRulesBinding = Readonly<{
  modelId: string;
  modelVersionId: string;
  modelVersion: number;
  modelDigest: string;
  modelOwner: FantasyModelOwner;
  statisticRegistryVersion: string;
}>;

export type FantasyLeagueLifecycle =
  "DRAFT" | "ACTIVE" | "COMPLETED" | "ARCHIVED";
export type FantasyLeagueVisibility =
  "PRIVATE" | "LEAGUE_MEMBERS" | "PUBLIC_METADATA_ONLY";

export type FantasyLeague = Readonly<{
  contractVersion: typeof FANTASY_DOMAIN_CONTRACT_VERSION;
  id: string;
  accountId: string;
  owner: Readonly<{ kind: "ACCOUNT"; accountId: string }>;
  administrativeScope: FantasyAdministrativeScope;
  seasonId: string;
  name: string;
  rules: FantasyRulesBinding;
  lifecycle: FantasyLeagueLifecycle;
  visibility: FantasyLeagueVisibility;
  revision: number;
  createdAt: string;
  activatedAt: string | null;
  completedAt: string | null;
  archivedAt: string | null;
}>;

export type FantasyTeamLifecycle =
  "DRAFT" | "ACTIVE" | "WITHDRAWN" | "ARCHIVED";

export type FantasyTeam = Readonly<{
  contractVersion: typeof FANTASY_DOMAIN_CONTRACT_VERSION;
  id: string;
  accountId: string;
  fantasyLeagueId: string;
  owner: Readonly<{
    accountId: string;
    accountMembershipId: string;
  }>;
  name: string;
  lifecycle: FantasyTeamLifecycle;
  revision: number;
  createdAt: string;
  activatedAt: string | null;
  withdrawnAt: string | null;
  archivedAt: string | null;
}>;

export type FantasyEligibilitySnapshot = Readonly<{
  fantasyModelVersionId: string;
  fantasyModelDigest: string;
  eligiblePositionCodes: readonly string[];
  sourceRosterRevision: number;
  sourceStatisticsRevision: number;
  verification: "VERIFIED";
  evaluatedAt: string;
}>;

export type FantasyOwnershipSnapshot = Readonly<{
  state: "AVAILABLE" | "ROSTERED" | "INACTIVE" | "RELEASED";
  fantasyTeamId: string | null;
  revision: number;
  effectiveAt: string;
}>;

export type FantasyPlayerEntry = Readonly<{
  contractVersion: typeof FANTASY_DOMAIN_CONTRACT_VERSION;
  id: string;
  accountId: string;
  fantasyLeagueId: string;
  baseballPlayerId: string;
  eligibility: FantasyEligibilitySnapshot;
  ownership: FantasyOwnershipSnapshot;
  createdAt: string;
}>;

export type FantasyRosterSlot = Readonly<{
  id: string;
  kind: "ACTIVE" | "BENCH" | "INACTIVE";
  lineupSlotRuleId: string | null;
  playerEntryId: string | null;
}>;

export type FantasyRosterSnapshot = Readonly<{
  contractVersion: typeof FANTASY_DOMAIN_CONTRACT_VERSION;
  id: string;
  accountId: string;
  fantasyLeagueId: string;
  fantasyTeamId: string;
  revision: number;
  previousSnapshotId: string | null;
  effectiveAt: string;
  rules: FantasyRulesBinding;
  slots: readonly FantasyRosterSlot[];
}>;

const authoritySchema = z
  .object({
    accountId: stableId,
    actorId: stableId,
    source: z.enum(["ACCOUNT_PERMISSION", "LEAGUE_DELEGATION"]),
    capability: z.enum([
      "fantasy.league.manage",
      "fantasy.league.activate",
      "fantasy.team.manage",
      "fantasy.roster.manage",
    ]),
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
    authorityReferenceIds: uniqueIds,
    authorizedAt: instant,
  })
  .strict();

const administrativeScopeSchema = z
  .object({ organizationId: stableId, leagueId: stableId })
  .strict()
  .nullable();

const createLeagueSchema = z
  .object({
    id: stableId,
    accountId: stableId,
    administrativeScope: administrativeScopeSchema,
    seasonId: stableId,
    name: label,
    visibility: z.enum(["PRIVATE", "LEAGUE_MEMBERS", "PUBLIC_METADATA_ONLY"]),
    createdAt: instant,
  })
  .strict();

const createTeamSchema = z
  .object({
    id: stableId,
    accountId: stableId,
    fantasyLeagueId: stableId,
    ownerAccountMembershipId: stableId,
    name: label,
    createdAt: instant,
  })
  .strict();

const eligibilitySchema = z
  .object({
    fantasyModelVersionId: stableId,
    fantasyModelDigest: stableId,
    eligiblePositionCodes: z.array(stableId).superRefine((codes, context) => {
      if (new Set(codes).size !== codes.length) {
        context.addIssue({
          code: "custom",
          message: "Eligible positions must be unique.",
        });
      }
    }),
    sourceRosterRevision: z.int().nonnegative(),
    sourceStatisticsRevision: z.int().nonnegative(),
    verification: z.literal("VERIFIED"),
    evaluatedAt: instant,
  })
  .strict();

const ownershipSchema = z
  .object({
    state: z.enum(["AVAILABLE", "ROSTERED", "INACTIVE", "RELEASED"]),
    fantasyTeamId: stableId.nullable(),
    revision: z.int().nonnegative(),
    effectiveAt: instant,
  })
  .strict()
  .superRefine((ownership, context) => {
    const owned =
      ownership.state === "ROSTERED" || ownership.state === "INACTIVE";
    if (owned !== (ownership.fantasyTeamId !== null)) {
      context.addIssue({
        code: "custom",
        message: "Ownership state and fantasy team reference disagree.",
      });
    }
  });

const createPlayerEntrySchema = z
  .object({
    id: stableId,
    accountId: stableId,
    fantasyLeagueId: stableId,
    baseballPlayerId: stableId,
    eligibility: eligibilitySchema,
    ownership: ownershipSchema,
    createdAt: instant,
  })
  .strict();

const rosterSlotSchema = z
  .object({
    id: stableId,
    kind: z.enum(["ACTIVE", "BENCH", "INACTIVE"]),
    lineupSlotRuleId: stableId.nullable(),
    playerEntryId: stableId.nullable(),
  })
  .strict()
  .superRefine((slot, context) => {
    if ((slot.kind === "ACTIVE") !== (slot.lineupSlotRuleId !== null)) {
      context.addIssue({
        code: "custom",
        message: "Only active slots bind an active lineup rule.",
      });
    }
  });

const createRosterSnapshotSchema = z
  .object({
    id: stableId,
    accountId: stableId,
    fantasyLeagueId: stableId,
    fantasyTeamId: stableId,
    revision: z.int().nonnegative(),
    previousSnapshotId: stableId.nullable(),
    effectiveAt: instant,
    slots: z.array(rosterSlotSchema),
  })
  .strict();

function parsed<T>(schema: z.ZodType<T>, value: unknown, message: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new FantasyDomainError("INVALID_INPUT", message);
  }
  return result.data;
}

function sameInstantOrAfter(value: string, earliest: string): boolean {
  return Date.parse(value) >= Date.parse(earliest);
}

function rulesBinding(model: FantasyScoringModelVersion): FantasyRulesBinding {
  verifyFantasyScoringModel(model);
  return Object.freeze({
    modelId: model.modelId,
    modelVersionId: model.modelVersionId,
    modelVersion: model.version,
    modelDigest: model.contentDigest,
    modelOwner: Object.freeze({ ...model.owner }),
    statisticRegistryVersion: model.statisticRegistryVersion,
  });
}

function bindingMatchesModel(
  binding: FantasyRulesBinding,
  model: FantasyScoringModelVersion,
): boolean {
  return (
    binding.modelId === model.modelId &&
    binding.modelVersionId === model.modelVersionId &&
    binding.modelVersion === model.version &&
    binding.modelDigest === model.contentDigest &&
    binding.statisticRegistryVersion === model.statisticRegistryVersion &&
    binding.modelOwner.kind === model.owner.kind &&
    binding.modelOwner.id === model.owner.id
  );
}

function modelOwnerAllowed(
  accountId: string,
  administrativeScope: FantasyAdministrativeScope,
  owner: FantasyModelOwner,
): boolean {
  if (owner.kind === "PLATFORM") return true;
  if (owner.kind === "ACCOUNT") return owner.id === accountId;
  if (owner.kind === "ORGANIZATION") {
    return administrativeScope?.organizationId === owner.id;
  }
  return administrativeScope?.leagueId === owner.id;
}

function scopeAllows(
  scope: FantasyAuthorityScope,
  fantasyLeagueId?: string,
  fantasyTeamId?: string,
): boolean {
  if (scope.kind === "ACCOUNT") return true;
  if (!fantasyLeagueId || scope.fantasyLeagueId !== fantasyLeagueId)
    return false;
  if (scope.kind === "FANTASY_LEAGUE") return true;
  return fantasyTeamId !== undefined && scope.fantasyTeamId === fantasyTeamId;
}

export function assertFantasyAuthority(
  authorityInput: FantasyDomainAuthority,
  accountId: string,
  capability: FantasyDomainCapability,
  fantasyLeagueId?: string,
  fantasyTeamId?: string,
): void {
  const authority = parsed(
    authoritySchema,
    authorityInput,
    "Fantasy authority evidence is invalid.",
  );
  if (authority.accountId !== accountId) {
    throw new FantasyDomainError(
      "ACCOUNT_MISMATCH",
      "Fantasy authority belongs to another Account.",
    );
  }
  if (authority.capability !== capability) {
    throw new FantasyDomainError(
      "AUTHORIZATION_REQUIRED",
      "Fantasy operation requires an exact capability.",
    );
  }
  if (!scopeAllows(authority.scope, fantasyLeagueId, fantasyTeamId)) {
    throw new FantasyDomainError(
      "SCOPE_MISMATCH",
      "Fantasy authority does not cover the requested aggregate.",
    );
  }
  if (
    authority.source === "LEAGUE_DELEGATION" &&
    authority.authorityReferenceIds.length < 3
  ) {
    throw new FantasyDomainError(
      "AUTHORIZATION_REQUIRED",
      "Delegated fantasy authority requires complete #107 evidence.",
    );
  }
  if (
    capability === "fantasy.league.activate" &&
    authority.authorityReferenceIds.length < 2
  ) {
    throw new FantasyDomainError(
      "AUTHORIZATION_REQUIRED",
      "Fantasy league activation requires distinct approval evidence.",
    );
  }
}

export function fantasyAuthorityFromDelegation(
  decision: DelegationDecision,
  input: Readonly<{
    accountId: string;
    actorId: string;
    capability: FantasyDomainCapability;
    scope: FantasyAuthorityScope;
    authorizedAt: string;
  }>,
): FantasyDomainAuthority {
  if (
    !decision.allowed ||
    decision.capability !== input.capability ||
    decision.scope.kind !== "ACCOUNT" ||
    decision.scope.accountId !== input.accountId ||
    decision.audit.actorId !== input.actorId ||
    decision.audit.evaluatedAt !== input.authorizedAt
  ) {
    throw new FantasyDomainError(
      "AUTHORIZATION_REQUIRED",
      "An allowed exact-Account #107 decision is required.",
    );
  }
  return Object.freeze(
    parsed(
      authoritySchema,
      {
        ...input,
        source: "LEAGUE_DELEGATION",
        authorityReferenceIds: [...decision.authorityReferenceIds],
      },
      "Delegated fantasy authority evidence is invalid.",
    ),
  );
}

export function createFantasyLeague(
  inputValue: unknown,
  model: FantasyScoringModelVersion,
  authority: FantasyDomainAuthority,
): FantasyLeague {
  const input = parsed(
    createLeagueSchema,
    inputValue,
    "Fantasy league input is invalid or contains unsupported private fields.",
  );
  assertFantasyAuthority(authority, input.accountId, "fantasy.league.manage");
  verifyFantasyScoringModel(model);
  if (!["REVIEWED", "ACTIVE"].includes(model.lifecycle)) {
    throw new FantasyDomainError(
      "RULES_MISMATCH",
      "A fantasy league requires a reviewed or active rules model.",
    );
  }
  if (
    !modelOwnerAllowed(input.accountId, input.administrativeScope, model.owner)
  ) {
    throw new FantasyDomainError(
      "RULES_MISMATCH",
      "Fantasy rules owner does not match the Account or administrative scope.",
    );
  }
  return Object.freeze({
    contractVersion: FANTASY_DOMAIN_CONTRACT_VERSION,
    id: input.id,
    accountId: input.accountId,
    owner: Object.freeze({ kind: "ACCOUNT", accountId: input.accountId }),
    administrativeScope:
      input.administrativeScope === null
        ? null
        : Object.freeze({ ...input.administrativeScope }),
    seasonId: input.seasonId,
    name: input.name,
    rules: rulesBinding(model),
    lifecycle: "DRAFT",
    visibility: input.visibility,
    revision: 0,
    createdAt: input.createdAt,
    activatedAt: null,
    completedAt: null,
    archivedAt: null,
  });
}

const leagueTransitions: Readonly<
  Record<FantasyLeagueLifecycle, readonly FantasyLeagueLifecycle[]>
> = {
  DRAFT: ["ACTIVE", "ARCHIVED"],
  ACTIVE: ["COMPLETED"],
  COMPLETED: ["ARCHIVED"],
  ARCHIVED: [],
};

export function transitionFantasyLeague(
  league: FantasyLeague,
  lifecycle: FantasyLeagueLifecycle,
  at: string,
  authority: FantasyDomainAuthority,
  model: FantasyScoringModelVersion,
): FantasyLeague {
  const parsedAt = parsed(
    instant,
    at,
    "Fantasy lifecycle timestamp is invalid.",
  );
  const capability =
    league.lifecycle === "DRAFT" && lifecycle === "ACTIVE"
      ? "fantasy.league.activate"
      : "fantasy.league.manage";
  assertFantasyAuthority(authority, league.accountId, capability, league.id);
  if (!leagueTransitions[league.lifecycle].includes(lifecycle)) {
    throw new FantasyDomainError(
      "INVALID_TRANSITION",
      `Fantasy league cannot transition from ${league.lifecycle} to ${lifecycle}.`,
    );
  }
  if (!sameInstantOrAfter(parsedAt, league.createdAt)) {
    throw new FantasyDomainError(
      "HISTORY_CONFLICT",
      "Fantasy lifecycle time cannot precede creation.",
    );
  }
  verifyFantasyScoringModel(model);
  if (!bindingMatchesModel(league.rules, model)) {
    throw new FantasyDomainError(
      "RULES_MISMATCH",
      "Fantasy league rules binding cannot change during a season.",
    );
  }
  if (lifecycle === "ACTIVE" && model.lifecycle !== "ACTIVE") {
    throw new FantasyDomainError(
      "RULES_MISMATCH",
      "Fantasy league activation requires an active rules model.",
    );
  }
  return Object.freeze({
    ...league,
    lifecycle,
    revision: league.revision + 1,
    activatedAt: lifecycle === "ACTIVE" ? parsedAt : league.activatedAt,
    completedAt: lifecycle === "COMPLETED" ? parsedAt : league.completedAt,
    archivedAt: lifecycle === "ARCHIVED" ? parsedAt : league.archivedAt,
  });
}

export function createFantasyTeam(
  inputValue: unknown,
  league: FantasyLeague,
  authority: FantasyDomainAuthority,
): FantasyTeam {
  const input = parsed(
    createTeamSchema,
    inputValue,
    "Fantasy team input is invalid or contains unsupported private fields.",
  );
  assertFantasyAuthority(
    authority,
    input.accountId,
    "fantasy.team.manage",
    input.fantasyLeagueId,
  );
  if (
    input.accountId !== league.accountId ||
    input.fantasyLeagueId !== league.id
  ) {
    throw new FantasyDomainError(
      "ACCOUNT_MISMATCH",
      "Fantasy team must belong to the exact Account and league.",
    );
  }
  if (league.lifecycle === "COMPLETED" || league.lifecycle === "ARCHIVED") {
    throw new FantasyDomainError(
      "HISTORY_CONFLICT",
      "Historical fantasy leagues cannot accept new teams.",
    );
  }
  if (!sameInstantOrAfter(input.createdAt, league.createdAt)) {
    throw new FantasyDomainError(
      "HISTORY_CONFLICT",
      "Fantasy team cannot predate its league.",
    );
  }
  return Object.freeze({
    contractVersion: FANTASY_DOMAIN_CONTRACT_VERSION,
    id: input.id,
    accountId: input.accountId,
    fantasyLeagueId: input.fantasyLeagueId,
    owner: Object.freeze({
      accountId: input.accountId,
      accountMembershipId: input.ownerAccountMembershipId,
    }),
    name: input.name,
    lifecycle: "DRAFT",
    revision: 0,
    createdAt: input.createdAt,
    activatedAt: null,
    withdrawnAt: null,
    archivedAt: null,
  });
}

const teamTransitions: Readonly<
  Record<FantasyTeamLifecycle, readonly FantasyTeamLifecycle[]>
> = {
  DRAFT: ["ACTIVE", "ARCHIVED"],
  ACTIVE: ["WITHDRAWN"],
  WITHDRAWN: ["ARCHIVED"],
  ARCHIVED: [],
};

export function transitionFantasyTeam(
  team: FantasyTeam,
  league: FantasyLeague,
  lifecycle: FantasyTeamLifecycle,
  at: string,
  authority: FantasyDomainAuthority,
): FantasyTeam {
  const parsedAt = parsed(
    instant,
    at,
    "Fantasy team lifecycle timestamp is invalid.",
  );
  assertFantasyAuthority(
    authority,
    team.accountId,
    "fantasy.team.manage",
    team.fantasyLeagueId,
    team.id,
  );
  if (
    team.accountId !== league.accountId ||
    team.fantasyLeagueId !== league.id
  ) {
    throw new FantasyDomainError(
      "ACCOUNT_MISMATCH",
      "Fantasy team and league ancestry must match exactly.",
    );
  }
  if (!teamTransitions[team.lifecycle].includes(lifecycle)) {
    throw new FantasyDomainError(
      "INVALID_TRANSITION",
      `Fantasy team cannot transition from ${team.lifecycle} to ${lifecycle}.`,
    );
  }
  if (
    !sameInstantOrAfter(parsedAt, team.createdAt) ||
    (lifecycle === "ACTIVE" && league.lifecycle !== "ACTIVE")
  ) {
    throw new FantasyDomainError(
      "HISTORY_CONFLICT",
      "Fantasy team lifecycle must follow its team and active league history.",
    );
  }
  return Object.freeze({
    ...team,
    lifecycle,
    revision: team.revision + 1,
    activatedAt: lifecycle === "ACTIVE" ? parsedAt : team.activatedAt,
    withdrawnAt: lifecycle === "WITHDRAWN" ? parsedAt : team.withdrawnAt,
    archivedAt: lifecycle === "ARCHIVED" ? parsedAt : team.archivedAt,
  });
}

export function createFantasyPlayerEntry(
  inputValue: unknown,
  league: FantasyLeague,
  authority: FantasyDomainAuthority,
): FantasyPlayerEntry {
  const input = parsed(
    createPlayerEntrySchema,
    inputValue,
    "Fantasy player entry is invalid or contains forbidden personal data.",
  );
  assertFantasyAuthority(
    authority,
    input.accountId,
    "fantasy.roster.manage",
    input.fantasyLeagueId,
    input.ownership.fantasyTeamId ?? undefined,
  );
  if (
    input.accountId !== league.accountId ||
    input.fantasyLeagueId !== league.id
  ) {
    throw new FantasyDomainError(
      "ACCOUNT_MISMATCH",
      "Fantasy player reference must remain in the exact Account and league.",
    );
  }
  if (
    input.eligibility.fantasyModelVersionId !== league.rules.modelVersionId ||
    input.eligibility.fantasyModelDigest !== league.rules.modelDigest
  ) {
    throw new FantasyDomainError(
      "RULES_MISMATCH",
      "Fantasy eligibility must use the league's exact rules version and digest.",
    );
  }
  if (league.lifecycle === "COMPLETED" || league.lifecycle === "ARCHIVED") {
    throw new FantasyDomainError(
      "HISTORY_CONFLICT",
      "Historical fantasy leagues cannot accept player entries.",
    );
  }
  if (!sameInstantOrAfter(input.createdAt, league.createdAt)) {
    throw new FantasyDomainError(
      "HISTORY_CONFLICT",
      "Fantasy player reference cannot predate its league.",
    );
  }
  return Object.freeze({
    contractVersion: FANTASY_DOMAIN_CONTRACT_VERSION,
    id: input.id,
    accountId: input.accountId,
    fantasyLeagueId: input.fantasyLeagueId,
    baseballPlayerId: input.baseballPlayerId,
    eligibility: Object.freeze({
      ...input.eligibility,
      eligiblePositionCodes: Object.freeze([
        ...input.eligibility.eligiblePositionCodes,
      ]),
    }),
    ownership: Object.freeze({ ...input.ownership }),
    createdAt: input.createdAt,
  });
}

function sameRules(
  left: FantasyRulesBinding,
  right: FantasyRulesBinding,
): boolean {
  return (
    left.modelVersionId === right.modelVersionId &&
    left.modelDigest === right.modelDigest
  );
}

export function createFantasyRosterSnapshot(
  inputValue: unknown,
  league: FantasyLeague,
  team: FantasyTeam,
  model: FantasyScoringModelVersion,
  playerEntries: readonly FantasyPlayerEntry[],
  authority: FantasyDomainAuthority,
  previous: FantasyRosterSnapshot | null = null,
): FantasyRosterSnapshot {
  const input = parsed(
    createRosterSnapshotSchema,
    inputValue,
    "Fantasy roster snapshot input is invalid.",
  );
  assertFantasyAuthority(
    authority,
    input.accountId,
    "fantasy.roster.manage",
    input.fantasyLeagueId,
    input.fantasyTeamId,
  );
  if (
    input.accountId !== league.accountId ||
    input.accountId !== team.accountId ||
    input.fantasyLeagueId !== league.id ||
    input.fantasyLeagueId !== team.fantasyLeagueId ||
    input.fantasyTeamId !== team.id
  ) {
    throw new FantasyDomainError(
      "ACCOUNT_MISMATCH",
      "Roster, team, and league ancestry must match exactly.",
    );
  }
  if (league.lifecycle !== "ACTIVE" || team.lifecycle !== "ACTIVE") {
    throw new FantasyDomainError(
      "HISTORY_CONFLICT",
      "Only a live fantasy league and team can receive a roster snapshot.",
    );
  }
  verifyFantasyScoringModel(model);
  if (!bindingMatchesModel(league.rules, model)) {
    throw new FantasyDomainError(
      "RULES_MISMATCH",
      "Roster snapshot rules must match the league's sealed binding.",
    );
  }
  if (
    (previous === null &&
      (input.revision !== 0 || input.previousSnapshotId !== null)) ||
    (previous !== null &&
      (previous.accountId !== input.accountId ||
        previous.fantasyLeagueId !== input.fantasyLeagueId ||
        previous.fantasyTeamId !== input.fantasyTeamId ||
        input.revision !== previous.revision + 1 ||
        input.previousSnapshotId !== previous.id ||
        !sameRules(previous.rules, league.rules) ||
        Date.parse(input.effectiveAt) <= Date.parse(previous.effectiveAt)))
  ) {
    throw new FantasyDomainError(
      "HISTORY_CONFLICT",
      "Roster snapshots require an append-only, ordered revision chain.",
    );
  }

  const slotIds = new Set<string>();
  const playerEntryIds = new Set<string>();
  const baseballPlayerIds = new Set<string>();
  const entries = new Map(playerEntries.map((entry) => [entry.id, entry]));
  if (entries.size !== playerEntries.length) {
    throw new FantasyDomainError(
      "ROSTER_CONFLICT",
      "Candidate fantasy player entry ids must be unique.",
    );
  }
  const lineupRules = new Map(
    model.roster.lineupSlots.map((rule) => [rule.id, rule]),
  );
  const activeCounts = new Map<string, number>();
  let benchCount = 0;
  for (const slot of input.slots) {
    if (slotIds.has(slot.id)) {
      throw new FantasyDomainError(
        "ROSTER_CONFLICT",
        "Roster slot ids must be unique.",
      );
    }
    slotIds.add(slot.id);
    if (slot.kind === "BENCH") benchCount += 1;
    if (slot.kind === "ACTIVE" && slot.lineupSlotRuleId !== null) {
      const rule = lineupRules.get(slot.lineupSlotRuleId);
      if (!rule) {
        throw new FantasyDomainError(
          "ROSTER_CONFLICT",
          "Active roster slot rule is unknown.",
        );
      }
      activeCounts.set(rule.id, (activeCounts.get(rule.id) ?? 0) + 1);
      if ((activeCounts.get(rule.id) ?? 0) > rule.count) {
        throw new FantasyDomainError(
          "ROSTER_CONFLICT",
          "Active roster slot count exceeds its rule.",
        );
      }
    }
    if (slot.playerEntryId === null) continue;
    if (playerEntryIds.has(slot.playerEntryId)) {
      throw new FantasyDomainError(
        "ROSTER_CONFLICT",
        "A player entry cannot occupy two slots.",
      );
    }
    playerEntryIds.add(slot.playerEntryId);
    const entry = entries.get(slot.playerEntryId);
    if (
      !entry ||
      entry.accountId !== input.accountId ||
      entry.fantasyLeagueId !== input.fantasyLeagueId ||
      entry.eligibility.fantasyModelVersionId !== league.rules.modelVersionId ||
      entry.eligibility.fantasyModelDigest !== league.rules.modelDigest ||
      entry.ownership.fantasyTeamId !== input.fantasyTeamId ||
      (entry.ownership.state !== "ROSTERED" &&
        entry.ownership.state !== "INACTIVE")
    ) {
      throw new FantasyDomainError(
        "ROSTER_CONFLICT",
        "Roster entry ownership and aggregate ancestry must match.",
      );
    }
    if (baseballPlayerIds.has(entry.baseballPlayerId)) {
      throw new FantasyDomainError(
        "ROSTER_CONFLICT",
        "A baseball player can appear only once on one fantasy roster snapshot.",
      );
    }
    baseballPlayerIds.add(entry.baseballPlayerId);
    if (slot.kind === "ACTIVE") {
      const rule = lineupRules.get(slot.lineupSlotRuleId!);
      if (
        entry.ownership.state !== "ROSTERED" ||
        !rule?.eligiblePositionCodes.some((position) =>
          entry.eligibility.eligiblePositionCodes.includes(position),
        )
      ) {
        throw new FantasyDomainError(
          "POSITION_INELIGIBLE",
          "Active player is not eligible for the requested lineup slot.",
        );
      }
    }
    if (slot.kind === "BENCH" && entry.ownership.state !== "ROSTERED") {
      throw new FantasyDomainError(
        "ROSTER_CONFLICT",
        "Bench slots require a rostered ownership snapshot.",
      );
    }
    if (slot.kind === "INACTIVE" && entry.ownership.state !== "INACTIVE") {
      throw new FantasyDomainError(
        "ROSTER_CONFLICT",
        "Inactive slots require an inactive ownership snapshot.",
      );
    }
  }
  if (
    playerEntryIds.size > model.roster.maximumRosterSize ||
    benchCount > model.roster.benchSlots
  ) {
    throw new FantasyDomainError(
      "ROSTER_CONFLICT",
      "Roster exceeds the sealed model limits.",
    );
  }

  return Object.freeze({
    contractVersion: FANTASY_DOMAIN_CONTRACT_VERSION,
    id: input.id,
    accountId: input.accountId,
    fantasyLeagueId: input.fantasyLeagueId,
    fantasyTeamId: input.fantasyTeamId,
    revision: input.revision,
    previousSnapshotId: input.previousSnapshotId,
    effectiveAt: input.effectiveAt,
    rules: rulesBinding(model),
    slots: Object.freeze(input.slots.map((slot) => Object.freeze({ ...slot }))),
  });
}
