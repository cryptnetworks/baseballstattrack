export const delegatedCapabilities = [
  "organization.view",
  "organization.members.manage",
  "organization.ownership.transfer",
  "organization.rulesets.manage",
  "organization.settings.manage",
  "league.settings.manage",
  "fantasy.rules.manage",
  "fantasy.rules.activate",
  "team.view",
  "competition.settings.manage",
  "shared_resources.manage",
  "report.minimum_field.view",
  "ruleset.activate",
  "data.import.review",
  "data.import.commit",
  "report.export",
  "game.correct",
  "game.verify",
] as const;

export type DelegatedCapability = (typeof delegatedCapabilities)[number];
export type DelegationScopeKind =
  "ORGANIZATION" | "LEAGUE" | "ACCOUNT" | "TEAM" | "SEASON" | "GAME";

export type DelegationScope = Readonly<{
  kind: DelegationScopeKind;
  organizationId: string;
  leagueId: string | null;
  delegationId: string | null;
  accountId: string | null;
  teamId: string | null;
  seasonId: string | null;
  gameId: string | null;
}>;

export type ResolvedDelegationTarget = Readonly<{
  kind: DelegationScopeKind;
  organizationId: string;
  leagueId: string | null;
  delegationId: string | null;
  accountId: string | null;
  teamIds: readonly string[];
  seasonId: string | null;
  gameId: string | null;
}>;

export type DelegationEvidence = Readonly<{
  actor: Readonly<{
    authenticated: boolean;
    appUserId: string;
  }>;
  organization: Readonly<{
    id: string;
    status: "ACTIVE" | "SUSPENDED" | "ARCHIVED";
  }>;
  organizationMembership: Readonly<{
    id: string;
    organizationId: string;
    appUserId: string;
    status: "ACTIVE" | "SUSPENDED" | "REMOVED";
  }>;
  delegation: Readonly<{
    id: string;
    organizationId: string;
    accountId: string;
    status: "ACTIVE" | "SUSPENDED" | "REVOKED";
    validFrom: Date;
    expiresAt: Date | null;
    revokedAt: Date | null;
    approvedByAccountMembershipId: string;
  }> | null;
  grant: Readonly<{
    id: string;
    organizationId: string;
    organizationMembershipId: string;
    delegationId: string | null;
    accountId: string | null;
    capability: string;
    scope: DelegationScope;
    status: "ACTIVE" | "SUSPENDED" | "REVOKED";
    validFrom: Date;
    expiresAt: Date | null;
    revokedAt: Date | null;
    approvedByAccountMembershipId: string | null;
  }> | null;
  approval: Readonly<{
    id: string;
    grantId: string;
    capability: string;
    scope: DelegationScope;
    status: "APPROVED" | "REVOKED";
    validFrom: Date;
    expiresAt: Date | null;
    revokedAt: Date | null;
    approvedByKind: "ACCOUNT_MEMBERSHIP" | "ORGANIZATION_MEMBERSHIP";
    approvedById: string;
  }> | null;
}>;

export type DelegationDenialCode =
  | "AUTHENTICATION_REQUIRED"
  | "ORGANIZATION_INACTIVE"
  | "ORGANIZATION_MEMBERSHIP_INACTIVE"
  | "CAPABILITY_UNKNOWN"
  | "GRANT_REQUIRED"
  | "GRANT_MISMATCH"
  | "GRANT_REVOKED"
  | "GRANT_INACTIVE"
  | "GRANT_EXPIRED"
  | "DELEGATION_REQUIRED"
  | "DELEGATION_MISMATCH"
  | "DELEGATION_REVOKED"
  | "DELEGATION_INACTIVE"
  | "DELEGATION_EXPIRED"
  | "SCOPE_NOT_ALLOWED"
  | "SCOPE_MISMATCH"
  | "APPROVAL_REQUIRED"
  | "APPROVAL_INVALID"
  | "APPROVAL_EXPIRED";

