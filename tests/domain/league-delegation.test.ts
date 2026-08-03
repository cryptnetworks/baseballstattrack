import { describe, expect, it } from "vitest";

import {
  evaluateLeagueDelegation,
  type DelegationEvidence,
  type DelegationScope,
  type ResolvedDelegationTarget,
} from "@/domain/league-delegation";

const NOW = new Date("2026-08-03T12:00:00.000Z");
const ACTIVE_FROM = new Date("2026-08-01T12:00:00.000Z");

function scope(kind: DelegationScope["kind"] = "TEAM"): DelegationScope {
  return {
    kind,
    organizationId: "organization-a",
    leagueId: kind === "LEAGUE" ? "league-a" : null,
    delegationId: ["ACCOUNT", "TEAM", "SEASON", "GAME"].includes(kind)
      ? "delegation-a"
      : null,
    accountId: ["ACCOUNT", "TEAM", "SEASON", "GAME"].includes(kind)
      ? "account-a"
      : null,
    teamId: kind === "TEAM" ? "team-a" : null,
    seasonId: kind === "SEASON" ? "season-a" : null,
    gameId: kind === "GAME" ? "game-a" : null,
  };
}

function target(
  kind: ResolvedDelegationTarget["kind"] = "TEAM",
): ResolvedDelegationTarget {
  const grantScope = scope(kind);
  return {
    kind,
    organizationId: grantScope.organizationId,
    leagueId: grantScope.leagueId,
    delegationId: grantScope.delegationId,
    accountId: grantScope.accountId,
    teamIds: kind === "TEAM" ? ["team-a"] : [],
    seasonId: grantScope.seasonId,
    gameId: grantScope.gameId,
  };
}

function evidence(
  capability = "team.view",
  grantScope = scope(),
): DelegationEvidence {
  return {
    actor: { authenticated: true, appUserId: "user-a" },
    organization: { id: "organization-a", status: "ACTIVE" },
    organizationMembership: {
      id: "organization-membership-a",
      organizationId: "organization-a",
      appUserId: "user-a",
      status: "ACTIVE",
    },
    delegation: {
      id: "delegation-a",
      organizationId: "organization-a",
      accountId: "account-a",
      status: "ACTIVE",
      validFrom: ACTIVE_FROM,
      expiresAt: null,
      revokedAt: null,
      approvedByAccountMembershipId: "account-owner-membership-a",
    },
    grant: {
      id: "grant-a",
      organizationId: "organization-a",
      organizationMembershipId: "organization-membership-a",
      delegationId: grantScope.delegationId,
      accountId: grantScope.accountId,
      capability,
      scope: grantScope,
      status: "ACTIVE",
      validFrom: ACTIVE_FROM,
      expiresAt: null,
      revokedAt: null,
      approvedByAccountMembershipId:
        grantScope.accountId === null ? null : "account-owner-membership-a",
    },
    approval: null,
  };
}

function approvedEvidence(
  capability: string,
  grantScope: DelegationScope,
): DelegationEvidence {
  const base = evidence(capability, grantScope);
  return {
    ...base,
    approval: {
      id: "approval-a",
      grantId: "grant-a",
      capability,
      scope: grantScope,
      status: "APPROVED",
      validFrom: ACTIVE_FROM,
      expiresAt: null,
      revokedAt: null,
      approvedByKind:
        grantScope.accountId === null
          ? "ORGANIZATION_MEMBERSHIP"
          : "ACCOUNT_MEMBERSHIP",
      approvedById:
        grantScope.accountId === null
          ? "organization-membership-reviewer"
          : "account-owner-membership-a",
    },
  };
}

