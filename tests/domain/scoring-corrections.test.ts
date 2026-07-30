import { describe, expect, it } from "vitest";

import {
  buildCorrectionAudit,
  buildCorrectionPayload,
  buildRecentPlayHistory,
  countRecentPlayHistory,
  previewCorrection,
  type CorrectionDraft,
} from "@/features/scoring/scoring-corrections";
import {
  ScoringFixtureBuilder,
  createScoringSetup,
  currentFixtureBatter,
  fixturePlayer,
  plateAppearance,
  routineOut,
  runnerMovement,
} from "../fixtures/scoring-fixture-builder";

function draft(
  targetEventId: string,
  overrides: Partial<CorrectionDraft> = {},
): CorrectionDraft {
  return {
    targetEventId,
    action: "REPLACE_PLATE_JUDGMENT",
    replacementOutcome: "REACHED_ON_ERROR",
    errorFielderId: "home-batter-1",
    reasonCode: "SCORING_JUDGMENT",
    replacementId: "replacement-a",
    ...overrides,
  };
}

function single(builder: ScoringFixtureBuilder) {
  const batter = currentFixtureBatter(builder.state());
  const pitcher = builder.state().activePitcher.HOME;
  const event = builder.append(
    plateAppearance(batter, pitcher, "SINGLE", [
      runnerMovement(batter, "BATTER", "FIRST", pitcher, { cause: "HIT" }),
    ]),
    "single",
  );
  if (event.eventType !== "PlateAppearanceRecorded") {
    throw new Error("Expected plate appearance fixture.");
  }
  return event;
}

function appendThreeOuts(builder: ScoringFixtureBuilder) {
  for (let count = 0; count < 3; count += 1) {
    const state = builder.state();
    const defense = state.half === "TOP" ? "HOME" : "AWAY";
    builder.append(routineOut(state, state.defense[defense].CATCHER!));
  }
}

