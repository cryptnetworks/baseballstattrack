import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { ScoringCorrectionsPanel } from "@/components/scoring/scoring-corrections-panel";

const history = [
  {
    id: "event-a",
    sequence: 8,
    eventType: "PlateAppearanceRecorded",
    inning: 3,
    half: "TOP" as const,
    baseballIdentity: "Avery Hitter",
    outcome: "single · Avery Hitter batter to first",
    correctedOutcome: "reached on error · Avery Hitter batter to first",
    scoreEffect: { HOME: 0, AWAY: 0 },
    outEffect: 0,
    correctionState: "CORRECTED" as const,
    status: "CURRENT" as const,
    actorReference: "user scorer-a",
    acceptedAt: "2026-07-30T18:00:00.000Z",
    canReplaceJudgment: true,
    replacementOutcomes: ["SINGLE", "REACHED_ON_ERROR"],
    eligibleFielderIds: ["fielder-a"],
  },
];

describe("scoring correction UX", () => {
  it("renders accessible history, explicit correction controls, and audit separation", () => {
    const html = renderToStaticMarkup(
      createElement(ScoringCorrectionsPanel, {
        accountId: "account-a",
        audit: [
          {
            correctionEventId: "correction-a",
            sequence: 9,
            actorReference: "user scorer-a",
            reasonCode: "SCORING_JUDGMENT",
            occurredAt: "2026-07-30T18:01:00.000Z",
            targetEventIds: ["event-a"],
            sourceRevision: { before: 8, after: 9 },
            verificationEffect: "REQUIRES_VERIFICATION",
            status: "CURRENT",
          },
        ],
        gameId: "game-a",
        gameStatus: "CORRECTED",
        history,
        page: 0,
        pageCount: 2,
        playerNames: {
          "fielder-a": "Finley Fielder",
        },
        setupSnapshotId: "setup-a",
        sourceRevision: 9,
        submission: {
          eventId: "correction-next",
          playTransactionId: "correction-transaction",
          idempotencyKey: "correction-submission",
          replacementId: "correction-replacement",
          recordedAt: "2026-07-30T18:02:00.000Z",
        },
      }),
    );
    expect(html).toContain('aria-labelledby="corrections-heading"');
    expect(html).toContain("Recent plays and corrections");
    expect(html).toContain("Avery Hitter");
    expect(html).toContain("Corrected judgment");
    expect(html).toContain("Original retained above for audit.");
    expect(html).toContain("Build a correction");
    expect(html).toContain("Preview downstream impact");
    expect(html).toContain("Correction audit");
    expect(html).toContain(
      "Security audit records remain separate and are not exposed here.",
    );
    expect(html).toContain('aria-label="Recent play history pages"');
    expect(html).toContain("Older plays");
    expect(html).toContain("sm:grid-cols-2");
    expect(html).not.toContain('"payload"');
  });

  it("requires explicit acknowledgement before a verified game is reopened", () => {
    const html = renderToStaticMarkup(
      createElement(ScoringCorrectionsPanel, {
        accountId: "account-a",
        audit: [],
        gameId: "game-a",
        gameStatus: "VERIFIED",
        history,
        page: 0,
        pageCount: 1,
        playerNames: {},
        setupSnapshotId: "setup-a",
        sourceRevision: 10,
        submission: {
          eventId: "reopen-a",
          playTransactionId: "reopen-transaction",
          idempotencyKey: "reopen-submission",
          replacementId: "unused-replacement",
          recordedAt: "2026-07-30T18:03:00.000Z",
        },
      }),
    );
    expect(html).toContain("Reopen required");
    expect(html).toContain("must be verified again");
    expect(html).toContain('name="confirmed"');
    expect(html).toContain("required");
    expect(html).toContain("Reopen for correction");
    expect(html).not.toContain("Build a correction");
  });
});
