import { describe, expect, it } from "vitest";

import {
  INITIAL_FANTASY_FORMAT,
  createFantasyScoringModelVersion,
  evaluateFantasyEligibility,
  fantasyModelIsEditable,
  fantasyRulesCapability,
  scoreFantasyStatistics,
  transitionFantasyScoringModel,
  verifyFantasyScoringModel,
  type FantasyScoringModelInput,
  type FantasyStatisticSnapshot,
} from "@/domain/fantasy-rules";
import {
  evaluateLeagueDelegation,
  type DelegationEvidence,
  type DelegationScope,
  type ResolvedDelegationTarget,
} from "@/domain/league-delegation";

const NOW = new Date("2026-08-04T12:00:00.000Z");

function accountAuthority() {
  return {
    accountId: "account-a",
    authorityReferenceIds: ["account-membership-a", "fantasy-scope-grant-a"],
    authorizedAt: NOW.toISOString(),
  };
}

function modelInput(
  overrides: Partial<FantasyScoringModelInput> = {},
): FantasyScoringModelInput {
  return {
    modelId: "fantasy-model-family-a",
    modelVersionId: "fantasy-model-version-a-1",
    owner: { kind: "LEAGUE", id: "league-a" },
    version: 1,
    name: "Weekly points",
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
        id: "home-runs",
        domain: "BATTING",
        sourceStatistic: "batting.home_runs",
        label: "Home runs",
        milliPointsPerUnit: 4_000,
      },
      {
        id: "batting-strikeouts",
        domain: "BATTING",
        sourceStatistic: "batting.strikeouts",
        label: "Batting strikeouts",
        milliPointsPerUnit: -500,
      },
    ],
    eligibility: {
      rosterSource: "EXACT_ACCOUNT_ROSTER_AT_LOCK",
      unknownEligibility: "INELIGIBLE",
      positionRules: [
        {
          positionCode: "OUTFIELD",
          minimumAppearances: 5,
          minimumPitchingOuts: 0,
        },
        {
          positionCode: "PITCHER",
          minimumAppearances: 0,
          minimumPitchingOuts: 15,
        },
      ],
    },
    roster: {
      maximumRosterSize: 4,
      benchSlots: 2,
      lineupSlots: [
        { id: "OF", count: 1, eligiblePositionCodes: ["OUTFIELD"] },
        { id: "P", count: 1, eligiblePositionCodes: ["PITCHER"] },
      ],
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
    ...overrides,
  };
}

function activeModel() {
  const draft = createFantasyScoringModelVersion(modelInput());
  const reviewed = transitionFantasyScoringModel(draft, "REVIEWED");
  return transitionFantasyScoringModel(reviewed, "ACTIVE");
}

function snapshot(
  overrides: Partial<FantasyStatisticSnapshot> = {},
): FantasyStatisticSnapshot {
  return {
    accountId: "account-a",
    authority: accountAuthority(),
    values: {
      "batting.runs": 3,
      "batting.home_runs": 2,
      "batting.strikeouts": 4,
    },
    lineage: {
      baseballRulesetVersionIds: ["baseball-ruleset-version-a"],
      statisticDerivationVersion: 2,
      statisticRulesVersion: 1,
      sourceRevision: 9,
      correctionRevision: 1,
      fantasyStatisticRegistryVersion: "baseball-statistics:v1",
      lifecycle: "FINAL",
      verification: "VERIFIED",
    },
    ...overrides,
  };
}

function leagueScope(): DelegationScope {
  return {
    kind: "LEAGUE",
    organizationId: "organization-a",
    leagueId: "league-a",
    delegationId: null,
    accountId: null,
    teamId: null,
    seasonId: null,
    gameId: null,
  };
}

function leagueTarget(): ResolvedDelegationTarget {
  return {
    kind: "LEAGUE",
    organizationId: "organization-a",
    leagueId: "league-a",
    delegationId: null,
    accountId: null,
    teamIds: [],
    seasonId: null,
    gameId: null,
  };
}

