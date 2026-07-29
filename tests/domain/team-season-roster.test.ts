import { describe, expect, it } from "vitest";

import {
  ManagementError,
  addRosterPeriodCommandSchema,
  assertScope,
  createPlayerCommandSchema,
  createSeasonCommandSchema,
  createTeamCommandSchema,
  parseManagementInput,
  requireManagementActor,
  updateTeamCommandSchema,
} from "@/domain/management/team-season-roster";

const accountActor = {
  accountId: "account-1",
  actorId: "service-1",
  actorKind: "SERVICE" as const,
  actorUserId: null,
  membershipId: null,
  capability: "roster.manage" as const,
  scope: { kind: "ACCOUNT" as const },
  authorizedAt: "2026-07-29T18:00:00.000Z",
};

describe("team, season, and roster management boundaries", () => {
  it("normalizes allowlisted labels and colors", () => {
    expect(
      parseManagementInput(createTeamCommandSchema, {
        accountId: "account-1",
        displayName: "  Harbor   Hawks ",
        color: "#a1b2c3",
      }),
    ).toEqual({
      accountId: "account-1",
      displayName: "Harbor Hawks",
      color: "#A1B2C3",
    });
  });

  it("rejects unapproved player privacy and contact fields", () => {
    for (const field of [
      "dateOfBirth",
      "birthYear",
      "ageBand",
      "email",
      "phone",
      "notes",
      "contact",
    ]) {
      expect(() =>
        parseManagementInput(createPlayerCommandSchema, {
          accountId: "account-1",
          displayName: "Casey",
          [field]: "private",
        }),
      ).toThrowError(
        expect.objectContaining<Partial<ManagementError>>({
          code: "INVALID_INPUT",
        }),
      );
    }
  });

  it("accepts the documented jersey policy without imposing uniqueness", () => {
    for (const jerseyNumber of [null, "0", "00", "1", "9", "10", "99"]) {
      expect(
        parseManagementInput(addRosterPeriodCommandSchema, {
          accountId: "account-1",
          teamSeasonId: "team-season-1",
          playerId: "player-1",
          startsAt: "2026-01-01T00:00:00.000Z",
          jerseyNumber,
        }).jerseyNumber,
      ).toBe(jerseyNumber);
    }

    for (const jerseyNumber of ["000", "01", "-1", "100", "A7", "  "]) {
      expect(() =>
        parseManagementInput(addRosterPeriodCommandSchema, {
          accountId: "account-1",
          teamSeasonId: "team-season-1",
          playerId: "player-1",
          startsAt: "2026-01-01T00:00:00.000Z",
          jerseyNumber,
        }),
      ).toThrowError(
        expect.objectContaining<Partial<ManagementError>>({
          code: "INVALID_INPUT",
        }),
      );
    }
  });

  it("validates date ranges and optimistic revisions at the boundary", () => {
    expect(() =>
      parseManagementInput(createSeasonCommandSchema, {
        accountId: "account-1",
        displayName: "2026",
        startsOn: "2026-09-01",
        endsOn: "2026-08-31",
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ManagementError>>({
        code: "INVALID_INPUT",
      }),
    );

    expect(() =>
      parseManagementInput(updateTeamCommandSchema, {
        accountId: "account-1",
        teamId: "team-1",
        expectedRevision: -1,
        displayName: "Renamed",
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ManagementError>>({
        code: "INVALID_INPUT",
      }),
    );
  });

  it("requires validated Account, capability, actor shape, and exact scope", () => {
    expect(
      requireManagementActor(accountActor, "account-1", "roster.manage"),
    ).toEqual(accountActor);

    for (const actor of [
      { ...accountActor, accountId: "account-2" },
      { ...accountActor, capability: "roster.view" },
      { ...accountActor, actorKind: "USER", actorUserId: null },
    ]) {
      expect(() =>
        requireManagementActor(actor, "account-1", "roster.manage"),
      ).toThrowError(ManagementError);
    }

    expect(() =>
      assertScope(
        {
          ...accountActor,
          scope: { kind: "TEAM", teamId: "team-1" },
        },
        { teamId: "team-2", seasonId: "season-1" },
      ),
    ).toThrowError(
      expect.objectContaining<Partial<ManagementError>>({
        code: "AUTHORIZATION_REQUIRED",
      }),
    );
  });
});
