import { describe, expect, it } from "vitest";

import {
  createFantasyLeague,
  createFantasyPlayerEntry,
  createFantasyRosterSnapshot,
  createFantasyTeam,
  transitionFantasyLeague,
  transitionFantasyTeam,
  type FantasyDomainAuthority,
  type FantasyLeague,
  type FantasyPlayerEntry,
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
  applyFantasyTransaction,
  createFantasyTransactionState,
  type FantasyTransactionCommand,
  type FantasyTransactionPolicy,
  type FantasyTransactionState,
  type LineupChangeCommand,
  type SubmitWaiverClaimCommand,
  type TradeCommand,
} from "@/domain/fantasy-transactions";

const CREATED = "2026-08-04T12:00:00.000Z";
const ACTIVATED = "2026-08-05T12:00:00.000Z";
const AUTHORIZED = "2026-08-08T00:00:00.000Z";
const WAIVER_AT = "2026-08-10T12:00:00.000Z";
const TRADE_AT = "2026-08-12T12:00:00.000Z";

function modelInput(): FantasyScoringModelInput {
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
      maximumRosterSize: 3,
      benchSlots: 1,
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
  };
}

function activeModel(): FantasyScoringModelVersion {
  const draft = createFantasyScoringModelVersion(modelInput());
  return transitionFantasyScoringModel(
    transitionFantasyScoringModel(draft, "REVIEWED"),
    "ACTIVE",
  );
}

function authority(
  scope: FantasyDomainAuthority["scope"] = { kind: "ACCOUNT" },
  overrides: Partial<FantasyDomainAuthority> = {},
): FantasyDomainAuthority {
  return {
    accountId: "account-a",
    actorId: "actor-a",
    source: "ACCOUNT_PERMISSION",
    capability: "fantasy.roster.manage",
    scope,
    authorityReferenceIds: ["account-membership-a"],
    authorizedAt: AUTHORIZED,
    ...overrides,
  };
}

function setupAuthority(capability: FantasyDomainAuthority["capability"]) {
  return {
    ...authority(),
    capability,
    authorityReferenceIds:
      capability === "fantasy.league.activate"
        ? ["account-membership-a", "activation-approval-a"]
        : ["account-membership-a"],
    authorizedAt: CREATED,
  };
}

function createLeague(model: FantasyScoringModelVersion): FantasyLeague {
  const draft = createFantasyLeague(
    {
      id: "fantasy-league-a",
      accountId: "account-a",
      administrativeScope: null,
      seasonId: "season-2026",
      name: "Summer fantasy league",
      visibility: "PRIVATE",
      createdAt: CREATED,
    },
    model,
    setupAuthority("fantasy.league.manage"),
  );
  return transitionFantasyLeague(
    draft,
    "ACTIVE",
    ACTIVATED,
    setupAuthority("fantasy.league.activate"),
    model,
  );
}

function createTeam(
  league: FantasyLeague,
  id: "team-a" | "team-b",
): FantasyTeam {
  const draft = createFantasyTeam(
    {
      id,
      accountId: league.accountId,
      fantasyLeagueId: league.id,
      ownerAccountMembershipId: `manager-membership-${id}`,
      name: id === "team-a" ? "Owls" : "Foxes",
      createdAt: "2026-08-06T00:00:00.000Z",
    },
    league,
    { ...setupAuthority("fantasy.team.manage"), authorizedAt: ACTIVATED },
  );
  return transitionFantasyTeam(
    draft,
    league,
    "ACTIVE",
    "2026-08-06T12:00:00.000Z",
    { ...setupAuthority("fantasy.team.manage"), authorizedAt: ACTIVATED },
  );
}

