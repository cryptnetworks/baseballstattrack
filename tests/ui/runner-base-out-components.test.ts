import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  BaseState,
  RunnerBaseOutPanel,
} from "@/components/scoring/runner-base-out-panel";
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
});