function leagueEvidence(
  capability: "fantasy.rules.manage" | "fantasy.rules.activate",
  approved: boolean,
): DelegationEvidence {
  const scope = leagueScope();
  return {
    actor: { authenticated: true, appUserId: "user-a" },
    organization: { id: "organization-a", status: "ACTIVE" },
    organizationMembership: {
      id: "organization-membership-a",
      organizationId: "organization-a",
      appUserId: "user-a",
      status: "ACTIVE",
    },
    delegation: null,
    grant: {
      id: "grant-a",
      organizationId: "organization-a",
      organizationMembershipId: "organization-membership-a",
      delegationId: null,
      accountId: null,
      capability,
      scope,
      status: "ACTIVE",
      validFrom: new Date("2026-08-01T00:00:00.000Z"),
      expiresAt: null,
      revokedAt: null,
      approvedByAccountMembershipId: null,
    },
    approval: approved
      ? {
          id: "approval-a",
          grantId: "grant-a",
          capability,
          scope,
          status: "APPROVED",
          validFrom: new Date("2026-08-01T00:00:00.000Z"),
          expiresAt: null,
          revokedAt: null,
          approvedByKind: "ORGANIZATION_MEMBERSHIP",
          approvedById: "organization-membership-reviewer",
        }
      : null,
  };
}

