import { describe, expect, it } from "vitest";

import {
  createFantasyLeague,
  createFantasyPlayerEntry,
  createFantasyRosterSnapshot,
  createFantasyTeam,
  fantasyAuthorityFromDelegation,
  transitionFantasyLeague,
  transitionFantasyTeam,
  type FantasyDomainAuthority,
  type FantasyDomainCapability,
  type FantasyLeague,
  type FantasyRosterSnapshot,
  type FantasyTeam,
} from "@/domain/fantasy-domain";
import {
  INITIAL_FANTASY_FORMAT,
  createFantasyScoringModelVersion,
  transitionFantasyScoringModel,
  type FantasyScoringModelInput,
  type FantasyScoringModelVersion,
} from "@/domain/fantasy-rules";
import {
  evaluateLeagueDelegation,
  type DelegationEvidence,
  type DelegationScope,
  type ResolvedDelegationTarget,
} from "@/domain/league-delegation";

const CREATED = "2026-08-04T12:00:00.000Z";
const ACTIVATED = "2026-08-05T12:00:00.000Z";

function modelInput(
  overrides: Partial<FantasyScoringModelInput> = {},
): FantasyScoringModelInput {
  return {
    modelId: "fantasy-model-a",
    modelVersionId: "fantasy-model-a-v1",
    owner: { kind: "ACCOUNT", id: "account-a" },
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

function reviewedModel() {
  return transitionFantasyScoringModel(
    createFantasyScoringModelVersion(modelInput()),
    "REVIEWED",
  );
}

function activeModel() {
  return transitionFantasyScoringModel(reviewedModel(), "ACTIVE");
}

function authority(
  capability: FantasyDomainCapability,
  scope: FantasyDomainAuthority["scope"] = { kind: "ACCOUNT" },
  accountId = "account-a",
): FantasyDomainAuthority {
  return {
    accountId,
    actorId: "user-a",
    source: "ACCOUNT_PERMISSION",
    capability,
    scope,
    authorityReferenceIds:
      capability === "fantasy.league.activate"
        ? ["account-membership-a", "activation-approval-a"]
        : ["account-membership-a"],
    authorizedAt: CREATED,
  };
}

function leagueInput(id = "fantasy-league-a", accountId = "account-a") {
  return {
    id,
    accountId,
    administrativeScope: null,
    seasonId: "season-2026",
    name: "Summer fantasy league",
    visibility: "PRIVATE" as const,
    createdAt: CREATED,
  };
}

function draftLeague(model = reviewedModel()) {
  return createFantasyLeague(
    leagueInput(),
    model,
    authority("fantasy.league.manage"),
  );
}

function activeLeague(model = activeModel()) {
  return transitionFantasyLeague(
    createFantasyLeague(
      leagueInput(),
      model,
      authority("fantasy.league.manage"),
    ),
    "ACTIVE",
    ACTIVATED,
    authority("fantasy.league.activate", {
      kind: "FANTASY_LEAGUE",
      fantasyLeagueId: "fantasy-league-a",
    }),
    model,
  );
}

function teamInput(id = "fantasy-team-a") {
  return {
    id,
    accountId: "account-a",
    fantasyLeagueId: "fantasy-league-a",
    ownerAccountMembershipId: "account-membership-manager-a",
    name: "The Operators",
    createdAt: ACTIVATED,
  };
}

function activeTeam(league: FantasyLeague) {
  const team = createFantasyTeam(
    teamInput(),
    league,
    authority("fantasy.team.manage", {
      kind: "FANTASY_LEAGUE",
      fantasyLeagueId: league.id,
    }),
  );
  return transitionFantasyTeam(
    team,
    league,
    "ACTIVE",
    "2026-08-06T12:00:00.000Z",
    authority("fantasy.team.manage", {
      kind: "FANTASY_TEAM",
      fantasyLeagueId: league.id,
      fantasyTeamId: team.id,
    }),
  );
}

function playerInput(
  model: FantasyScoringModelVersion,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: "fantasy-player-entry-a",
    accountId: "account-a",
    fantasyLeagueId: "fantasy-league-a",
    baseballPlayerId: "baseball-player-stable-a",
    eligibility: {
      fantasyModelVersionId: model.modelVersionId,
      fantasyModelDigest: model.contentDigest,
      eligiblePositionCodes: ["OUTFIELD"],
      sourceRosterRevision: 4,
      sourceStatisticsRevision: 9,
      verification: "VERIFIED" as const,
      evaluatedAt: "2026-08-06T12:00:00.000Z",
    },
    ownership: {
      state: "ROSTERED" as const,
      fantasyTeamId: "fantasy-team-a",
      revision: 1,
      effectiveAt: "2026-08-06T12:00:00.000Z",
    },
    createdAt: "2026-08-06T12:00:00.000Z",
    ...overrides,
  };
}

function rosterInput(
  overrides: Partial<{
    id: string;
    revision: number;
    previousSnapshotId: string | null;
    effectiveAt: string;
  }> = {},
) {
  return {
    id: "roster-snapshot-a-0",
    accountId: "account-a",
    fantasyLeagueId: "fantasy-league-a",
    fantasyTeamId: "fantasy-team-a",
    revision: 0,
    previousSnapshotId: null,
    effectiveAt: "2026-08-07T12:00:00.000Z",
    slots: [
      {
        id: "active-of",
        kind: "ACTIVE" as const,
        lineupSlotRuleId: "OF",
        playerEntryId: "fantasy-player-entry-a",
      },
      {
        id: "bench-1",
        kind: "BENCH" as const,
        lineupSlotRuleId: null,
        playerEntryId: null,
      },
    ],
    ...overrides,
  };
}

function rosterAuthority(team: FantasyTeam) {
  return authority("fantasy.roster.manage", {
    kind: "FANTASY_TEAM",
    fantasyLeagueId: team.fantasyLeagueId,
    fantasyTeamId: team.id,
  });
}

describe("fantasy league and team ownership", () => {
  it("creates explicit Account ownership and seals exact fantasy rules lineage", () => {
    const model = reviewedModel();
    const league = draftLeague(model);

    expect(league).toMatchObject({
      id: "fantasy-league-a",
      accountId: "account-a",
      owner: { kind: "ACCOUNT", accountId: "account-a" },
      seasonId: "season-2026",
      lifecycle: "DRAFT",
      visibility: "PRIVATE",
      rules: {
        modelVersionId: model.modelVersionId,
        modelDigest: model.contentDigest,
      },
    });
    expect(Object.isFrozen(league)).toBe(true);
  });

  it("requires the exact Account and explicit activation capability", () => {
    const model = activeModel();
    const draft = createFantasyLeague(
      leagueInput(),
      model,
      authority("fantasy.league.manage"),
    );

    expect(() =>
      transitionFantasyLeague(
        draft,
        "ACTIVE",
        ACTIVATED,
        authority("fantasy.league.manage"),
        model,
      ),
    ).toThrowError(expect.objectContaining({ code: "AUTHORIZATION_REQUIRED" }));
    expect(() =>
      createFantasyLeague(
        leagueInput(),
        model,
        authority("fantasy.league.manage", { kind: "ACCOUNT" }, "account-b"),
      ),
    ).toThrowError(expect.objectContaining({ code: "ACCOUNT_MISMATCH" }));
  });

  it("binds a team manager to exact Account membership and league ancestry", () => {
    const league = activeLeague();
    const team = activeTeam(league);

    expect(team).toMatchObject({
      accountId: "account-a",
      fantasyLeagueId: league.id,
      owner: {
        accountId: "account-a",
        accountMembershipId: "account-membership-manager-a",
      },
      lifecycle: "ACTIVE",
    });
    expect(() =>
      createFantasyTeam(
        { ...teamInput(), accountId: "account-b" },
        league,
        authority("fantasy.team.manage", { kind: "ACCOUNT" }, "account-b"),
      ),
    ).toThrowError(expect.objectContaining({ code: "ACCOUNT_MISMATCH" }));
  });
});

describe("fantasy player identity, privacy, and roster rules", () => {
  it("references canonical baseball identity without copying personal fields", () => {
    const model = activeModel();
    const league = activeLeague(model);
    const team = activeTeam(league);
    const entry = createFantasyPlayerEntry(
      playerInput(model),
      league,
      rosterAuthority(team),
    );

    expect(entry.baseballPlayerId).toBe("baseball-player-stable-a");
    expect(Object.keys(entry)).not.toEqual(
      expect.arrayContaining([
        "name",
        "dateOfBirth",
        "contacts",
        "notes",
        "medicalInformation",
      ]),
    );
    expect(() =>
      createFantasyPlayerEntry(
        { ...playerInput(model), dateOfBirth: "2011-01-01" },
        league,
        rosterAuthority(team),
      ),
    ).toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));
  });

  it("allows one baseball identity in different leagues but never twice in one roster", () => {
    const model = activeModel();
    const firstLeague = activeLeague(model);
    const firstTeam = activeTeam(firstLeague);
    const first = createFantasyPlayerEntry(
      playerInput(model),
      firstLeague,
      rosterAuthority(firstTeam),
    );

    const secondLeague = createFantasyLeague(
      leagueInput("fantasy-league-b"),
      model,
      authority("fantasy.league.manage"),
    );
    const second = createFantasyPlayerEntry(
      {
        ...playerInput(model),
        id: "fantasy-player-entry-b",
        fantasyLeagueId: secondLeague.id,
        ownership: {
          ...playerInput(model).ownership,
          state: "AVAILABLE" as const,
          fantasyTeamId: null,
        },
      },
      secondLeague,
      authority("fantasy.roster.manage", {
        kind: "FANTASY_LEAGUE",
        fantasyLeagueId: secondLeague.id,
      }),
    );
    expect(second.baseballPlayerId).toBe(first.baseballPlayerId);

    const duplicate = createFantasyPlayerEntry(
      {
        ...playerInput(model),
        id: "fantasy-player-entry-duplicate",
      },
      firstLeague,
      rosterAuthority(firstTeam),
    );
    expect(() =>
      createFantasyRosterSnapshot(
        {
          ...rosterInput(),
          slots: [
            rosterInput().slots[0],
            {
              id: "bench-1",
              kind: "BENCH",
              lineupSlotRuleId: null,
              playerEntryId: duplicate.id,
            },
          ],
        },
        firstLeague,
        firstTeam,
        model,
        [first, duplicate],
        rosterAuthority(firstTeam),
      ),
    ).toThrowError(expect.objectContaining({ code: "ROSTER_CONFLICT" }));
  });

  it("validates active eligibility, ownership, and sealed roster limits", () => {
    const model = activeModel();
    const league = activeLeague(model);
    const team = activeTeam(league);
    const entry = createFantasyPlayerEntry(
      playerInput(model),
      league,
      rosterAuthority(team),
    );
    const snapshot = createFantasyRosterSnapshot(
      rosterInput(),
      league,
      team,
      model,
      [entry],
      rosterAuthority(team),
    );
    expect(snapshot).toMatchObject({
      revision: 0,
      previousSnapshotId: null,
      rules: { modelVersionId: model.modelVersionId },
    });
    expect(Object.isFrozen(snapshot.slots)).toBe(true);

    expect(() =>
      createFantasyRosterSnapshot(
        {
          ...rosterInput(),
          slots: [
            {
              ...rosterInput().slots[0],
              lineupSlotRuleId: "P",
            },
          ],
        },
        league,
        team,
        model,
        [entry],
        rosterAuthority(team),
      ),
    ).toThrowError(expect.objectContaining({ code: "POSITION_INELIGIBLE" }));
  });
});

