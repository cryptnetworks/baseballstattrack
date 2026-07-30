import { describe, expect, it } from "vitest";

import {
  createPlateAppearanceDraft,
  plateOutcomeForShortcut,
  previewPlateAppearance,
  type PlateOutcome,
} from "@/features/scoring/plate-appearance";
import {
  ScoringFixtureBuilder,
  currentFixtureBatter,
  fixturePlayer,
  plateAppearance,
  routineOut,
  runnerMovement,
} from "../fixtures/scoring-fixture-builder";

function defender(builder: ScoringFixtureBuilder, side: "HOME" | "AWAY") {
  return fixturePlayer(builder.setup, side, 1);
}

function validPreview(builder: ScoringFixtureBuilder, outcome: PlateOutcome) {
  const state = builder.state();
  const draft = createPlateAppearanceDraft(state, outcome);
  if (
    [
      "BATTER_OUT",
      "STRIKEOUT_SWINGING",
      "STRIKEOUT_LOOKING",
      "SACRIFICE_BUNT",
      "SACRIFICE_FLY",
    ].includes(outcome)
  ) {
    draft.putoutFielderId = defender(
      builder,
      state.half === "TOP" ? "HOME" : "AWAY",
    );
  }
  if (outcome === "REACHED_ON_ERROR") {
    draft.errorFielderId = defender(
      builder,
      state.half === "TOP" ? "HOME" : "AWAY",
    );
  }
  draft.earnedRuns = Object.fromEntries(
    Object.keys(draft.earnedRuns).map((origin) => [origin, "EARNED"]),
  );
  if (outcome === "HOME_RUN") draft.earnedRuns.BATTER = "EARNED";
  return previewPlateAppearance(state, draft);
}