describe("scoring correction presentation and preview", () => {
  it("builds deterministic human-readable recent history without raw JSON", () => {
    const builder = new ScoringFixtureBuilder();
    builder.start();
    const original = single(builder);
    const names = {
      [currentFixtureBatter(builder.state())]: "Next Batter",
      [original.payload.batterId]: "Avery Hitter",
    };

    const history = buildRecentPlayHistory(
      builder.setup,
      builder.events(),
      names,
    );
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      id: original.id,
      sequence: 2,
      inning: 1,
      half: "TOP",
      baseballIdentity: "Avery Hitter",
      correctionState: "UNCORRECTED",
      status: "CURRENT",
      scoreEffect: { AWAY: 0, HOME: 0 },
      outEffect: 0,
      canReplaceJudgment: true,
    });
    expect(history[0]!.outcome).toContain("single");
    expect(JSON.stringify(history[0])).not.toContain('"payload"');
  });

  it("paginates recent history after deterministic sequence ordering", () => {
    const builder = new ScoringFixtureBuilder();
    builder.start();
    appendThreeOuts(builder);

    expect(countRecentPlayHistory(builder.events())).toBe(3);
    expect(
      buildRecentPlayHistory(
        builder.setup,
        builder.events(),
        {},
        {
          offset: 1,
          limit: 1,
        },
      ).map(({ sequence }) => sequence),
    ).toEqual([3]);
  });

  it("previews corrected state and batting, pitching, and fielding statistics", () => {
    const builder = new ScoringFixtureBuilder();
    builder.start();
    const original = single(builder);
    const fielder = fixturePlayer(builder.setup, "HOME", 1);
    const payload = buildCorrectionPayload(
      builder.events(),
      draft(original.id, { errorFielderId: fielder }),
    );

    const preview = previewCorrection(builder.setup, builder.events(), payload);
    expect(preview.sourceRevision).toBe(2);
    expect(preview.score.after).toEqual(preview.score.before);
    expect(preview.changedBatting).toContainEqual(
      expect.objectContaining({
        playerId: original.payload.batterId,
        before: expect.stringContaining("1 H"),
        after: expect.stringContaining("0 H"),
      }),
    );
    expect(preview.changedPitching).toContainEqual(
      expect.objectContaining({
        playerId: original.payload.pitcherId,
        before: expect.stringContaining("1 H"),
        after: expect.stringContaining("0 H"),
      }),
    );
    expect(preview.changedFielding).toContainEqual(
      expect.objectContaining({
        playerId: fielder,
        before: expect.stringContaining("0 E"),
        after: expect.stringContaining("1 E"),
      }),
    );
  });

  it("preserves corrected versus original summaries and immutable audit attribution", () => {
    const builder = new ScoringFixtureBuilder();
    builder.start();
    const original = single(builder);
    const fielder = fixturePlayer(builder.setup, "HOME", 1);
    const correction = builder.append({
      eventType: "CorrectionApplied",
      payload: buildCorrectionPayload(
        builder.events(),
        draft(original.id, { errorFielderId: fielder }),
      ),
    });

    const history = buildRecentPlayHistory(builder.setup, builder.events(), {
      [original.payload.batterId]: "Avery Hitter",
    });
    const originalSummary = history.find(({ id }) => id === original.id);
    expect(originalSummary).toMatchObject({
      outcome: expect.stringContaining("single"),
      correctedOutcome: expect.stringContaining("reached on error"),
      correctionState: "CORRECTED",
      status: "SUPERSEDED",
    });
    expect(history[0]).toMatchObject({
      id: correction.id,
      correctionState: "CORRECTION",
      status: "CURRENT",
    });
    expect(buildCorrectionAudit(builder.setup, builder.events())).toEqual([
      expect.objectContaining({
        correctionEventId: correction.id,
        reasonCode: "SCORING_JUDGMENT",
        targetEventIds: [original.id],
        sourceRevision: { before: 2, after: 3 },
      }),
    ]);
  });

  it("reconstructs the exact accepted payload for an idempotent lost-response retry", () => {
    const builder = new ScoringFixtureBuilder();
    builder.start();
    const original = single(builder);
    const fielder = fixturePlayer(builder.setup, "HOME", 1);
    const exactDraft = draft(original.id, { errorFielderId: fielder });
    const firstPayload = buildCorrectionPayload(builder.events(), exactDraft);
    builder.append({
      eventType: "CorrectionApplied",
      payload: firstPayload,
    });

    expect(
      buildCorrectionPayload(builder.events(), exactDraft, {
        allowSuperseded: true,
      }),
    ).toEqual(firstPayload);
    expect(() =>
      buildCorrectionPayload(builder.events(), exactDraft),
    ).toThrowError(
      expect.objectContaining({
        code: "TARGET_UNAVAILABLE",
      }),
    );
  });

  it("reverses a current correction while retaining both audit events", () => {
    const builder = new ScoringFixtureBuilder();
    builder.start();
    const original = single(builder);
    const firstCorrection = builder.append({
      eventType: "CorrectionApplied",
      payload: buildCorrectionPayload(
        builder.events(),
        draft(original.id, {
          errorFielderId: fixturePlayer(builder.setup, "HOME", 1),
        }),
      ),
    });
    const reversal = builder.append({
      eventType: "CorrectionApplied",
      payload: buildCorrectionPayload(
        builder.events(),
        draft(firstCorrection.id, {
          action: "REVERSE_EVENT",
          replacementOutcome: null,
          errorFielderId: null,
          replacementId: "unused-reversal-replacement",
        }),
      ),
    });

    const history = buildRecentPlayHistory(builder.setup, builder.events(), {});
    expect(history.find(({ id }) => id === original.id)).toMatchObject({
      status: "CURRENT",
      correctionState: "UNCORRECTED",
      correctedOutcome: null,
    });
    expect(history.find(({ id }) => id === firstCorrection.id)).toMatchObject({
      status: "SUPERSEDED",
      correctedOutcome: "event reversed without replacement",
    });
    expect(history[0]).toMatchObject({
      id: reversal.id,
      status: "CURRENT",
      correctionState: "CORRECTION",
    });
    expect(buildCorrectionAudit(builder.setup, builder.events())).toHaveLength(
      2,
    );
  });

  it("requires a supported reason, confirmation-layer selection, and a current target", () => {
    const builder = new ScoringFixtureBuilder();
    builder.start();
    const original = single(builder);
    expect(() =>
      buildCorrectionPayload(builder.events(), {
        ...draft(original.id),
        reasonCode: "" as CorrectionDraft["reasonCode"],
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "INVALID_SELECTION",
      }),
    );
    expect(() =>
      buildCorrectionPayload(builder.events(), draft("another-game-event")),
    ).toThrowError(
      expect.objectContaining({
        code: "TARGET_UNAVAILABLE",
      }),
    );
  });

  it("requires explicit reopen before previewing a verified game correction", () => {
    const builder = new ScoringFixtureBuilder(
      createScoringSetup({ scheduledInnings: 1 }),
    );
    builder.start();
    appendThreeOuts(builder);
    const state = builder.state();
    const batter = currentFixtureBatter(state);
    const pitcher = state.activePitcher.AWAY;
    const homeRun = builder.append(
      plateAppearance(batter, pitcher, "HOME_RUN", [
        runnerMovement(batter, "BATTER", "HOME", pitcher, {
          cause: "HIT",
        }),
      ]),
    );
    appendThreeOuts(builder);
    builder.append({
      eventType: "GameCompleted",
      payload: { reasonCode: "REGULATION", ending: "REGULATION" },
    });
    builder.append({ eventType: "GameVerified", payload: {} });
    const payload = buildCorrectionPayload(
      builder.events(),
      draft(homeRun.id, {
        action: "REVERSE_EVENT",
        replacementOutcome: null,
        errorFielderId: null,
      }),
    );

    expect(() =>
      previewCorrection(builder.setup, builder.events(), payload),
    ).toThrowError(
      expect.objectContaining({
        code: "REOPEN_REQUIRED",
      }),
    );

    builder.append({
      eventType: "GameReopened",
      payload: { reasonCode: "SCORER_REVIEW" },
    });
    const reopenedPayload = buildCorrectionPayload(
      builder.events(),
      draft(homeRun.id, {
        replacementOutcome: "HOME_RUN",
        errorFielderId: null,
      }),
    );
    expect(
      previewCorrection(builder.setup, builder.events(), reopenedPayload)
        .verificationEffect,
    ).toBe("REQUIRES_VERIFICATION");
    const correction = builder.append({
      eventType: "CorrectionApplied",
      payload: reopenedPayload,
    });
    expect(
      buildCorrectionAudit(builder.setup, builder.events())[0],
    ).toMatchObject({
      correctionEventId: correction.id,
      verificationEffect: "INVALIDATED_REQUIRES_REVERIFICATION",
    });
  });
});