export type DelegationAuditEvidence = Readonly<{
  action: "delegation.authorize";
  actorId: string;
  organizationId: string;
  accountId: string | null;
  capability: string;
  scopeKind: DelegationScopeKind;
  organizationMembershipId: string;
  delegationId: string | null;
  grantId: string | null;
  approvalId: string | null;
  evaluatedAt: string | null;
  result: "ALLOWED" | "DENIED";
  reasonCode: DelegationDenialCode | null;
}>;

export type DelegationDecision =
  | Readonly<{
      allowed: true;
      capability: DelegatedCapability;
      scope: ResolvedDelegationTarget;
      authorityReferenceIds: readonly string[];
      audit: DelegationAuditEvidence;
    }>
  | Readonly<{
      allowed: false;
      code: DelegationDenialCode;
      authorityReferenceIds: readonly [];
      audit: DelegationAuditEvidence;
    }>;

type CapabilityPolicy = Readonly<{
  scopes: readonly DelegationScopeKind[];
  accountDelegated: boolean;
  approvalRequired: boolean;
}>;

const capabilityPolicies: Readonly<
  Record<DelegatedCapability, CapabilityPolicy>
> = {
  "organization.view": {
    scopes: ["ORGANIZATION"],
    accountDelegated: false,
    approvalRequired: false,
  },
  "organization.members.manage": {
    scopes: ["ORGANIZATION"],
    accountDelegated: false,
    approvalRequired: false,
  },
  "organization.ownership.transfer": {
    scopes: ["ORGANIZATION"],
    accountDelegated: false,
    approvalRequired: true,
  },
  "organization.rulesets.manage": {
    scopes: ["ORGANIZATION", "LEAGUE"],
    accountDelegated: false,
    approvalRequired: true,
  },
  "organization.settings.manage": {
    scopes: ["ORGANIZATION"],
    accountDelegated: false,
    approvalRequired: false,
  },
  "league.settings.manage": {
    scopes: ["LEAGUE"],
    accountDelegated: false,
    approvalRequired: false,
  },
  "fantasy.rules.manage": {
    scopes: ["ORGANIZATION", "LEAGUE"],
    accountDelegated: false,
    approvalRequired: false,
  },
  "fantasy.rules.activate": {
    scopes: ["ORGANIZATION", "LEAGUE"],
    accountDelegated: false,
    approvalRequired: true,
  },
  "team.view": {
    scopes: ["TEAM"],
    accountDelegated: true,
    approvalRequired: false,
  },
  "competition.settings.manage": {
    scopes: ["TEAM", "SEASON"],
    accountDelegated: true,
    approvalRequired: false,
  },
  "shared_resources.manage": {
    scopes: ["TEAM", "SEASON"],
    accountDelegated: true,
    approvalRequired: false,
  },
  "report.minimum_field.view": {
    scopes: ["TEAM", "SEASON", "GAME"],
    accountDelegated: true,
    approvalRequired: false,
  },
  "ruleset.activate": {
    scopes: ["ACCOUNT", "TEAM", "SEASON"],
    accountDelegated: true,
    approvalRequired: true,
  },
  "data.import.review": {
    scopes: ["ACCOUNT"],
    accountDelegated: true,
    approvalRequired: true,
  },
  "data.import.commit": {
    scopes: ["ACCOUNT"],
    accountDelegated: true,
    approvalRequired: true,
  },
  "report.export": {
    scopes: ["ACCOUNT", "TEAM", "SEASON", "GAME"],
    accountDelegated: true,
    approvalRequired: true,
  },
  "game.correct": {
    scopes: ["GAME"],
    accountDelegated: true,
    approvalRequired: true,
  },
  "game.verify": {
    scopes: ["GAME"],
    accountDelegated: true,
    approvalRequired: true,
  },
};

const delegatedCapabilitySet = new Set<string>(delegatedCapabilities);

export function isDelegatedCapability(
  value: string,
): value is DelegatedCapability {
  return delegatedCapabilitySet.has(value);
}

function finiteTime(value: Date): number | null {
  const time = value.getTime();
  return Number.isFinite(time) ? time : null;
}

function revoked(
  status: "ACTIVE" | "SUSPENDED" | "REVOKED",
  revokedAt: Date | null,
  now: number,
): boolean {
  const revokedTime = revokedAt ? finiteTime(revokedAt) : null;
  return (
    status === "REVOKED" ||
    (revokedAt !== null && (revokedTime === null || revokedTime <= now))
  );
}