function createEntry(
  league: FantasyLeague,
  model: FantasyScoringModelVersion,
  input: Readonly<{
    id: string;
    baseballPlayerId: string;
    position: "OUTFIELD" | "PITCHER";
    fantasyTeamId: string | null;
  }>,
): FantasyPlayerEntry {
  return createFantasyPlayerEntry(
    {
      id: input.id,
      accountId: league.accountId,
      fantasyLeagueId: league.id,
      baseballPlayerId: input.baseballPlayerId,
      eligibility: {
        fantasyModelVersionId: model.modelVersionId,
        fantasyModelDigest: model.contentDigest,
        eligiblePositionCodes: [input.position],
        sourceRosterRevision: 4,
        sourceStatisticsRevision: 9,
        verification: "VERIFIED",
        evaluatedAt: "2026-08-06T12:00:00.000Z",
      },
      ownership: {
        state: input.fantasyTeamId === null ? "AVAILABLE" : "ROSTERED",
        fantasyTeamId: input.fantasyTeamId,
        revision: input.fantasyTeamId === null ? 0 : 1,
        effectiveAt: "2026-08-06T12:00:00.000Z",
      },
      createdAt: "2026-08-06T12:00:00.000Z",
    },
    league,
    authority(),
  );
}

function initialRoster(
  league: FantasyLeague,
  team: FantasyTeam,
  model: FantasyScoringModelVersion,
  entries: readonly FantasyPlayerEntry[],
  activeOutfielderId: string,
): FantasyRosterSnapshot {
  return createFantasyRosterSnapshot(
    {
      id: `roster-${team.id}-0`,
      accountId: league.accountId,
      fantasyLeagueId: league.id,
      fantasyTeamId: team.id,
      revision: 0,
      previousSnapshotId: null,
      effectiveAt: "2026-08-07T12:00:00.000Z",
      slots: [
        {
          id: "active-of",
          kind: "ACTIVE",
          lineupSlotRuleId: "OF",
          playerEntryId: activeOutfielderId,
        },
        {
          id: "active-p",
          kind: "ACTIVE",
          lineupSlotRuleId: "P",
          playerEntryId: null,
        },
        {
          id: "bench-1",
          kind: "BENCH",
          lineupSlotRuleId: null,
          playerEntryId: null,
        },
      ],
    },
    league,
    team,
    model,
    entries,
    authority(),
  );
}

