import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  GameSetupWizard,
  LineupFields,
} from "@/components/game-setup/game-setup-wizard";
import type {
  ManagedLineupRow,
  SetupWorkflowDraft,
} from "@/features/game-setup/workflow";

const roster: ManagedLineupRow[] = [
  {
    kind: "MANAGED",
    selected: true,
    eligible: true,
    playerId: "pitcher",
    rosterEntryId: "roster-pitcher",
    displayName: "Pitcher 1",
    jerseyNumber: "8",
    battingOrder: 1,
    defensivePosition: "PITCHER",
    isStartingPitcher: true,
  },
  {
    kind: "MANAGED",
    selected: true,
    eligible: true,
    playerId: "catcher",
    rosterEntryId: "roster-catcher",
    displayName: "Catcher 2",
    jerseyNumber: "9",
    battingOrder: 2,
    defensivePosition: "CATCHER",
    isStartingPitcher: false,
  },
];

const draft: SetupWorkflowDraft = {
  accountId: "account-a",
  gameId: "game-a",
  expectedSetupRevision: 1,
  clientSubmissionId: "submission-a",
  rulesetVersionId: "rules-a",
  managedTeamSeasonId: "team-season-a",
  managedSide: "HOME",
  scheduledAt: "2026-08-01T18:00",
  location: "Synthetic Field",
  weatherCondition: null,
  temperatureF: null,
  opponentKind: "EXTERNAL",
  opponentTeamSeasonId: null,
  externalOpponentName: "Visitors",
  managedLineup: roster,
  opponentManagedLineup: [],
  externalLineup: [
    {
      kind: "EXTERNAL",
      clientId: "external-pitcher",
      displayName: "Pitcher A",
      jerseyNumber: null,
      battingOrder: 1,
      defensivePosition: "PITCHER",
      isStartingPitcher: true,
    },
  ],
};

describe("game setup components", () => {
  it("renders a labelled progress model, native form controls, and large actions", () => {
    const html = renderToStaticMarkup(
      <GameSetupWizard
        initialDraft={draft}
        initialGameStatus="DRAFT"
        managedTeamName="Home Team"
        rulesets={[{ id: "rules-a", label: "Standard · version 1" }]}
        seasonName="2026"
        teamSeasons={[{ id: "team-season-a", teamName: "Home Team", roster }]}
      />,
    );
    expect(html).toContain('aria-label="Game setup progress"');
    expect(html).toContain('aria-current="step"');
    expect(html).toContain('type="datetime-local"');
    expect(html).toContain("Game date and time (UTC)");
    expect(html).toContain("min-h-12");
    expect(html).toContain("grid-cols-2");
    expect(html).toContain("sm:grid-cols-4");
    expect(html).not.toContain("<table");
  });

  it("uses keyboard-operable lineup controls instead of pointer-only reordering", () => {
    const html = renderToStaticMarkup(
      <LineupFields
        heading="Home Team"
        immutable={false}
        onChange={vi.fn()}
        onRowsChange={vi.fn()}
        rows={roster}
      />,
    );
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('type="number"');
    expect(html).toContain("<select");
    expect(html).toContain("Move Pitcher 1 down");
    expect(html).toContain("Move Catcher 2 up");
    expect(html).toContain("Starting pitcher");
    expect(html).toContain("Use native controls");
  });

  it("keeps started setup controls disabled", () => {
    const html = renderToStaticMarkup(
      <GameSetupWizard
        initialDraft={draft}
        initialGameStatus="IN_PROGRESS"
        managedTeamName="Home Team"
        rulesets={[{ id: "rules-a", label: "Standard · version 1" }]}
        seasonName="2026"
        teamSeasons={[{ id: "team-season-a", teamName: "Home Team", roster }]}
      />,
    );
    expect(html).toContain("Game in progress");
    expect(html).toContain('disabled=""');
    expect(html).not.toContain('value="READY"');
    expect(html).not.toContain('value="START"');
  });

  it("labels a resumed ineligible player without hiding the snapshot row", () => {
    const html = renderToStaticMarkup(
      <LineupFields
        heading="Home Team"
        immutable={false}
        onChange={vi.fn()}
        onRowsChange={vi.fn()}
        rows={[{ ...roster[0]!, eligible: false }]}
      />,
    );
    expect(html).toContain("Pitcher 1");
    expect(html).toContain("No longer eligible");
    expect(html).toContain('disabled=""');
  });
});
