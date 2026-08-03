import { describe, expect, it } from "vitest";

import {
  buildFantasyExperiencePresentation,
  provisionFantasyWorkspace,
} from "@/domain/fantasy-experience";
import type {
  FantasyDomainAuthority,
  FantasyDomainCapability,
} from "@/domain/fantasy-domain";

const CREATED = "2026-08-03T12:00:00.000Z";
const LEAGUE = "00000000-0000-4000-8000-000000000127";
const TEAM = "00000000-0000-4000-8000-000000000128";

function authority(
  capability: FantasyDomainCapability,
  scope: FantasyDomainAuthority["scope"],
): FantasyDomainAuthority {
  return {
    accountId: "account-a",
    actorId: "user-a",
    source: "ACCOUNT_PERMISSION",
    capability,
    scope,
    authorityReferenceIds:
      capability === "fantasy.league.activate"
        ? ["membership-a", "activation-review-a"]
        : ["membership-a"],
    authorizedAt: CREATED,
  };
}

function workspace() {
  return provisionFantasyWorkspace({
    accountId: "account-a",
    seasonId: "season-a",
    fantasyLeagueId: LEAGUE,
    fantasyTeamId: TEAM,
    ownerMembershipId: "membership-a",
    leagueName: "Summer league",
    teamName: "Owls",
    createdAt: CREATED,
    playerIds: [
      {
        fantasyPlayerEntryId: "entry-a",
        baseballPlayerId: "player-a",
        rosterRevision: 4,
      },
      {
        fantasyPlayerEntryId: "entry-b",
        baseballPlayerId: "player-b",
        rosterRevision: 7,
      },
    ],
    manageLeagueAuthority: authority("fantasy.league.manage", {
      kind: "ACCOUNT",
    }),
    activateLeagueAuthority: authority("fantasy.league.activate", {
      kind: "FANTASY_LEAGUE",
      fantasyLeagueId: LEAGUE,
    }),
    manageTeamAuthority: authority("fantasy.team.manage", {
      kind: "FANTASY_LEAGUE",
      fantasyLeagueId: LEAGUE,
    }),
    manageRosterAuthority: authority("fantasy.roster.manage", {
      kind: "FANTASY_LEAGUE",
      fantasyLeagueId: LEAGUE,
    }),
    policy: {
      initialAssignmentMethod: "COMMISSIONER_ASSIGNMENT",
      initialAssignmentDeadline: "2026-08-04T12:00:00.000Z",
      acquisitionMethod: "DAILY_WAIVERS",
      waiverProcessingInstants: ["2026-08-05T12:00:00.000Z"],
      initialWaiverPriority: [TEAM],
      tradeProcessingInstants: ["2026-08-05T12:00:00.000Z"],
      tradeDeadline: "2026-09-05T12:00:00.000Z",
      tradeAcceptance: "ALL_PARTICIPATING_MANAGERS",
      commissionerVeto: "NONE",
      lineupLocks: [],
    },
  });
}

describe("fantasy experience boundary", () => {
  it("references canonical player identity and applies privacy-safe display names", () => {
    const snapshot = workspace();
    const presentation = buildFantasyExperiencePresentation({
      snapshot,
      status: "ACTIVE",
      lineupDeadlineAt: "2026-08-04T12:00:00.000Z",
      membershipId: "membership-a",
      requestedTeamId: TEAM,
      canManageLeague: false,
      playerNames: new Map([
        ["player-a", "Privacy overlay"],
        ["player-b", "Allowed display name"],
      ]),
      results: [],
    });
    expect(
      presentation.availablePlayers.map(({ playerName }) => playerName),
    ).toContain("Privacy overlay");
    expect(JSON.stringify(snapshot)).toContain('"baseballPlayerId":"player-a"');
    expect(JSON.stringify(snapshot)).not.toMatch(/dateOfBirth|email|medical/i);
  });

  it("grants roster changes only to the owning membership or commissioner", () => {
    const snapshot = workspace();
    const otherManager = buildFantasyExperiencePresentation({
      snapshot,
      status: "ACTIVE",
      lineupDeadlineAt: "2026-08-04T12:00:00.000Z",
      membershipId: "membership-b",
      requestedTeamId: TEAM,
      canManageLeague: false,
      playerNames: new Map(),
      results: [],
    });
    const commissioner = buildFantasyExperiencePresentation({
      snapshot,
      status: "ACTIVE",
      lineupDeadlineAt: "2026-08-04T12:00:00.000Z",
      membershipId: "membership-b",
      requestedTeamId: TEAM,
      canManageLeague: true,
      playerNames: new Map(),
      results: [],
    });
    expect(otherManager.canManageRoster).toBe(false);
    expect(commissioner.canManageRoster).toBe(true);
  });

  it("makes paused and historical leagues read-only without deleting history", () => {
    const snapshot = workspace();
    const presentation = buildFantasyExperiencePresentation({
      snapshot,
      status: "ARCHIVED",
      lineupDeadlineAt: "2026-08-04T12:00:00.000Z",
      membershipId: "membership-a",
      requestedTeamId: TEAM,
      canManageLeague: true,
      playerNames: new Map(),
      results: [],
    });
    expect(presentation.canManageRoster).toBe(false);
    expect(presentation.nextAction).toBe("This league is read-only.");
    expect(presentation.roster.length).toBeGreaterThan(0);
  });
});
