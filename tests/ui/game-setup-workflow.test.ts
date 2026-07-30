import { describe, expect, it } from "vitest";

import {
  buildSaveSetupCommand,
  firstStepForErrors,
  parseSetupWorkflowDraft,
  validateSetupDraft,
  type ManagedLineupRow,
  type SetupWorkflowDraft,
} from "@/features/game-setup/workflow";

const managed = (
  playerId: string,
  battingOrder: number,
  position: ManagedLineupRow["defensivePosition"],
  pitcher = false,
): ManagedLineupRow => ({
  kind: "MANAGED",
  selected: true,
  eligible: true,
  playerId,
  rosterEntryId: `roster-${playerId}`,
  displayName: `Player ${playerId}`,
  jerseyNumber: null,
  battingOrder,
  defensivePosition: position,
  isStartingPitcher: pitcher,
});

const readyDraft = (
  overrides: Partial<SetupWorkflowDraft> = {},
): SetupWorkflowDraft => ({
  accountId: "account-a",
  gameId: "game-a",
  expectedSetupRevision: 2,
  clientSubmissionId: "submission-a",
  rulesetVersionId: "rules-a",
  managedTeamSeasonId: "team-season-a",
  managedSide: "HOME",
  scheduledAt: "2026-08-01T18:00",
  location: "Synthetic Field",
  weatherCondition: "CLEAR",
  temperatureF: 72,
  opponentKind: "MANAGED",
  opponentTeamSeasonId: "team-season-b",
  externalOpponentName: "",
  managedLineup: [managed("home-pitcher", 1, "PITCHER", true)],
  opponentManagedLineup: [managed("away-pitcher", 1, "PITCHER", true)],
  externalLineup: [],
  ...overrides,
});

describe("game setup workflow view model", () => {
  it("maps a home managed-opponent proposal into the immutable M1 command", () => {
    const command = buildSaveSetupCommand(readyDraft());
    expect(command).toMatchObject({
      accountId: "account-a",
      gameId: "game-a",
      expectedSetupRevision: 2,
      scheduledAt: "2026-08-01T18:00:00.000Z",
      sides: [
        {
          kind: "MANAGED",
          side: "HOME",
          teamSeasonId: "team-season-a",
          lineup: [
            {
              playerId: "home-pitcher",
              battingOrder: 1,
              defensivePosition: "PITCHER",
              isStartingPitcher: true,
            },
          ],
        },
        {
          kind: "MANAGED",
          side: "AWAY",
          teamSeasonId: "team-season-b",
        },
      ],
    });
  });

  it("maps an away game with a bounded external opponent", () => {
    const draft = readyDraft({
      managedSide: "AWAY",
      opponentKind: "EXTERNAL",
      opponentTeamSeasonId: null,
      externalOpponentName: "Visitors",
      opponentManagedLineup: [],
      externalLineup: [
        {
          kind: "EXTERNAL",
          clientId: "external-pitcher",
          displayName: "Pitcher 1",
          jerseyNumber: "8",
          battingOrder: 1,
          defensivePosition: "PITCHER",
          isStartingPitcher: true,
        },
      ],
    });
    const command = buildSaveSetupCommand(draft);
    expect(command.sides).toEqual([
      expect.objectContaining({ kind: "MANAGED", side: "AWAY" }),
      expect.objectContaining({
        kind: "EXTERNAL",
        side: "HOME",
        displayName: "Visitors",
        lineup: [
          expect.objectContaining({
            displayName: "Pitcher 1",
            jerseyNumber: "8",
          }),
        ],
      }),
    ]);
  });

  it("permits an incomplete draft save while blocking readiness", () => {
    const draft = readyDraft({
      opponentTeamSeasonId: null,
      managedLineup: [],
      opponentManagedLineup: [],
    });
    expect(validateSetupDraft(draft, { requireReady: false })).toEqual([]);
    expect(validateSetupDraft(draft, { requireReady: true })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "opponentTeamSeasonId" }),
        expect.objectContaining({ field: "managedLineup" }),
        expect.objectContaining({ field: "opponentLineup" }),
      ]),
    );
    expect(buildSaveSetupCommand(draft).sides).toHaveLength(1);
  });

  it("rejects contradictory participants, duplicate orders, and pitcher errors", () => {
    const draft = readyDraft({
      opponentTeamSeasonId: "team-season-a",
      managedLineup: [
        managed("one", 1, "PITCHER", true),
        managed("two", 1, "PITCHER", true),
      ],
    });
    const errors = validateSetupDraft(draft, { requireReady: true });
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "opponentTeamSeasonId" }),
        expect.objectContaining({
          field: "managedLineup",
          message: "Batting-order numbers must be unique.",
        }),
        expect.objectContaining({
          field: "managedLineup",
          message: "Choose exactly one starting pitcher.",
        }),
        expect.objectContaining({
          field: "managedLineup",
          message: "Conventional defensive positions must be unique.",
        }),
      ]),
    );
  });

  it("requires contiguous order and a pitcher assigned to pitcher", () => {
    const draft = readyDraft({
      managedLineup: [
        managed("one", 1, "CATCHER", true),
        managed("two", 3, "SHORTSTOP"),
      ],
    });
    const errors = validateSetupDraft(draft, { requireReady: true });
    expect(errors.map(({ message }) => message)).toContain(
      "Batting order must be contiguous starting at 1.",
    );
    expect(errors.map(({ message }) => message)).toContain(
      "The starting pitcher must be assigned to pitcher.",
    );
  });

  it("keeps a persisted but newly ineligible player visible as a readiness blocker", () => {
    const draft = readyDraft({
      managedLineup: [
        {
          ...managed("former-player", 1, "PITCHER", true),
          eligible: false,
        },
      ],
    });
    expect(validateSetupDraft(draft, { requireReady: true })).toEqual(
      expect.arrayContaining([
        {
          field: "managedLineup",
          message: "A selected player is no longer eligible.",
        },
      ]),
    );
  });

  it("strictly parses bounded draft data and routes errors to the right step", () => {
    expect(parseSetupWorkflowDraft(readyDraft())).toEqual(readyDraft());
    expect(() =>
      parseSetupWorkflowDraft({
        ...readyDraft(),
        privatePlayerNotes: "must not be accepted",
      }),
    ).toThrow();
    expect(
      firstStepForErrors([
        { field: "externalOpponentName", message: "Required" },
      ]),
    ).toBe("PARTICIPANTS");
    expect(
      firstStepForErrors([{ field: "managedLineup", message: "Required" }]),
    ).toBe("LINEUP");
  });
});
