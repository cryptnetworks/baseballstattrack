import type { AuthorizationScope, MembershipRole } from "@prisma/client";

import {
  capabilities,
  type ActiveAuthority,
  type AuthorityAssignment,
  type Capability,
  type ResolvedTarget,
} from "@/server/auth/types";

const capabilitySet = new Set<string>(capabilities);

const viewer = [
  "account.view",
  "team.view",
  "season.view",
  "roster.view",
  "game.view",
  "report.view",
  "fantasy.league.view",
  "fantasy.roster.manage",
  "fantasy.scoring.view",
] satisfies Capability[];

const scorekeeper = [
  ...viewer,
  "game.create",
  "game.setup",
  "game.start",
  "game.score",
  "game.suspend",
  "game.resume",
  "game.complete",
] satisfies Capability[];

const coachManager = [
  ...scorekeeper,
  "team.manage",
  "season.manage",
  "roster.manage",
  "report.export",
  "discord.settings.view",
  "discord.settings.preview",
] satisfies Capability[];

const administrator = [
  ...coachManager,
  "account.manage",
  "membership.view",
  "membership.invite",
  "membership.update",
  "membership.remove",
  "membership.role_assign",
  "membership.grant_manage",
  "player.private_view",
  "game.correct",
  "game.reopen",
  "game.abandon",
  "game.cancel",
  "game.archive",
  "game.verify",
  "game.reverify",
  "audit.view",
  "discord.settings.configure",
  "discord.settings.operate",
  "privacy.request",
  "ruleset.view",
  "ruleset.manage",
  "fantasy.league.manage",
  "fantasy.league.activate",
  "fantasy.scoring.calculate",
] satisfies Capability[];

const owner = [
  ...administrator,
  "account.archive",
  "account.delete_request",
  "ownership.transfer",
  "ownership.promote",
  "ownership.demote",
  "privacy.manage",
] satisfies Capability[];

const roleCapabilities: Readonly<Record<MembershipRole, Set<Capability>>> = {
  OWNER: new Set(owner),
  ADMINISTRATOR: new Set(administrator),
  COACH_MANAGER: new Set(coachManager),
  SCOREKEEPER: new Set(scorekeeper),
  VIEWER: new Set(viewer),
};

const exactGrantScopes: Readonly<
  Partial<Record<Capability, readonly AuthorizationScope[]>>
> = {
  "account.view": ["ACCOUNT"],
  "account.manage": ["ACCOUNT"],
  "account.archive": ["ACCOUNT"],
  "account.delete_request": ["ACCOUNT"],
  "membership.view": ["ACCOUNT"],
  "membership.invite": ["ACCOUNT"],
  "membership.update": ["ACCOUNT"],
  "membership.remove": ["ACCOUNT"],
  "membership.role_assign": ["ACCOUNT"],
  "membership.grant_manage": ["ACCOUNT"],
  "ownership.transfer": ["ACCOUNT"],
  "ownership.promote": ["ACCOUNT"],
  "ownership.demote": ["ACCOUNT"],
  "team.view": ["ACCOUNT", "TEAM"],
  "team.manage": ["ACCOUNT", "TEAM"],
  "season.view": ["ACCOUNT", "SEASON"],
  "season.manage": ["ACCOUNT", "TEAM", "SEASON"],
  "roster.view": ["ACCOUNT", "TEAM", "SEASON"],
  "roster.manage": ["ACCOUNT", "TEAM", "SEASON"],
  "player.private_view": ["ACCOUNT", "TEAM", "SEASON", "GAME"],
  "game.create": ["ACCOUNT", "TEAM", "SEASON"],
  "game.setup": ["ACCOUNT", "TEAM", "SEASON", "GAME"],
  "game.view": ["ACCOUNT", "TEAM", "SEASON", "GAME"],
  "game.start": ["ACCOUNT", "TEAM", "SEASON", "GAME"],
  "game.score": ["ACCOUNT", "TEAM", "SEASON", "GAME"],
  "game.suspend": ["ACCOUNT", "TEAM", "SEASON", "GAME"],
  "game.resume": ["ACCOUNT", "TEAM", "SEASON", "GAME"],
  "game.complete": ["ACCOUNT", "TEAM", "SEASON", "GAME"],
  "game.correct": ["ACCOUNT", "TEAM", "SEASON", "GAME"],
  "game.reopen": ["ACCOUNT", "TEAM", "SEASON", "GAME"],
  "game.abandon": ["ACCOUNT", "TEAM", "SEASON", "GAME"],
  "game.cancel": ["ACCOUNT", "TEAM", "SEASON", "GAME"],
  "game.archive": ["ACCOUNT", "TEAM", "SEASON", "GAME"],
  "game.verify": ["ACCOUNT", "TEAM", "SEASON", "GAME"],
  "game.reverify": ["ACCOUNT", "TEAM", "SEASON", "GAME"],
  "report.view": ["ACCOUNT", "TEAM", "SEASON", "GAME"],
  "report.export": ["ACCOUNT", "TEAM", "SEASON", "GAME"],
  "report.publish": [],
  "audit.view": ["ACCOUNT"],
  "discord.settings.view": ["ACCOUNT", "TEAM"],
  "discord.settings.configure": ["ACCOUNT", "TEAM"],
  "discord.settings.preview": ["ACCOUNT", "TEAM"],
  "discord.settings.operate": ["ACCOUNT"],
  "privacy.request": ["ACCOUNT"],
  "privacy.manage": ["ACCOUNT"],
  "ruleset.view": ["ACCOUNT"],
  "ruleset.manage": ["ACCOUNT"],
  "fantasy.league.view": ["ACCOUNT"],
  "fantasy.league.manage": ["ACCOUNT"],
  "fantasy.league.activate": ["ACCOUNT"],
  "fantasy.roster.manage": ["ACCOUNT"],
  "fantasy.scoring.calculate": ["ACCOUNT"],
  "fantasy.scoring.view": ["ACCOUNT"],
};