describe("fantasy historical behavior", () => {
  function firstSnapshot(): {
    model: FantasyScoringModelVersion;
    league: FantasyLeague;
    team: FantasyTeam;
    snapshot: FantasyRosterSnapshot;
  } {
    const model = activeModel();
    const league = activeLeague(model);
    const team = activeTeam(league);
    const entry = createFantasyPlayerEntry(
      playerInput(model),
      league,
      rosterAuthority(team),
    );
    return {
      model,
      league,
      team,
      snapshot: createFantasyRosterSnapshot(
        rosterInput(),
        league,
        team,
        model,
        [entry],
        rosterAuthority(team),
      ),
    };
  }

  it("creates ordered immutable snapshots without changing prior history", () => {
    const { model, league, team, snapshot } = firstSnapshot();
    const next = createFantasyRosterSnapshot(
      {
        ...rosterInput({
          id: "roster-snapshot-a-1",
          revision: 1,
          previousSnapshotId: snapshot.id,
          effectiveAt: "2026-08-08T12:00:00.000Z",
        }),
        slots: [],
      },
      league,
      team,
      model,
      [],
      rosterAuthority(team),
      snapshot,
    );

    expect(next.previousSnapshotId).toBe(snapshot.id);
    expect(snapshot.revision).toBe(0);
    expect(snapshot.slots).toHaveLength(2);
    expect(() =>
      createFantasyRosterSnapshot(
        { ...rosterInput(), revision: 2, previousSnapshotId: snapshot.id },
        league,
        team,
        model,
        [],
        rosterAuthority(team),
        snapshot,
      ),
    ).toThrowError(expect.objectContaining({ code: "HISTORY_CONFLICT" }));
  });

  it("does not reopen or mutate a completed fantasy season", () => {
    const { model, league, team } = firstSnapshot();
    const completed = transitionFantasyLeague(
      league,
      "COMPLETED",
      "2026-10-01T12:00:00.000Z",
      authority("fantasy.league.manage", {
        kind: "FANTASY_LEAGUE",
        fantasyLeagueId: league.id,
      }),
      model,
    );
    expect(() =>
      transitionFantasyLeague(
        completed,
        "ACTIVE",
        "2026-10-02T12:00:00.000Z",
        authority("fantasy.league.manage"),
        model,
      ),
    ).toThrowError(expect.objectContaining({ code: "INVALID_TRANSITION" }));
    expect(() =>
      createFantasyRosterSnapshot(
        rosterInput(),
        completed,
        team,
        model,
        [],
        rosterAuthority(team),
      ),
    ).toThrowError(expect.objectContaining({ code: "HISTORY_CONFLICT" }));
  });
});