describe("league delegation authorization", () => {
  it("allows only an explicit capability in the exact delegated Account scope", () => {
    const decision = evaluateLeagueDelegation(
      evidence(),
      "team.view",
      target(),
      NOW,
    );

    expect(decision).toMatchObject({
      allowed: true,
      capability: "team.view",
      authorityReferenceIds: [
        "organization-membership-a",
        "grant-a",
        "delegation-a",
      ],
    });
  });

  it("allows fantasy scoring only through an exact Account delegation", () => {
    const accountScope = scope("ACCOUNT");
    expect(
      evaluateLeagueDelegation(
        evidence("fantasy.scoring.calculate", accountScope),
        "fantasy.scoring.calculate",
        target("ACCOUNT"),
        NOW,
      ),
    ).toMatchObject({
      allowed: true,
      capability: "fantasy.scoring.calculate",
      scope: { accountId: "account-a" },
    });
    expect(
      evaluateLeagueDelegation(
        evidence("fantasy.scoring.calculate", accountScope),
        "fantasy.scoring.calculate",
        { ...target("ACCOUNT"), accountId: "account-b" },
        NOW,
      ),
    ).toMatchObject({ allowed: false, code: "DELEGATION_MISMATCH" });
  });

  it("does not treat organization membership as Account authority", () => {
    expect(
      evaluateLeagueDelegation(
        { ...evidence(), delegation: null },
        "team.view",
        target(),
        NOW,
      ),
    ).toMatchObject({ allowed: false, code: "DELEGATION_REQUIRED" });
  });

  it("rejects sibling teams, unrelated Accounts, and unrelated organizations", () => {
    expect(
      evaluateLeagueDelegation(
        evidence(),
        "team.view",
        { ...target(), teamIds: ["team-b"] },
        NOW,
      ),
    ).toMatchObject({ allowed: false, code: "SCOPE_MISMATCH" });
    expect(
      evaluateLeagueDelegation(
        evidence(),
        "team.view",
        { ...target(), accountId: "account-b" },
        NOW,
      ),
    ).toMatchObject({ allowed: false, code: "DELEGATION_MISMATCH" });
    expect(
      evaluateLeagueDelegation(
        evidence(),
        "team.view",
        { ...target(), organizationId: "organization-b" },
        NOW,
      ),
    ).toMatchObject({ allowed: false, code: "ORGANIZATION_INACTIVE" });
  });

  it("rejects missing, forged, unknown, and mismatched grants", () => {
    expect(
      evaluateLeagueDelegation(
        { ...evidence(), grant: null },
        "team.view",
        target(),
        NOW,
      ),
    ).toMatchObject({ allowed: false, code: "GRANT_REQUIRED" });
    expect(
      evaluateLeagueDelegation(
        evidence(),
        "player.private.view",
        target(),
        NOW,
      ),
    ).toMatchObject({ allowed: false, code: "CAPABILITY_UNKNOWN" });
    expect(
      evaluateLeagueDelegation(
        {
          ...evidence(),
          grant: { ...evidence().grant!, organizationId: "organization-b" },
        },
        "team.view",
        target(),
        NOW,
      ),
    ).toMatchObject({ allowed: false, code: "GRANT_MISMATCH" });
  });

  it("fails closed for suspended, revoked, future, and expired delegation evidence", () => {
    expect(
      evaluateLeagueDelegation(
        {
          ...evidence(),
          delegation: { ...evidence().delegation!, status: "SUSPENDED" },
        },
        "team.view",
        target(),
        NOW,
      ),
    ).toMatchObject({ allowed: false, code: "DELEGATION_INACTIVE" });
    expect(
      evaluateLeagueDelegation(
        {
          ...evidence(),
          delegation: { ...evidence().delegation!, status: "REVOKED" },
        },
        "team.view",
        target(),
        NOW,
      ),
    ).toMatchObject({ allowed: false, code: "DELEGATION_REVOKED" });
    expect(
      evaluateLeagueDelegation(
        {
          ...evidence(),
          delegation: {
            ...evidence().delegation!,
            validFrom: new Date("2026-08-04T00:00:00.000Z"),
          },
        },
        "team.view",
        target(),
        NOW,
      ),
    ).toMatchObject({ allowed: false, code: "DELEGATION_INACTIVE" });
    expect(
      evaluateLeagueDelegation(
        {
          ...evidence(),
          delegation: {
            ...evidence().delegation!,
            expiresAt: new Date("2026-08-03T12:00:00.000Z"),
          },
        },
        "team.view",
        target(),
        NOW,
      ),
    ).toMatchObject({ allowed: false, code: "DELEGATION_EXPIRED" });
  });

  it("fails closed for revoked and expired grants", () => {
    expect(
      evaluateLeagueDelegation(
        {
          ...evidence(),
          grant: { ...evidence().grant!, revokedAt: NOW },
        },
        "team.view",
        target(),
        NOW,
      ),
    ).toMatchObject({ allowed: false, code: "GRANT_REVOKED" });
    expect(
      evaluateLeagueDelegation(
        {
          ...evidence(),
          grant: { ...evidence().grant!, expiresAt: NOW },
        },
        "team.view",
        target(),
        NOW,
      ),
    ).toMatchObject({ allowed: false, code: "GRANT_EXPIRED" });
  });

  it.each([
    ["ruleset.activate", "ACCOUNT"],
    ["data.import.review", "ACCOUNT"],
    ["data.import.commit", "ACCOUNT"],
    ["report.export", "ACCOUNT"],
    ["game.correct", "GAME"],
    ["game.verify", "GAME"],
  ] as const)("requires an exact approval for %s", (capability, kind) => {
    const grantScope = scope(kind);
    expect(
      evaluateLeagueDelegation(
        evidence(capability, grantScope),
        capability,
        target(kind),
        NOW,
      ),
    ).toMatchObject({ allowed: false, code: "APPROVAL_REQUIRED" });
    expect(
      evaluateLeagueDelegation(
        approvedEvidence(capability, grantScope),
        capability,
        target(kind),
        NOW,
      ),
    ).toMatchObject({ allowed: true });
  });

  it("requires independent approval for an organization ownership transfer", () => {
    const organizationScope = scope("ORGANIZATION");
    const base = approvedEvidence(
      "organization.ownership.transfer",
      organizationScope,
    );
    expect(
      evaluateLeagueDelegation(
        {
          ...base,
          delegation: null,
          approval: {
            ...base.approval!,
            approvedById: "organization-membership-a",
          },
        },
        "organization.ownership.transfer",
        target("ORGANIZATION"),
        NOW,
      ),
    ).toMatchObject({ allowed: false, code: "APPROVAL_INVALID" });
    expect(
      evaluateLeagueDelegation(
        { ...base, delegation: null },
        "organization.ownership.transfer",
        target("ORGANIZATION"),
        NOW,
      ),
    ).toMatchObject({ allowed: true });
  });

  it("rejects forged or expired restricted-action approvals", () => {
    const grantScope = scope("ACCOUNT");
    const base = approvedEvidence("data.import.commit", grantScope);
    expect(
      evaluateLeagueDelegation(
        {
          ...base,
          approval: { ...base.approval!, capability: "report.export" },
        },
        "data.import.commit",
        target("ACCOUNT"),
        NOW,
      ),
    ).toMatchObject({ allowed: false, code: "APPROVAL_INVALID" });
    expect(
      evaluateLeagueDelegation(
        {
          ...base,
          approval: { ...base.approval!, expiresAt: NOW },
        },
        "data.import.commit",
        target("ACCOUNT"),
        NOW,
      ),
    ).toMatchObject({ allowed: false, code: "APPROVAL_EXPIRED" });
  });

  it("emits minimal allow and deny audit evidence without private payloads", () => {
    const allowed = evaluateLeagueDelegation(
      evidence(),
      "team.view",
      target(),
      NOW,
    );
    const denied = evaluateLeagueDelegation(
      evidence(),
      "competition.settings.manage",
      target(),
      NOW,
    );

    expect(allowed.audit).toEqual({
      action: "delegation.authorize",
      actorId: "user-a",
      organizationId: "organization-a",
      accountId: "account-a",
      capability: "team.view",
      scopeKind: "TEAM",
      organizationMembershipId: "organization-membership-a",
      delegationId: "delegation-a",
      grantId: "grant-a",
      approvalId: null,
      evaluatedAt: "2026-08-03T12:00:00.000Z",
      result: "ALLOWED",
      reasonCode: null,
    });
    expect(denied.audit).toMatchObject({
      result: "DENIED",
      reasonCode: "GRANT_MISMATCH",
    });
    expect(JSON.stringify([allowed.audit, denied.audit])).not.toMatch(
      /player|email|contact|payload|roster|note/iu,
    );
  });

  it("rejects mixed scopes and mismatched Account approval provenance", () => {
    expect(
      evaluateLeagueDelegation(
        {
          ...evidence(),
          grant: {
            ...evidence().grant!,
            scope: { ...scope(), gameId: "smuggled-game" },
          },
        },
        "team.view",
        target(),
        NOW,
      ),
    ).toMatchObject({ allowed: false, code: "SCOPE_NOT_ALLOWED" });
    expect(
      evaluateLeagueDelegation(
        {
          ...evidence(),
          grant: {
            ...evidence().grant!,
            approvedByAccountMembershipId: "different-account-member",
          },
        },
        "team.view",
        target(),
        NOW,
      ),
    ).toMatchObject({ allowed: false, code: "DELEGATION_MISMATCH" });
  });

  it("rejects malformed targets and invalid revocation timestamps", () => {
    expect(
      evaluateLeagueDelegation(
        evidence(),
        "team.view",
        { ...target(), teamIds: [] },
        NOW,
      ),
    ).toMatchObject({ allowed: false, code: "SCOPE_NOT_ALLOWED" });
    expect(
      evaluateLeagueDelegation(
        {
          ...evidence(),
          delegation: {
            ...evidence().delegation!,
            revokedAt: new Date("invalid"),
          },
        },
        "team.view",
        target(),
        NOW,
      ),
    ).toMatchObject({ allowed: false, code: "DELEGATION_REVOKED" });
  });
});
