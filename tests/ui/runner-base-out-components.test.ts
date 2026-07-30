import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  BaseState,
  RunnerBaseOutPanel,
} from "@/components/scoring/runner-base-out-panel";
import { LiveLineupChangesPanel } from "@/components/scoring/live-lineup-changes-panel";
import { PlateAppearancePanel } from "@/components/scoring/plate-appearance-panel";
import {
  ScoringFixtureBuilder,
  currentFixtureBatter,
  plateAppearance,
  runnerMovement,
} from "../fixtures/scoring-fixture-builder";

function stateWithRunner() {
  const builder = new ScoringFixtureBuilder();
  builder.start();
  const state = builder.state();
  const runner = currentFixtureBatter(state);
  const pitcher = state.activePitcher.HOME;
  builder.append(
    plateAppearance(runner, pitcher, "SINGLE", [
      runnerMovement(runner, "BATTER", "FIRST", pitcher, { cause: "HIT" }),
    ]),
  );
  return { state: builder.state(), runner };
}

describe("runner base-out components", () => {
  it("pairs the visual diamond with named semantic base occupancy", () => {
    const { state, runner } = stateWithRunner();
    const html = renderToStaticMarkup(
      createElement(BaseState, {
        bases: state.bases,
        heading: "Authoritative",
        playerNames: { [runner]: "Avery Runner" },
      }),
    );
    expect(html).toContain('aria-label="Authoritative base occupancy"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("first");
    expect(html).toContain("Avery Runner");
    expect(html).toContain("Empty");
  });

  it("renders one atomic proposal, explicit before/after state, and live announcements", () => {
    const { state, runner } = stateWithRunner();
    const catcher = state.defense.HOME.CATCHER!;
    const html = renderToStaticMarkup(
      createElement(RunnerBaseOutPanel, {
        accountId: state.accountId,
        defenders: [{ id: catcher, label: "Home Catcher · catcher" }],
        gameId: state.gameId,
        initialClientSubmissionId: "submission-ui",
        playerNames: {
          [runner]: "Avery Runner",
          [catcher]: "Home Catcher",
          [state.activePitcher.HOME]: "Home Pitcher",
        },
        setupSnapshotId: state.setupSnapshotId,
        state,
      }),
    );
    expect(html).toContain("Before");
    expect(html).toContain("Proposed after");
    expect(html).toContain("Atomic runner play");
    expect(html).toContain("accepted together");
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Responsible pitcher");
    expect(html).toContain("Record complete runner play");
    expect(html).toContain("Optional / scorer selected");
  });

  it("renders touch and keyboard optimized plate-appearance actions with authoritative context", () => {
    const builder = new ScoringFixtureBuilder();
    builder.start();
    const state = builder.state();
    const batter = currentFixtureBatter(state);
    const catcher = state.defense.HOME.CATCHER!;
    const html = renderToStaticMarkup(
      createElement(PlateAppearancePanel, {
        accountId: state.accountId,
        gameId: state.gameId,
        setupSnapshotId: state.setupSnapshotId,
        state,
        playerNames: {
          [batter]: "Current Batter",
          [catcher]: "Home Catcher",
          [state.activePitcher.HOME]: "Home Pitcher",
        },
        defenders: [{ id: catcher, label: "Home Catcher · catcher" }],
        initialClientSubmissionId: "plate-submission-ui",
        lastAcceptedAction: "game started",
      }),
    );
    expect(html).toContain("Record plate appearance");
    expect(html).toContain("Current Batter");
    expect(html).toContain("Home Pitcher");
    expect(html).toContain("Common outcomes");
    expect(html).toContain("More outcomes");
    expect(html).toContain('aria-keyshortcuts="k"');
    expect(html).toContain("min-h-14");
    expect(html).toContain("grid-cols-2");
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Last accepted: game started");
    expect(html).toContain('href="#runner-only-actions"');
  });

  it("renders an accessible confirmed-change flow with lineup and pitching context", () => {
    const builder = new ScoringFixtureBuilder();
    builder.start();
    const state = builder.state();
    const playerNames = Object.fromEntries(
      [...state.lineups.HOME, ...state.lineups.AWAY].map(({ playerId }) => [
        playerId,
        playerId.replaceAll("-", " "),
      ]),
    );
    const html = renderToStaticMarkup(
      createElement(LiveLineupChangesPanel, {
        accountId: state.accountId,
        gameId: state.gameId,
        setupSnapshotId: state.setupSnapshotId,
        state,
        playerNames,
        initialClientSubmissionId: "lineup-submission-ui",
      }),
    );
    expect(html).toContain("Lineup and pitching changes");
    expect(html).toContain("Batter / runner");
    expect(html).toContain("Defensive replacement");
    expect(html).toContain("Position swap");
    expect(html).toContain("Pitching change");
    expect(html).toContain("Authoritative before");
    expect(html).toContain("Resulting lineup and defense");
    expect(html).toContain("Confirm the leaving player");
    expect(html).toContain("min-h-12");
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain(`revision ${state.sourceRevision}`);
  });
});