describe("fast plate-appearance interaction model", () => {
  it("maps documented keyboard shortcuts to outcomes", () => {
    expect(plateOutcomeForShortcut("K")).toBe("STRIKEOUT_SWINGING");
    expect(plateOutcomeForShortcut("1")).toBe("SINGLE");
    expect(plateOutcomeForShortcut("4")).toBe("HOME_RUN");
    expect(plateOutcomeForShortcut("?")).toBeNull();
  });

  it.each([
    "BATTER_OUT",
    "STRIKEOUT_SWINGING",
    "WALK",
    "HIT_BY_PITCH",
    "SINGLE",
    "DOUBLE",
    "TRIPLE",
    "HOME_RUN",
    "REACHED_ON_ERROR",
  ] as const)("builds and accepts common outcome %s", (outcome) => {
    const builder = new ScoringFixtureBuilder();
    builder.start();
    const preview = validPreview(builder, outcome);
    expect(preview.errors).toEqual([]);
    expect(preview.body?.payload.outcome).toBe(outcome);
    builder.append(preview.body!);
    expect(builder.state().sourceRevision).toBe(2);
  });

  it("advances forced runners on a bases-loaded walk with RBI and run attribution", () => {
    const builder = new ScoringFixtureBuilder();
    builder.start();
    const pitcher = builder.state().activePitcher.HOME;
    const first = currentFixtureBatter(builder.state());
    builder.append(
      plateAppearance(first, pitcher, "SINGLE", [
        runnerMovement(first, "BATTER", "FIRST", pitcher, { cause: "HIT" }),
      ]),
    );
    const second = currentFixtureBatter(builder.state());
    builder.append(
      plateAppearance(second, pitcher, "SINGLE", [
        runnerMovement(first, "FIRST", "SECOND", pitcher),
        runnerMovement(second, "BATTER", "FIRST", pitcher, { cause: "HIT" }),
      ]),
    );
    const third = currentFixtureBatter(builder.state());
    builder.append(
      plateAppearance(third, pitcher, "SINGLE", [
        runnerMovement(first, "SECOND", "THIRD", pitcher),
        runnerMovement(second, "FIRST", "SECOND", pitcher),
        runnerMovement(third, "BATTER", "FIRST", pitcher, { cause: "HIT" }),
      ]),
    );

    const fourth = currentFixtureBatter(builder.state());
    const preview = validPreview(builder, "WALK");
    expect(preview.errors).toEqual([]);
    expect(
      preview.body?.payload.movements.filter(({ forced }) => forced),
    ).toHaveLength(4);
    expect(preview.runs).toBe(1);
    builder.append(preview.body!);
    expect(builder.state()).toMatchObject({
      score: { AWAY: 1, HOME: 0 },
      bases: {
        FIRST: fourth,
        SECOND: third,
        THIRD: second,
      },
    });
    expect(
      builder.statistics().batting.find(({ playerId }) => playerId === fourth)
        ?.counters.runsBattedIn,
    ).toBe(1);
  });

  it("integrates optional runner advancement and rejects runner passing", () => {
    const builder = new ScoringFixtureBuilder();
    builder.start();
    const firstPreview = validPreview(builder, "SINGLE");
    builder.append(firstPreview.body!);
    const runner = builder.state().bases.FIRST!;

    const singleDraft = createPlateAppearanceDraft(builder.state(), "SINGLE");
    singleDraft.outcomes.FIRST = "THIRD";
    const single = previewPlateAppearance(builder.state(), singleDraft);
    expect(single.errors).toEqual([]);
    builder.append(single.body!);
    expect(builder.state().bases.THIRD).toBe(runner);

    const passing = new ScoringFixtureBuilder();
    passing.start();
    passing.append(validPreview(passing, "SINGLE").body!);
    const doubleDraft = createPlateAppearanceDraft(passing.state(), "DOUBLE");
    doubleDraft.outcomes.FIRST = "REMAINS";
    expect(
      previewPlateAppearance(passing.state(), doubleDraft).errors,
    ).toContain("A runner cannot pass another runner.");
  });

  it("builds a double play as one event and preserves state on invalid atomic input", () => {
    const builder = new ScoringFixtureBuilder();
    builder.start();
    builder.append(validPreview(builder, "SINGLE").body!);
    const before = builder.state();
    const draft = createPlateAppearanceDraft(before, "BATTER_OUT");
    draft.outcomes.FIRST = "OUT";
    draft.forceOuts.FIRST = true;
    draft.putoutFielderId = defender(builder, "HOME");
    const preview = previewPlateAppearance(before, draft);
    expect(preview.errors).toEqual([]);
    expect(
      preview.body?.payload.movements.filter(({ to }) => to === "OUT"),
    ).toHaveLength(2);
    builder.append(preview.body!);
    expect(builder.state().outs).toBe(2);

    const invalid = new ScoringFixtureBuilder();
    invalid.start();
    invalid.append(validPreview(invalid, "SINGLE").body!);
    const invalidBefore = invalid.state();
    const badDraft = createPlateAppearanceDraft(invalidBefore, "DOUBLE");
    badDraft.outcomes.FIRST = "REMAINS";
    const bad = previewPlateAppearance(invalidBefore, badDraft);
    expect(bad.body).toBeNull();
    expect(invalid.state()).toEqual(invalidBefore);
  });

  it("requires fielder attribution and maps complex scorer judgments into the typed proposal", () => {
    const builder = new ScoringFixtureBuilder();
    builder.start();
    const out = previewPlateAppearance(
      builder.state(),
      createPlateAppearanceDraft(builder.state(), "BATTER_OUT"),
    );
    expect(out.errors).toContain("Select the fielder receiving the putout.");

    const errorDraft = createPlateAppearanceDraft(
      builder.state(),
      "REACHED_ON_ERROR",
    );
    expect(
      previewPlateAppearance(builder.state(), errorDraft).errors,
    ).toContain("Select the fielder charged with the error.");
    errorDraft.errorFielderId = defender(builder, "HOME");
    const error = previewPlateAppearance(builder.state(), errorDraft);
    expect(error.body?.payload.fieldingCredits).toEqual([
      {
        fielderId: defender(builder, "HOME"),
        credit: "ERROR",
        errorType: "FIELDING",
      },
    ]);
  });

  it("rejects sacrifice classification with two outs in preview and reducer", () => {
    const builder = new ScoringFixtureBuilder();
    builder.start();
    const putout = defender(builder, "HOME");
    builder.append(routineOut(builder.state(), putout));
    builder.append(routineOut(builder.state(), putout));
    const state = builder.state();
    const draft = createPlateAppearanceDraft(state, "SACRIFICE_BUNT");
    draft.putoutFielderId = putout;
    expect(previewPlateAppearance(state, draft).errors).toContain(
      "A sacrifice cannot be recorded with two outs.",
    );
    const batter = currentFixtureBatter(state);
    expect(() =>
      builder.append(
        plateAppearance(batter, state.activePitcher.HOME, "SACRIFICE_BUNT", [
          runnerMovement(batter, "BATTER", "OUT", state.activePitcher.HOME, {
            cause: "SACRIFICE",
            out: {
              outNumber: 3,
              force: true,
              fielders: [putout],
            },
          }),
        ]),
      ),
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_BASEBALL_TRANSITION" }),
    );
  });
});