function accountScope(): DelegationScope {
  return {
    kind: "ACCOUNT",
    organizationId: "organization-a",
    leagueId: null,
    delegationId: "delegation-a",
    accountId: "account-a",
    teamId: null,
    seasonId: null,
    gameId: null,
  };
}

function accountTarget(accountId = "account-a"): ResolvedDelegationTarget {
  return {
    kind: "ACCOUNT",
    organizationId: "organization-a",
    leagueId: null,
    delegationId: "delegation-a",
    accountId,
    teamIds: [],
    seasonId: null,
    gameId: null,
  };
}

function delegationEvidence(
  capability: FantasyDomainCapability,
  approved = false,
): DelegationEvidence {
  const scope = accountScope();
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
      validFrom: new Date("2026-08-01T00:00:00.000Z"),
      expiresAt: null,
      revokedAt: null,
      approvedByAccountMembershipId: "account-membership-owner-a",
    },
    grant: {
      id: "grant-a",
      organizationId: "organization-a",
      organizationMembershipId: "organization-membership-a",
      delegationId: "delegation-a",
      accountId: "account-a",
      capability,
      scope,
      status: "ACTIVE",
      validFrom: new Date("2026-08-01T00:00:00.000Z"),
      expiresAt: null,
      revokedAt: null,
      approvedByAccountMembershipId: "account-membership-owner-a",
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
          approvedByKind: "ACCOUNT_MEMBERSHIP",
          approvedById: "account-membership-owner-a",
        }
      : null,
  };
}

