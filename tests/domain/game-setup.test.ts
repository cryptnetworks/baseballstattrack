import { describe, expect, it } from "vitest";

import {
  GameSetupError,
  assertGameCreateScope,
  assertGameScope,
  createDraftGameCommandSchema,
  parseGameSetupInput,
  requireGameSetupActor,
  saveSetupRevisionCommandSchema,
} from "@/domain/setup/game-setup";

const actor = {
  accountId: "account-1",
  actorId: "service-1",
  actorKind: "SERVICE" as const,
  actorUserId: null,
  membershipId: null,
  capability: "game.setup" as const,
  scope: { kind: "GAME" as const, gameId: "game-1" },
  authorizedAt: "2026-07-29T19:00:00.000Z",
};

const managedSlot = (
  playerId: string,
  rosterEntryId: string,
  battingOrder: number | null,
  defensivePosition:
    | "PITCHER"
    | "CATCHER"
    | "FIRST_BASE"
    | "SECOND_BASE"
    | "THIRD_BASE"
    | "SHORTSTOP"
    | "LEFT_FIELD"
    | "CENTER_FIELD"
    | "RIGHT_FIELD"
    | "DESIGNATED_HITTER"
    | "EXTRA_HITTER"
    | null,
  isStartingPitcher = false,
) => ({
  kind: "MANAGED" as const,
  playerId,
  rosterEntryId,
  battingOrder,
  defensivePosition,
  isStartingPitcher,
});

const validSetup = () => ({
  accountId: "account-1",
  gameId: "game-1",
  expectedSetupRevision: 0,
  clientSubmissionId: "submission-1",
  rulesetVersionId: "ruleset-1",
  scheduledAt: "2026-08-01T18:00:00.000Z",
  location: "  Central   Field ",
  weatherCondition: "CLEAR",
  temperatureF: 78,
  sides: [
    {
      kind: "MANAGED",
      side: "HOME",
      teamSeasonId: "home-season",
      lineup: [
        managedSlot("home-batter", "home-batter-roster", 1, "SHORTSTOP"),
        managedSlot(
          "home-pitcher",
          "home-pitcher-roster",
          null,
          "PITCHER",
          true,
        ),
      ],
    },
    {
      kind: "EXTERNAL",
      side: "AWAY",
      displayName: "Visitors",
      lineup: [
        {
          kind: "EXTERNAL",
          displayName: "Visitor Batter",
          jerseyNumber: "7",
          battingOrder: 1,
          defensivePosition: "SHORTSTOP",
          isStartingPitcher: false,
        },
        {
          kind: "EXTERNAL",
          displayName: "Visitor Pitcher",
          jerseyNumber: "9",
          battingOrder: null,
          defensivePosition: "PITCHER",
          isStartingPitcher: true,
        },
      ],
    },
  ],
});

describe("game setup boundary", () => {
  it("normalizes bounded game metadata", () => {
    expect(
      parseGameSetupInput(createDraftGameCommandSchema, {
        accountId: "account-1",
        seasonId: "season-1",
        managedTeamSeasonId: "team-season-1",
        scheduledAt: "2026-08-01T18:00:00.000Z",
        location: "  Central   Field ",
        weatherCondition: "PARTLY_CLOUDY",
        temperatureF: 82,
      }),
    ).toMatchObject({
      location: "Central Field",
      weatherCondition: "PARTLY_CLOUDY",
      temperatureF: 82,
    });
  });

  it("rejects private, free-form, and unbounded metadata", () => {
    for (const extra of [
      { notes: "private travel details" },
      { weatherNotes: "free form" },
      { playerPhone: "555-0100" },
      { coordinates: { latitude: 1, longitude: 2 } },
    ]) {
      expect(() =>
        parseGameSetupInput(createDraftGameCommandSchema, {
          accountId: "account-1",
          seasonId: "season-1",
          managedTeamSeasonId: "team-season-1",
          scheduledAt: "2026-08-01T18:00:00.000Z",
          ...extra,
        }),
      ).toThrowError(
        expect.objectContaining<Partial<GameSetupError>>({
          code: "INVALID_INPUT",
        }),
      );
    }
    expect(() =>
      parseGameSetupInput(createDraftGameCommandSchema, {
        accountId: "account-1",
        seasonId: "season-1",
        managedTeamSeasonId: "team-season-1",
        scheduledAt: "2026-08-01T18:00:00.000Z",
        temperatureF: 200,
      }),
    ).toThrowError(GameSetupError);
  });

  it("accepts managed and external sides with snapshot-only external players", () => {
    const parsed = parseGameSetupInput(
      saveSetupRevisionCommandSchema,
      validSetup(),
    );
    expect(parsed.location).toBe("Central Field");
    expect(parsed.sides[1]).toMatchObject({
      kind: "EXTERNAL",
      displayName: "Visitors",
    });
  });

  it("rejects repeated sides, managed players, orders, positions, and invalid pitchers", () => {
    const duplicateSide = validSetup();
    duplicateSide.sides[1]!.side = "HOME";
    expect(() =>
      parseGameSetupInput(saveSetupRevisionCommandSchema, duplicateSide),
    ).toThrowError(GameSetupError);

    const duplicatePlayer = validSetup();
    if (duplicatePlayer.sides[0]?.kind === "MANAGED") {
      const lineup = duplicatePlayer.sides[0].lineup as Array<
        ReturnType<typeof managedSlot>
      >;
      lineup.push(
        managedSlot("home-batter", "another-roster", 2, "SECOND_BASE"),
      );
    }
    expect(() =>
      parseGameSetupInput(saveSetupRevisionCommandSchema, duplicatePlayer),
    ).toThrowError(GameSetupError);

    const duplicateOrder = validSetup();
    if (duplicateOrder.sides[0]?.kind === "MANAGED") {
      duplicateOrder.sides[0].lineup[1]!.battingOrder = 1;
    }
    expect(() =>
      parseGameSetupInput(saveSetupRevisionCommandSchema, duplicateOrder),
    ).toThrowError(GameSetupError);

    const invalidPitcher = validSetup();
    if (invalidPitcher.sides[0]?.kind === "MANAGED") {
      invalidPitcher.sides[0].lineup[1]!.defensivePosition = "CATCHER";
    }
    expect(() =>
      parseGameSetupInput(saveSetupRevisionCommandSchema, invalidPitcher),
    ).toThrowError(GameSetupError);
  });

  it("requires exact capabilities and scopes", () => {
    expect(requireGameSetupActor(actor, "account-1", "game.setup")).toEqual(
      actor,
    );
    assertGameScope(actor, "game-1");
    expect(() => assertGameScope(actor, "game-2")).toThrowError(
      expect.objectContaining<Partial<GameSetupError>>({
        code: "AUTHORIZATION_REQUIRED",
      }),
    );
    expect(() =>
      requireGameSetupActor(
        { ...actor, accountId: "other-account" },
        "account-1",
        "game.setup",
      ),
    ).toThrowError(
      expect.objectContaining<Partial<GameSetupError>>({
        code: "ACCOUNT_MISMATCH",
      }),
    );
    expect(() =>
      assertGameCreateScope(actor, {
        teamId: "team-1",
        seasonId: "season-1",
      }),
    ).toThrowError(GameSetupError);
  });
});