function activeWindow(
  validFrom: Date,
  expiresAt: Date | null,
  now: number,
): "ACTIVE" | "NOT_ACTIVE" | "EXPIRED" {
  const start = finiteTime(validFrom);
  const end = expiresAt ? finiteTime(expiresAt) : null;
  if (start === null || start > now) return "NOT_ACTIVE";
  if (expiresAt && (end === null || end <= now)) return "EXPIRED";
  return "ACTIVE";
}

function scopeIdentity(scope: DelegationScope): string {
  return [
    scope.kind,
    scope.organizationId,
    scope.leagueId,
    scope.delegationId,
    scope.accountId,
    scope.teamId,
    scope.seasonId,
    scope.gameId,
  ].join(":");
}

function present(value: string | null): boolean {
  return value !== null && value.length > 0;
}

function scopeIsWellFormed(scope: DelegationScope): boolean {
  if (scope.organizationId.length === 0) return false;
  if (scope.kind === "ORGANIZATION") {
    return (
      scope.leagueId === null &&
      scope.delegationId === null &&
      scope.accountId === null &&
      scope.teamId === null &&
      scope.seasonId === null &&
      scope.gameId === null
    );
  }
  if (scope.kind === "LEAGUE") {
    return (
      present(scope.leagueId) &&
      scope.delegationId === null &&
      scope.accountId === null &&
      scope.teamId === null &&
      scope.seasonId === null &&
      scope.gameId === null
    );
  }
  if (!present(scope.delegationId) || !present(scope.accountId)) return false;
  if (scope.leagueId !== null) return false;
  if (scope.kind === "ACCOUNT") {
    return (
      scope.teamId === null && scope.seasonId === null && scope.gameId === null
    );
  }
  if (scope.kind === "TEAM") {
    return (
      present(scope.teamId) && scope.seasonId === null && scope.gameId === null
    );
  }
  if (scope.kind === "SEASON") {
    return (
      scope.teamId === null && present(scope.seasonId) && scope.gameId === null
    );
  }
  return (
    scope.teamId === null && scope.seasonId === null && present(scope.gameId)
  );
}

function targetIsWellFormed(target: ResolvedDelegationTarget): boolean {
  if (target.organizationId.length === 0) return false;
  if (target.kind === "ORGANIZATION") {
    return (
      target.leagueId === null &&
      target.delegationId === null &&
      target.accountId === null &&
      target.teamIds.length === 0 &&
      target.seasonId === null &&
      target.gameId === null
    );
  }
  if (target.kind === "LEAGUE") {
    return (
      present(target.leagueId) &&
      target.delegationId === null &&
      target.accountId === null &&
      target.teamIds.length === 0 &&
      target.seasonId === null &&
      target.gameId === null
    );
  }
  if (!present(target.delegationId) || !present(target.accountId)) return false;
  if (target.leagueId !== null) return false;
  if (target.kind === "ACCOUNT") {
    return (
      target.teamIds.length === 0 &&
      target.seasonId === null &&
      target.gameId === null
    );
  }
  if (target.kind === "TEAM") {
    return (
      target.teamIds.length > 0 &&
      target.seasonId === null &&
      target.gameId === null
    );
  }
  if (target.kind === "SEASON") {
    return present(target.seasonId) && target.gameId === null;
  }
  return present(target.gameId);
}

function scopeMatches(
  scope: DelegationScope,
  target: ResolvedDelegationTarget,
): boolean {
  if (scope.organizationId !== target.organizationId) return false;
  if (scope.kind === "ORGANIZATION") {
    return target.kind === "ORGANIZATION";
  }
  if (scope.kind === "LEAGUE") {
    return target.kind === "LEAGUE" && scope.leagueId === target.leagueId;
  }
  if (
    scope.delegationId === null ||
    scope.delegationId !== target.delegationId ||
    scope.accountId === null ||
    scope.accountId !== target.accountId
  ) {
    return false;
  }
  if (scope.kind === "ACCOUNT") return target.accountId !== null;
  if (scope.kind === "TEAM") {
    return scope.teamId !== null && target.teamIds.includes(scope.teamId);
  }
  if (scope.kind === "SEASON") {
    return scope.seasonId !== null && scope.seasonId === target.seasonId;
  }
  return scope.gameId !== null && scope.gameId === target.gameId;
}