describe("fantasy delegation authorization", () => {
  it("adapts only an allowed exact-Account #107 decision", () => {
    const decision = evaluateLeagueDelegation(
      delegationEvidence("fantasy.team.manage"),
      "fantasy.team.manage",
      accountTarget(),
      new Date(CREATED),
    );
    const adapted = fantasyAuthorityFromDelegation(decision, {
      accountId: "account-a",
      actorId: "user-a",
      capability: "fantasy.team.manage",
      scope: { kind: "FANTASY_LEAGUE", fantasyLeagueId: "fantasy-league-a" },
      authorizedAt: CREATED,
    });
    expect(adapted).toMatchObject({
      source: "LEAGUE_DELEGATION",
      accountId: "account-a",
      capability: "fantasy.team.manage",
    });
    expect(adapted.authorityReferenceIds).toEqual([
      "organization-membership-a",
      "grant-a",
      "delegation-a",
    ]);
    expect(() =>
      fantasyAuthorityFromDelegation(decision, {
        accountId: "account-a",
        actorId: "forged-user",
        capability: "fantasy.team.manage",
        scope: {
          kind: "FANTASY_LEAGUE",
          fantasyLeagueId: "fantasy-league-a",
        },
        authorizedAt: CREATED,
      }),
    ).toThrowError(expect.objectContaining({ code: "AUTHORIZATION_REQUIRED" }));
  });

  it("denies sibling Accounts and requires approval for activation", () => {
    expect(
      evaluateLeagueDelegation(
        delegationEvidence("fantasy.team.manage"),
        "fantasy.team.manage",
        accountTarget("account-b"),
        new Date(CREATED),
      ),
    ).toMatchObject({ allowed: false, code: "DELEGATION_MISMATCH" });
    expect(
      evaluateLeagueDelegation(
        delegationEvidence("fantasy.league.activate"),
        "fantasy.league.activate",
        accountTarget(),
        new Date(CREATED),
      ),
    ).toMatchObject({ allowed: false, code: "APPROVAL_REQUIRED" });
    expect(
      evaluateLeagueDelegation(
        delegationEvidence("fantasy.league.activate", true),
        "fantasy.league.activate",
        accountTarget(),
        new Date(CREATED),
      ),
    ).toMatchObject({ allowed: true });
  });
});