function policy(
  overrides: Partial<FantasyTransactionPolicy> = {},
): FantasyTransactionPolicy {
  return {
    initialAssignmentMethod: "DRAFT",
    initialAssignmentDeadline: "2026-08-09T00:00:00.000Z",
    acquisitionMethod: "DAILY_WAIVERS",
    waiverProcessingInstants: [WAIVER_AT],
    initialWaiverPriority: ["team-b", "team-a"],
    tradeProcessingInstants: [TRADE_AT],
    tradeDeadline: "2026-09-01T00:00:00.000Z",
    tradeAcceptance: "ALL_PARTICIPATING_MANAGERS",
    commissionerVeto: "NONE",
    lineupLocks: [
      {
        id: "weekly-lock-a",
        startsAt: "2026-08-11T00:00:00.000Z",
        endsAt: "2026-08-18T00:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

type Fixture = Readonly<{
  model: FantasyScoringModelVersion;
  league: FantasyLeague;
  teams: readonly [FantasyTeam, FantasyTeam];
  entries: readonly FantasyPlayerEntry[];
  state: FantasyTransactionState;
}>;

function fixture(
  policyOverrides: Partial<FantasyTransactionPolicy> = {},
): Fixture {
  const model = activeModel();
  const league = createLeague(model);
  const teamA = createTeam(league, "team-a");
  const teamB = createTeam(league, "team-b");
  const entries = [
    createEntry(league, model, {
      id: "player-a",
      baseballPlayerId: "baseball-player-a",
      position: "OUTFIELD",
      fantasyTeamId: teamA.id,
    }),
    createEntry(league, model, {
      id: "player-b",
      baseballPlayerId: "baseball-player-b",
      position: "OUTFIELD",
      fantasyTeamId: teamB.id,
    }),
    createEntry(league, model, {
      id: "player-c",
      baseballPlayerId: "baseball-player-c",
      position: "OUTFIELD",
      fantasyTeamId: null,
    }),
    createEntry(league, model, {
      id: "player-d",
      baseballPlayerId: "baseball-player-d",
      position: "PITCHER",
      fantasyTeamId: null,
    }),
  ];
  const teams = [teamA, teamB] as const;
  const currentRosters = [
    initialRoster(league, teamA, model, entries, "player-a"),
    initialRoster(league, teamB, model, entries, "player-b"),
  ];
  return {
    model,
    league,
    teams,
    entries,
    state: createFantasyTransactionState({
      league,
      teams,
      model,
      policy: policy(policyOverrides),
      playerEntries: entries,
      currentRosters,
    }),
  };
}

function context(value: Fixture) {
  return { league: value.league, teams: value.teams, model: value.model };
}

function teamAuthority(teamId: string): FantasyDomainAuthority {
  return authority({
    kind: "FANTASY_TEAM",
    fantasyLeagueId: "fantasy-league-a",
    fantasyTeamId: teamId,
  });
}

function addCommand(
  revision = 0,
  overrides: Partial<
    Extract<FantasyTransactionCommand, { action: "ADD_PLAYER" }>
  > = {},
): Extract<FantasyTransactionCommand, { action: "ADD_PLAYER" }> {
  return {
    operationId: "operation-add-c",
    auditId: "audit-add-c",
    accountId: "account-a",
    fantasyLeagueId: "fantasy-league-a",
    expectedRevision: revision,
    submittedAt: "2026-08-08T12:00:00.000Z",
    authority: authority(),
    action: "ADD_PLAYER",
    fantasyTeamId: "team-a",
    playerEntryId: "player-c",
    targetSlotId: "bench-1",
    rosterSnapshotId: "roster-team-a-1",
    assignmentMethod: "DRAFT",
    ...overrides,
  };
}

function ownershipTeam(state: FantasyTransactionState, playerEntryId: string) {
  return state.playerEntries.find((entry) => entry.id === playerEntryId)
    ?.ownership.fantasyTeamId;
}

describe("fantasy transaction state and audit", () => {
  it("creates a frozen Account- and league-scoped transaction state", () => {
    const value = fixture();
    expect(value.state).toMatchObject({
      accountId: "account-a",
      fantasyLeagueId: "fantasy-league-a",
      revision: 0,
      waiverPriority: ["team-b", "team-a"],
    });
    expect(Object.isFrozen(value.state)).toBe(true);
    expect(Object.isFrozen(value.state.currentRosters)).toBe(true);
  });

  it("rejects inconsistent initial ownership instead of normalizing it", () => {
    const value = fixture();
    const corrupted = value.entries.map((entry) =>
      entry.id === "player-a"
        ? {
            ...entry,
            ownership: {
              ...entry.ownership,
              fantasyTeamId: "team-b",
            },
          }
        : entry,
    );
    expect(() =>
      createFantasyTransactionState({
        league: value.league,
        teams: value.teams,
        model: value.model,
        policy: policy(),
        playerEntries: corrupted,
        currentRosters: value.state.currentRosters,
      }),
    ).toThrowError(expect.objectContaining({ code: "OWNERSHIP_CONFLICT" }));
  });

  it("records actor, league, action, players, timestamp, and applied result", () => {
    const value = fixture();
    const outcome = applyFantasyTransaction(
      value.state,
      addCommand(),
      context(value),
    );

    expect(outcome.record).toMatchObject({
      action: "ADD_PLAYER",
      affectedPlayerEntryIds: ["player-c"],
      status: "APPLIED",
      beforeRevision: 0,
      afterRevision: 1,
      rosterSnapshotIds: ["roster-team-a-1"],
    });
    expect(outcome.audit).toMatchObject({
      actorId: "actor-a",
      accountId: "account-a",
      fantasyLeagueId: "fantasy-league-a",
      action: "ADD_PLAYER",
      acceptedAt: "2026-08-08T12:00:00.000Z",
      result: "APPLIED",
    });
    expect(ownershipTeam(outcome.state, "player-c")).toBe("team-a");
    expect(outcome.state.currentRosters[0]).toMatchObject({
      revision: 1,
      previousSnapshotId: "roster-team-a-0",
    });
  });
});

describe("authorization, concurrency, idempotency, and rollback", () => {
  it("denies cross-team and cross-league changes with audit evidence", () => {
    const value = fixture();
    const crossTeam = applyFantasyTransaction(
      value.state,
      addCommand(0, { authority: teamAuthority("team-b") }),
      context(value),
    );
    expect(crossTeam.record).toMatchObject({
      status: "DENIED",
      resultCode: "AUTHORIZATION_REQUIRED",
      beforeRevision: 0,
      afterRevision: 0,
    });
    expect(crossTeam.state.audits).toHaveLength(1);
    expect(ownershipTeam(crossTeam.state, "player-c")).toBeNull();

    const crossLeague = applyFantasyTransaction(
      value.state,
      addCommand(0, { fantasyLeagueId: "fantasy-league-b" }),
      context(value),
    );
    expect(crossLeague.record.resultCode).toBe("LEAGUE_MISMATCH");
  });

  it("uses optimistic revision checks so concurrent writers cannot both commit", () => {
    const value = fixture();
    const first = applyFantasyTransaction(
      value.state,
      addCommand(),
      context(value),
    );
    const stale = applyFantasyTransaction(
      first.state,
      {
        ...addCommand(0),
        operationId: "operation-add-d",
        auditId: "audit-add-d",
        playerEntryId: "player-d",
        targetSlotId: "active-p",
        rosterSnapshotId: "roster-team-a-2",
      },
      context(value),
    );

    expect(first.record.status).toBe("APPLIED");
    expect(stale.record).toMatchObject({
      status: "DENIED",
      resultCode: "STALE_REVISION",
      beforeRevision: 1,
      afterRevision: 1,
    });
    expect(ownershipTeam(stale.state, "player-d")).toBeNull();
  });

  it("returns the original result for an exact duplicate and rejects key reuse", () => {
    const value = fixture();
    const applied = applyFantasyTransaction(
      value.state,
      addCommand(),
      context(value),
    );
    const duplicate = applyFantasyTransaction(
      applied.state,
      addCommand(),
      context(value),
    );
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.state).toBe(applied.state);
    expect(duplicate.record).toStrictEqual(applied.record);

    const conflict = applyFantasyTransaction(
      applied.state,
      { ...addCommand(), playerEntryId: "player-d" },
      context(value),
    );
    expect(conflict.record).toMatchObject({
      status: "DENIED",
      resultCode: "IDEMPOTENCY_CONFLICT",
    });
    expect(conflict.state.transactions).toHaveLength(1);
    expect(conflict.state.audits).toHaveLength(2);
  });

  it("rolls back ownership and roster changes when validation fails", () => {
    const value = fixture();
    const denied = applyFantasyTransaction(
      value.state,
      addCommand(0, { targetSlotId: "active-of" }),
      context(value),
    );

    expect(denied.record).toMatchObject({
      status: "DENIED",
      resultCode: "ROSTER_CONFLICT",
    });
    expect(denied.state.revision).toBe(0);
    expect(ownershipTeam(denied.state, "player-c")).toBeNull();
    expect(denied.state.currentRosters).toEqual(value.state.currentRosters);
  });
});

describe("drop, trade, and lineup behavior", () => {
  it("drops a player through a new ownership and roster revision", () => {
    const value = fixture();
    const outcome = applyFantasyTransaction(
      value.state,
      {
        operationId: "operation-drop-a",
        auditId: "audit-drop-a",
        accountId: "account-a",
        fantasyLeagueId: "fantasy-league-a",
        expectedRevision: 0,
        submittedAt: "2026-08-08T12:00:00.000Z",
        authority: teamAuthority("team-a"),
        action: "DROP_PLAYER",
        fantasyTeamId: "team-a",
        playerEntryId: "player-a",
        rosterSnapshotId: "roster-team-a-drop-1",
      },
      context(value),
    );
    expect(outcome.record.status).toBe("APPLIED");
    expect(
      outcome.state.playerEntries.find((entry) => entry.id === "player-a")
        ?.ownership,
    ).toMatchObject({ state: "RELEASED", fantasyTeamId: null, revision: 2 });
    expect(
      outcome.state.currentRosters[0]?.slots.some(
        (slot) => slot.playerEntryId === "player-a",
      ),
    ).toBe(false);
  });

  function tradeCommand(overrides: Partial<TradeCommand> = {}): TradeCommand {
    return {
      operationId: "operation-trade-a-b",
      auditId: "audit-trade-a-b",
      accountId: "account-a",
      fantasyLeagueId: "fantasy-league-a",
      expectedRevision: 0,
      submittedAt: TRADE_AT,
      authority: authority(),
      action: "TRADE",
      firstTeamId: "team-a",
      secondTeamId: "team-b",
      firstPlayerEntryId: "player-a",
      secondPlayerEntryId: "player-b",
      firstTargetSlotId: "active-of",
      secondTargetSlotId: "active-of",
      firstRosterSnapshotId: "roster-team-a-trade-1",
      secondRosterSnapshotId: "roster-team-b-trade-1",
      processingAt: TRADE_AT,
      acceptances: [
        {
          fantasyTeamId: "team-a",
          accountMembershipId: "manager-membership-team-a",
          acceptedAt: "2026-08-09T12:00:00.000Z",
          authorityReferenceIds: ["acceptance-a"],
        },
        {
          fantasyTeamId: "team-b",
          accountMembershipId: "manager-membership-team-b",
          acceptedAt: "2026-08-09T13:00:00.000Z",
          authorityReferenceIds: ["acceptance-b"],
        },
      ],
      ...overrides,
    };
  }

  it("applies a mutually accepted trade atomically at its sealed instant", () => {
    const value = fixture();
    const outcome = applyFantasyTransaction(
      value.state,
      tradeCommand(),
      context(value),
    );
    expect(outcome.record).toMatchObject({
      status: "APPLIED",
      effectiveAt: TRADE_AT,
      affectedPlayerEntryIds: ["player-a", "player-b"],
      rosterSnapshotIds: ["roster-team-a-trade-1", "roster-team-b-trade-1"],
    });
    expect(ownershipTeam(outcome.state, "player-a")).toBe("team-b");
    expect(ownershipTeam(outcome.state, "player-b")).toBe("team-a");
  });

  it("denies missing acceptance and atomically rolls back a half-invalid trade", () => {
    const value = fixture();
    const missingAcceptance = applyFantasyTransaction(
      value.state,
      tradeCommand({ acceptances: [tradeCommand().acceptances[0]!] }),
      context(value),
    );
    expect(missingAcceptance.record.resultCode).toBe(
      "TRADE_ACCEPTANCE_REQUIRED",
    );
    expect(ownershipTeam(missingAcceptance.state, "player-a")).toBe("team-a");

    const invalidSecondRoster = applyFantasyTransaction(
      value.state,
      tradeCommand({ secondTargetSlotId: "active-p" }),
      context(value),
    );
    expect(invalidSecondRoster.record).toMatchObject({
      status: "DENIED",
      resultCode: "ROSTER_CONFLICT",
    });
    expect(ownershipTeam(invalidSecondRoster.state, "player-a")).toBe("team-a");
    expect(ownershipTeam(invalidSecondRoster.state, "player-b")).toBe("team-b");
    expect(invalidSecondRoster.state.currentRosters).toEqual(
      value.state.currentRosters,
    );
  });

  it("changes a lineup before lock and permits only audited commissioner correction during lock", () => {
    const value = fixture();
    const added = applyFantasyTransaction(
      value.state,
      addCommand(),
      context(value),
    );
    const beforeLock: LineupChangeCommand = {
      operationId: "operation-lineup-a",
      auditId: "audit-lineup-a",
      accountId: "account-a",
      fantasyLeagueId: "fantasy-league-a",
      expectedRevision: 1,
      submittedAt: "2026-08-09T12:00:00.000Z",
      authority: teamAuthority("team-a"),
      action: "LINEUP_CHANGE",
      fantasyTeamId: "team-a",
      rosterSnapshotId: "roster-team-a-lineup-2",
      slots: [
        {
          id: "active-of",
          kind: "ACTIVE",
          lineupSlotRuleId: "OF",
          playerEntryId: "player-c",
        },
        {
          id: "active-p",
          kind: "ACTIVE",
          lineupSlotRuleId: "P",
          playerEntryId: null,
        },
        {
          id: "bench-1",
          kind: "BENCH",
          lineupSlotRuleId: null,
          playerEntryId: "player-a",
        },
      ],
      commissionerCorrectionReason: null,
    };
    const changed = applyFantasyTransaction(
      added.state,
      beforeLock,
      context(value),
    );
    expect(changed.record.status).toBe("APPLIED");

    const locked = applyFantasyTransaction(
      changed.state,
      {
        ...beforeLock,
        operationId: "operation-lineup-locked",
        auditId: "audit-lineup-locked",
        expectedRevision: 2,
        submittedAt: "2026-08-12T13:00:00.000Z",
        rosterSnapshotId: "roster-team-a-lineup-3",
      },
      context(value),
    );
    expect(locked.record.resultCode).toBe("LINEUP_LOCKED");

    const corrected = applyFantasyTransaction(
      changed.state,
      {
        ...beforeLock,
        operationId: "operation-lineup-correction",
        auditId: "audit-lineup-correction",
        expectedRevision: 2,
        submittedAt: "2026-08-12T13:00:00.000Z",
        authority: authority(),
        rosterSnapshotId: "roster-team-a-lineup-corrected-3",
        commissionerCorrectionReason:
          "Restore the lineup accepted before lock.",
      },
      context(value),
    );
    expect(corrected.record.status).toBe("APPLIED");
    expect(corrected.audit).toMatchObject({
      actorId: "actor-a",
      action: "LINEUP_CHANGE",
      result: "APPLIED",
      commissionerCorrectionReason: "Restore the lineup accepted before lock.",
    });
  });
});

describe("deterministic waiver processing", () => {
  function claim(
    teamId: "team-a" | "team-b",
    revision: number,
    suffix: string,
    submittedAt: string,
    overrides: Partial<SubmitWaiverClaimCommand> = {},
  ): SubmitWaiverClaimCommand {
    return {
      operationId: `operation-claim-${suffix}`,
      auditId: `audit-claim-${suffix}`,
      accountId: "account-a",
      fantasyLeagueId: "fantasy-league-a",
      expectedRevision: revision,
      submittedAt,
      authority: teamAuthority(teamId),
      action: "SUBMIT_WAIVER_CLAIM",
      claimId: `claim-${suffix}`,
      fantasyTeamId: teamId,
      playerEntryId: "player-c",
      conditionalDropPlayerEntryId: null,
      targetSlotId: "bench-1",
      rosterSnapshotId: `roster-${teamId}-waiver-${suffix}`,
      processingAt: WAIVER_AT,
      ...overrides,
    };
  }

  it("queues claims, awards by priority, rotates only the winner, and audits the batch", () => {
    const value = fixture();
    const teamAClaim = applyFantasyTransaction(
      value.state,
      claim("team-a", 0, "a", "2026-08-08T12:00:00.000Z"),
      context(value),
    );
    const teamBClaim = applyFantasyTransaction(
      teamAClaim.state,
      claim("team-b", 1, "b", "2026-08-08T12:01:00.000Z"),
      context(value),
    );
    expect(teamAClaim.record.status).toBe("QUEUED");
    expect(teamBClaim.record.status).toBe("QUEUED");

    const processed = applyFantasyTransaction(
      teamBClaim.state,
      {
        operationId: "operation-process-waivers",
        auditId: "audit-process-waivers",
        accountId: "account-a",
        fantasyLeagueId: "fantasy-league-a",
        expectedRevision: 2,
        submittedAt: WAIVER_AT,
        authority: authority(),
        action: "PROCESS_WAIVERS",
        processingAt: WAIVER_AT,
      },
      context(value),
    );
    expect(processed.record).toMatchObject({
      status: "APPLIED",
      affectedPlayerEntryIds: ["player-c"],
      effectiveAt: WAIVER_AT,
    });
    expect(ownershipTeam(processed.state, "player-c")).toBe("team-b");
    expect(processed.state.waiverPriority).toEqual(["team-a", "team-b"]);
    expect(
      processed.state.waiverClaims.map(({ id, status, resultCode }) => ({
        id,
        status,
        resultCode,
      })),
    ).toEqual([
      {
        id: "claim-a",
        status: "REJECTED",
        resultCode: "OWNERSHIP_CONFLICT",
      },
      { id: "claim-b", status: "APPLIED", resultCode: null },
    ]);
    expect(processed.audit).toMatchObject({
      action: "PROCESS_WAIVERS",
      affectedPlayerEntryIds: ["player-c"],
      result: "APPLIED",
    });
    expect(
      processed.state.audits.filter(
        (audit) =>
          audit.action === "PROCESS_WAIVERS" && audit.operationId.includes(":"),
      ),
    ).toEqual([
      expect.objectContaining({
        affectedPlayerEntryIds: ["player-c"],
        result: "APPLIED",
        reasonCode: null,
      }),
      expect.objectContaining({
        affectedPlayerEntryIds: ["player-c"],
        result: "DENIED",
        reasonCode: "OWNERSHIP_CONFLICT",
      }),
    ]);
  });

  it("cancels only a pending exact-team claim", () => {
    const value = fixture();
    const submitted = applyFantasyTransaction(
      value.state,
      claim("team-a", 0, "cancel", "2026-08-08T12:00:00.000Z"),
      context(value),
    );
    const denied = applyFantasyTransaction(
      submitted.state,
      {
        operationId: "operation-cancel-wrong-team",
        auditId: "audit-cancel-wrong-team",
        accountId: "account-a",
        fantasyLeagueId: "fantasy-league-a",
        expectedRevision: 1,
        submittedAt: "2026-08-08T13:00:00.000Z",
        authority: teamAuthority("team-b"),
        action: "CANCEL_WAIVER_CLAIM",
        claimId: "claim-cancel",
      },
      context(value),
    );
    expect(denied.record.resultCode).toBe("AUTHORIZATION_REQUIRED");

    const cancelled = applyFantasyTransaction(
      submitted.state,
      {
        operationId: "operation-cancel",
        auditId: "audit-cancel",
        accountId: "account-a",
        fantasyLeagueId: "fantasy-league-a",
        expectedRevision: 1,
        submittedAt: "2026-08-08T13:00:00.000Z",
        authority: teamAuthority("team-a"),
        action: "CANCEL_WAIVER_CLAIM",
        claimId: "claim-cancel",
      },
      context(value),
    );
    expect(cancelled.record.status).toBe("CANCELLED");
    expect(cancelled.state.waiverClaims[0]).toMatchObject({
      status: "CANCELLED",
      resolvedAt: "2026-08-08T13:00:00.000Z",
    });
  });

  it("rolls back a conditional drop when the acquisition fails validation", () => {
    const value = fixture();
    const submitted = applyFantasyTransaction(
      value.state,
      claim("team-a", 0, "rollback", "2026-08-08T12:00:00.000Z", {
        conditionalDropPlayerEntryId: "player-a",
        targetSlotId: "active-p",
      }),
      context(value),
    );
    const processed = applyFantasyTransaction(
      submitted.state,
      {
        operationId: "operation-process-rollback",
        auditId: "audit-process-rollback",
        accountId: "account-a",
        fantasyLeagueId: "fantasy-league-a",
        expectedRevision: 1,
        submittedAt: WAIVER_AT,
        authority: authority(),
        action: "PROCESS_WAIVERS",
        processingAt: WAIVER_AT,
      },
      context(value),
    );

    expect(processed.state.waiverClaims[0]).toMatchObject({
      status: "REJECTED",
      resultCode: "ROSTER_CONFLICT",
    });
    expect(ownershipTeam(processed.state, "player-a")).toBe("team-a");
    expect(ownershipTeam(processed.state, "player-c")).toBeNull();
    expect(processed.state.currentRosters).toEqual(value.state.currentRosters);
    expect(processed.state.waiverPriority).toEqual(["team-b", "team-a"]);
  });
});