function audit(
  evidence: DelegationEvidence,
  capability: string,
  target: ResolvedDelegationTarget,
  result: "ALLOWED" | "DENIED",
  reasonCode: DelegationDenialCode | null,
  now: Date,
): DelegationAuditEvidence {
  const evaluatedTime = finiteTime(now);
  const policy = isDelegatedCapability(capability)
    ? capabilityPolicies[capability]
    : null;
  return {
    action: "delegation.authorize",
    actorId: evidence.actor.appUserId,
    organizationId: target.organizationId,
    accountId: target.accountId,
    capability,
    scopeKind: target.kind,
    organizationMembershipId: evidence.organizationMembership.id,
    delegationId: policy?.accountDelegated
      ? (evidence.delegation?.id ?? null)
      : null,
    grantId: evidence.grant?.id ?? null,
    approvalId: policy?.approvalRequired
      ? (evidence.approval?.id ?? null)
      : null,
    evaluatedAt:
      evaluatedTime === null ? null : new Date(evaluatedTime).toISOString(),
    result,
    reasonCode,
  };
}

function denied(
  evidence: DelegationEvidence,
  capability: string,
  target: ResolvedDelegationTarget,
  code: DelegationDenialCode,
  now: Date,
): DelegationDecision {
  return {
    allowed: false,
    code,
    authorityReferenceIds: [],
    audit: audit(evidence, capability, target, "DENIED", code, now),
  };
}