describe("fantasy scoring model identity and lifecycle", () => {
  it("creates deterministic identity and digest evidence", () => {
    const first = createFantasyScoringModelVersion(modelInput());
    const second = createFantasyScoringModelVersion(modelInput());
    expect(first.contentDigest).toMatch(/^sha256:v1:[a-f0-9]{64}$/u);
    expect(second.contentDigest).toBe(first.contentDigest);
    expect(
      createFantasyScoringModelVersion(
        modelInput({ version: 2, modelVersionId: "version-2" }),
      ).contentDigest,
    ).not.toBe(first.contentDigest);
  });

  it("seals semantic content at review and preserves historical versions", () => {
    const draft = createFantasyScoringModelVersion(modelInput());
    expect(fantasyModelIsEditable(draft)).toBe(true);
    const reviewed = transitionFantasyScoringModel(draft, "REVIEWED");
    const active = transitionFantasyScoringModel(reviewed, "ACTIVE");
    const deprecated = transitionFantasyScoringModel(active, "DEPRECATED");
    const retired = transitionFantasyScoringModel(deprecated, "RETIRED");
    expect(fantasyModelIsEditable(active)).toBe(false);
    expect(retired.contentDigest).toBe(draft.contentDigest);
    expect(() => transitionFantasyScoringModel(retired, "ACTIVE")).toThrowError(
      expect.objectContaining({ code: "INVALID_TRANSITION" }),
    );
  });

  it("rejects semantic tampering and malformed category/roster definitions", () => {
    const model = activeModel();
    expect(() =>
      verifyFantasyScoringModel({
        ...model,
        categories: [{ ...model.categories[0]!, milliPointsPerUnit: 99_000 }],
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_DIGEST" }));
    expect(() =>
      createFantasyScoringModelVersion(
        modelInput({ categories: [], lifecycle: "DRAFT" }),
      ),
    ).toThrowError(expect.objectContaining({ code: "INVALID_MODEL" }));
    expect(() =>
      createFantasyScoringModelVersion(
        modelInput({
          format: "DAILY_UNVERSIONED" as typeof INITIAL_FANTASY_FORMAT,
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: "INVALID_MODEL" }));
    expect(() =>
      createFantasyScoringModelVersion(modelInput({ lifecycle: "ACTIVE" })),
    ).toThrowError(expect.objectContaining({ code: "INVALID_TRANSITION" }));
  });

  it("binds ownership into the digest without accepting names as identity", () => {
    const league = createFantasyScoringModelVersion(modelInput());
    const organization = createFantasyScoringModelVersion(
      modelInput({ owner: { kind: "ORGANIZATION", id: "organization-a" } }),
    );
    expect(organization.contentDigest).not.toBe(league.contentDigest);
    expect(league.owner).toEqual({ kind: "LEAGUE", id: "league-a" });
  });
});

describe("fantasy scoring boundary", () => {
  it("calculates deterministic integer points from statistics only", () => {
    const source = snapshot();
    const score = scoreFantasyStatistics(activeModel(), source);
    expect(score.totalMilliPoints).toBe(9_000);
    expect(score.categories).toEqual([
      {
        categoryId: "runs",
        sourceStatistic: "batting.runs",
        units: 3,
        milliPoints: 3_000,
      },
      {
        categoryId: "home-runs",
        sourceStatistic: "batting.home_runs",
        units: 2,
        milliPoints: 8_000,
      },
      {
        categoryId: "batting-strikeouts",
        sourceStatistic: "batting.strikeouts",
        units: 4,
        milliPoints: -2_000,
      },
    ]);
    expect(score.lineage).toMatchObject({
      fantasyModelVersion: 1,
      baseballRulesetVersionIds: ["baseball-ruleset-version-a"],
      sourceRevision: 9,
      correctionRevision: 1,
    });
    expect(source).toEqual(snapshot());
    expect(score).not.toHaveProperty("events");
    expect(score).not.toHaveProperty("baseballOutcome");
  });

  it("supports registered extension statistics without changing the engine", () => {
    const customDraft = createFantasyScoringModelVersion(
      modelInput({
        modelVersionId: "custom-version",
        statisticRegistryVersion: "organization-registry:v3",
        categories: [
          {
            id: "quality-start",
            domain: "CUSTOM",
            sourceStatistic: "organization.quality_start",
            label: "Quality start",
            milliPointsPerUnit: 3_000,
          },
        ],
      }),
    );
    const custom = transitionFantasyScoringModel(
      transitionFantasyScoringModel(customDraft, "REVIEWED"),
      "ACTIVE",
    );
    expect(
      scoreFantasyStatistics(custom, {
        ...snapshot(),
        values: { "organization.quality_start": 1 },
        lineage: {
          ...snapshot().lineage,
          fantasyStatisticRegistryVersion: "organization-registry:v3",
        },
      }).totalMilliPoints,
    ).toBe(3_000);
  });

  it("fails closed for drafts, unverified data, registry drift, and missing stats", () => {
    const model = activeModel();
    expect(() =>
      scoreFantasyStatistics(
        createFantasyScoringModelVersion(modelInput()),
        snapshot(),
      ),
    ).toThrowError(expect.objectContaining({ code: "MODEL_NOT_SCORABLE" }));
    expect(() =>
      scoreFantasyStatistics(model, {
        ...snapshot(),
        lineage: { ...snapshot().lineage, verification: "UNVERIFIED" },
      }),
    ).toThrowError(expect.objectContaining({ code: "UNVERIFIED_STATISTICS" }));
    expect(() =>
      scoreFantasyStatistics(model, {
        ...snapshot(),
        lineage: {
          ...snapshot().lineage,
          fantasyStatisticRegistryVersion: "latest",
        },
      }),
    ).toThrowError(
      expect.objectContaining({ code: "STATISTIC_REGISTRY_MISMATCH" }),
    );
    expect(() =>
      scoreFantasyStatistics(model, { ...snapshot(), values: {} }),
    ).toThrowError(expect.objectContaining({ code: "STATISTIC_UNAVAILABLE" }));
  });

  it("requires Account authorization and complete versioned lineage", () => {
    const model = activeModel();
    expect(() =>
      scoreFantasyStatistics(model, {
        ...snapshot(),
        authority: { ...accountAuthority(), authorityReferenceIds: [] },
      }),
    ).toThrowError(expect.objectContaining({ code: "ACCOUNT_NOT_AUTHORIZED" }));
    expect(() =>
      scoreFantasyStatistics(model, {
        ...snapshot(),
        lineage: { ...snapshot().lineage, baseballRulesetVersionIds: [] },
      }),
    ).toThrowError(expect.objectContaining({ code: "STATISTIC_INVALID" }));
  });
});

describe("fantasy eligibility rules", () => {
  it("requires Account authorization, roster state at lock, and a known slot", () => {
    const model = activeModel();
    const facts = {
      accountId: "account-a",
      rosterAccountId: "account-a",
      authority: accountAuthority(),
      rosteredAtLock: true,
      requestedSlotId: "OF",
      verifiedPositionAppearances: { OUTFIELD: 5 },
      pitchingOuts: 0,
    };
    expect(evaluateFantasyEligibility(model, facts)).toMatchObject({
      eligible: true,
      qualifyingPositions: ["OUTFIELD"],
    });
    expect(
      evaluateFantasyEligibility(model, {
        ...facts,
        authority: { ...accountAuthority(), authorityReferenceIds: [] },
      }),
    ).toEqual({ eligible: false, code: "ACCOUNT_NOT_AUTHORIZED" });
    expect(
      evaluateFantasyEligibility(model, {
        ...facts,
        rosterAccountId: "account-b",
      }),
    ).toEqual({ eligible: false, code: "ACCOUNT_NOT_AUTHORIZED" });
    expect(
      evaluateFantasyEligibility(model, {
        ...facts,
        authority: { ...accountAuthority(), authorizedAt: "not-an-instant" },
      }),
    ).toEqual({ eligible: false, code: "ACCOUNT_NOT_AUTHORIZED" });
    expect(
      evaluateFantasyEligibility(model, { ...facts, rosteredAtLock: false }),
    ).toEqual({ eligible: false, code: "NOT_ROSTERED_AT_LOCK" });
    expect(
      evaluateFantasyEligibility(model, {
        ...facts,
        requestedSlotId: "UNKNOWN",
      }),
    ).toEqual({ eligible: false, code: "LINEUP_SLOT_UNKNOWN" });
  });

  it("enforces minimum position appearances and pitching outs", () => {
    const model = activeModel();
    expect(
      evaluateFantasyEligibility(model, {
        accountId: "account-a",
        rosterAccountId: "account-a",
        authority: accountAuthority(),
        rosteredAtLock: true,
        requestedSlotId: "OF",
        verifiedPositionAppearances: { OUTFIELD: 4 },
        pitchingOuts: 0,
      }),
    ).toEqual({ eligible: false, code: "POSITION_INELIGIBLE" });
    expect(
      evaluateFantasyEligibility(model, {
        accountId: "account-a",
        rosterAccountId: "account-a",
        authority: accountAuthority(),
        rosteredAtLock: true,
        requestedSlotId: "P",
        verifiedPositionAppearances: { PITCHER: 1 },
        pitchingOuts: 14,
      }),
    ).toEqual({ eligible: false, code: "POSITION_INELIGIBLE" });
  });

  it("uses baseball participation evidence without private traits", () => {
    const facts = {
      accountId: "account-a",
      rosterAccountId: "account-a",
      authority: accountAuthority(),
      rosteredAtLock: true,
      requestedSlotId: "P",
      verifiedPositionAppearances: { PITCHER: 1 },
      pitchingOuts: 15,
    };
    expect(evaluateFantasyEligibility(activeModel(), facts)).toMatchObject({
      eligible: true,
      qualifyingPositions: ["PITCHER"],
    });
    expect(Object.keys(facts)).not.toEqual(
      expect.arrayContaining(["age", "medical", "birthDate"]),
    );
  });
});

describe("fantasy rules ownership and delegation", () => {
  it("separates draft management from activation approval", () => {
    expect(fantasyRulesCapability("EDIT_DRAFT")).toBe("fantasy.rules.manage");
    expect(fantasyRulesCapability("ACTIVATE")).toBe("fantasy.rules.activate");
    expect(
      evaluateLeagueDelegation(
        leagueEvidence("fantasy.rules.manage", false),
        "fantasy.rules.manage",
        leagueTarget(),
        NOW,
      ),
    ).toMatchObject({ allowed: true });
    expect(
      evaluateLeagueDelegation(
        leagueEvidence("fantasy.rules.activate", false),
        "fantasy.rules.activate",
        leagueTarget(),
        NOW,
      ),
    ).toMatchObject({ allowed: false, code: "APPROVAL_REQUIRED" });
    expect(
      evaluateLeagueDelegation(
        leagueEvidence("fantasy.rules.activate", true),
        "fantasy.rules.activate",
        leagueTarget(),
        NOW,
      ),
    ).toMatchObject({ allowed: true });
  });

  it("denies a sibling league even with a valid organization membership", () => {
    expect(
      evaluateLeagueDelegation(
        leagueEvidence("fantasy.rules.manage", false),
        "fantasy.rules.manage",
        { ...leagueTarget(), leagueId: "league-b" },
        NOW,
      ),
    ).toMatchObject({ allowed: false, code: "SCOPE_MISMATCH" });
  });
});