function scopeMatches(
  assignment: AuthorityAssignment,
  target: ResolvedTarget,
): boolean {
  if (assignment.scope === "ACCOUNT") return true;
  if (assignment.scope === "TEAM") {
    return (
      assignment.teamId !== null && target.teamIds.includes(assignment.teamId)
    );
  }
  if (assignment.scope === "SEASON") {
    return (
      assignment.seasonId !== null && assignment.seasonId === target.seasonId
    );
  }
  return assignment.gameId !== null && assignment.gameId === target.gameId;
}

export function isKnownCapability(value: string): value is Capability {
  return capabilitySet.has(value);
}

export function assignmentPermits(
  assignment: AuthorityAssignment,
  capability: Capability,
  target: ResolvedTarget,
): boolean {
  if (!scopeMatches(assignment, target)) return false;
  if (assignment.source === "ROLE") {
    return (
      assignment.role !== null &&
      roleCapabilities[assignment.role].has(capability)
    );
  }
  return (
    assignment.capability === capability &&
    exactGrantScopes[capability]?.includes(assignment.scope) === true
  );
}

export function authorityPermits(
  authority: ActiveAuthority,
  capability: Capability,
  target: ResolvedTarget,
): boolean {
  return resolveCapabilityDecision(authority, capability, target).allowed;
}

export type CapabilityDecision =
  | Readonly<{
      allowed: true;
      reason: "MATCHED_AUTHORITY";
      resolvedScope: ResolvedTarget;
      contributingAuthority: readonly AuthorityAssignment[];
    }>
  | Readonly<{
      allowed: false;
      reason: "NO_APPLICABLE_AUTHORITY";
      resolvedScope: ResolvedTarget;
      contributingAuthority: readonly [];
    }>;

export function resolveCapabilityDecision(
  authority: ActiveAuthority,
  capability: Capability,
  target: ResolvedTarget,
): CapabilityDecision {
  const contributingAuthority = authority.assignments.filter((assignment) =>
    assignmentPermits(assignment, capability, target),
  );
  return contributingAuthority.length > 0
    ? {
        allowed: true,
        reason: "MATCHED_AUTHORITY",
        resolvedScope: target,
        contributingAuthority,
      }
    : {
        allowed: false,
        reason: "NO_APPLICABLE_AUTHORITY",
        resolvedScope: target,
        contributingAuthority: [],
      };
}