export function evaluateLeagueDelegation(
  evidence: DelegationEvidence,
  capability: string,
  target: ResolvedDelegationTarget,
  now = new Date(),
): DelegationDecision {
  const currentTime = finiteTime(now);
  if (
    !evidence.actor.authenticated ||
    evidence.actor.appUserId.length === 0 ||
    currentTime === null
  ) {
    return denied(evidence, capability, target, "AUTHENTICATION_REQUIRED", now);
  }
  if (
    evidence.organization.status !== "ACTIVE" ||
    evidence.organization.id !== target.organizationId
  ) {
    return denied(evidence, capability, target, "ORGANIZATION_INACTIVE", now);
  }
  const membership = evidence.organizationMembership;
  if (
    membership.id.length === 0 ||
    membership.status !== "ACTIVE" ||
    membership.organizationId !== evidence.organization.id ||
    membership.appUserId !== evidence.actor.appUserId
  ) {
    return denied(
      evidence,
      capability,
      target,
      "ORGANIZATION_MEMBERSHIP_INACTIVE",
      now,
    );
  }
  if (!isDelegatedCapability(capability)) {
    return denied(evidence, capability, target, "CAPABILITY_UNKNOWN", now);
  }
  const policy = capabilityPolicies[capability];
  const grant = evidence.grant;
  if (!grant) {
    return denied(evidence, capability, target, "GRANT_REQUIRED", now);
  }
  if (
    grant.id.length === 0 ||
    grant.organizationId !== evidence.organization.id ||
    grant.organizationMembershipId !== membership.id ||
    grant.capability !== capability
  ) {
    return denied(evidence, capability, target, "GRANT_MISMATCH", now);
  }
  if (revoked(grant.status, grant.revokedAt, currentTime)) {
    return denied(evidence, capability, target, "GRANT_REVOKED", now);
  }
  if (grant.status !== "ACTIVE") {
    return denied(evidence, capability, target, "GRANT_INACTIVE", now);
  }
  const grantWindow = activeWindow(
    grant.validFrom,
    grant.expiresAt,
    currentTime,
  );
  if (grantWindow === "NOT_ACTIVE") {
    return denied(evidence, capability, target, "GRANT_INACTIVE", now);
  }
  if (grantWindow === "EXPIRED") {
    return denied(evidence, capability, target, "GRANT_EXPIRED", now);
  }
  if (
    !targetIsWellFormed(target) ||
    !scopeIsWellFormed(grant.scope) ||
    !policy.scopes.includes(grant.scope.kind)
  ) {
    return denied(evidence, capability, target, "SCOPE_NOT_ALLOWED", now);
  }

  if (policy.accountDelegated) {
    const delegation = evidence.delegation;
    if (!delegation) {
      return denied(evidence, capability, target, "DELEGATION_REQUIRED", now);
    }
    if (
      delegation.id.length === 0 ||
      delegation.organizationId !== evidence.organization.id ||
      delegation.id !== grant.delegationId ||
      delegation.id !== target.delegationId ||
      delegation.accountId !== grant.accountId ||
      delegation.accountId !== target.accountId ||
      delegation.approvedByAccountMembershipId.length === 0 ||
      grant.approvedByAccountMembershipId === null ||
      grant.approvedByAccountMembershipId.length === 0 ||
      grant.approvedByAccountMembershipId !==
        delegation.approvedByAccountMembershipId
    ) {
      return denied(evidence, capability, target, "DELEGATION_MISMATCH", now);
    }
    if (revoked(delegation.status, delegation.revokedAt, currentTime)) {
      return denied(evidence, capability, target, "DELEGATION_REVOKED", now);
    }
    if (delegation.status !== "ACTIVE") {
      return denied(evidence, capability, target, "DELEGATION_INACTIVE", now);
    }
    const delegationWindow = activeWindow(
      delegation.validFrom,
      delegation.expiresAt,
      currentTime,
    );
    if (delegationWindow === "NOT_ACTIVE") {
      return denied(evidence, capability, target, "DELEGATION_INACTIVE", now);
    }
    if (delegationWindow === "EXPIRED") {
      return denied(evidence, capability, target, "DELEGATION_EXPIRED", now);
    }
  } else if (
    grant.delegationId !== null ||
    grant.accountId !== null ||
    target.accountId !== null
  ) {
    return denied(evidence, capability, target, "SCOPE_MISMATCH", now);
  }

  if (!scopeMatches(grant.scope, target)) {
    return denied(evidence, capability, target, "SCOPE_MISMATCH", now);
  }

  if (policy.approvalRequired) {
    const approval = evidence.approval;
    if (!approval) {
      return denied(evidence, capability, target, "APPROVAL_REQUIRED", now);
    }
    const requiredApproverKind = policy.accountDelegated
      ? "ACCOUNT_MEMBERSHIP"
      : "ORGANIZATION_MEMBERSHIP";
    if (
      approval.id.length === 0 ||
      approval.status !== "APPROVED" ||
      approval.grantId !== grant.id ||
      approval.capability !== capability ||
      approval.approvedByKind !== requiredApproverKind ||
      approval.approvedById.length === 0 ||
      (policy.accountDelegated &&
        approval.approvedById !== grant.approvedByAccountMembershipId) ||
      (capability === "organization.ownership.transfer" &&
        approval.approvedById === membership.id) ||
      scopeIdentity(approval.scope) !== scopeIdentity(grant.scope) ||
      (approval.revokedAt !== null &&
        (finiteTime(approval.revokedAt) === null ||
          finiteTime(approval.revokedAt)! <= currentTime))
    ) {
      return denied(evidence, capability, target, "APPROVAL_INVALID", now);
    }
    const approvalWindow = activeWindow(
      approval.validFrom,
      approval.expiresAt,
      currentTime,
    );
    if (approvalWindow !== "ACTIVE") {
      return denied(evidence, capability, target, "APPROVAL_EXPIRED", now);
    }
  }

  const authorityReferenceIds = [membership.id, grant.id];
  if (policy.accountDelegated && evidence.delegation) {
    authorityReferenceIds.push(evidence.delegation.id);
  }
  if (policy.approvalRequired && evidence.approval) {
    authorityReferenceIds.push(evidence.approval.id);
  }
  return {
    allowed: true,
    capability,
    scope: target,
    authorityReferenceIds,
    audit: audit(evidence, capability, target, "ALLOWED", null, now),
  };
}
