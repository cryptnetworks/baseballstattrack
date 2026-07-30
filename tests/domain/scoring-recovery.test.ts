import { describe, expect, it } from "vitest";

import {
  SCORING_DRAFT_SCHEMA_VERSION,
  SCORING_RECOVERY_PHASES,
  classifyRecoveryFailure,
  createStoredScoringDraft,
  decideStoredDraft,
  idempotencyKeyForProposal,
  parseStoredScoringDraft,
  scoringDraftStorageKey,
  serializeStoredScoringDraft,
  shouldWarnForScoringNavigation,
  storedDraftBlocksNewEditor,
  type RecoverableScoringBody,
  type RecoveryContext,
} from "@/features/scoring/scoring-recovery";

const proposal: RecoverableScoringBody = {
  eventType: "PitchingChangeMade",
  payload: {
    side: "HOME",
    outgoingPitcherId: "starter",
    incomingPitcherId: "reliever",
    inheritedRunnerIds: ["runner-on-first"],
  },
};

const draft = createStoredScoringDraft({
  kind: "LINEUP_CHANGE",
  accountId: "account-a",
  gameId: "game-a",
  setupSnapshotId: "setup-a",
  setupRevision: 2,
  expectedSourceRevision: 8,
  idempotencyKey: "recovery-key",
  proposal,
  createdAt: "2026-07-30T12:00:00.000Z",
});

const context = (
  overrides: Partial<RecoveryContext> = {},
): RecoveryContext => ({
  accountId: "account-a",
  gameId: "game-a",
  setupSnapshotId: "setup-a",
  setupRevision: 2,
  sourceRevision: 8,
  acceptedSubmissionIds: [],
  ...overrides,
});

describe("scoring interruption recovery", () => {
  it("round-trips a typed unaccepted draft for refresh recovery", () => {
    const parsed = parseStoredScoringDraft(serializeStoredScoringDraft(draft));
    expect(parsed).toEqual({ ok: true, draft });
    if (!parsed.ok) throw new Error("Expected valid draft.");
    expect(decideStoredDraft(parsed.draft, context())).toMatchObject({
      status: "RECOVERABLE",
      draft: {
        idempotencyKey: "recovery-key",
        expectedSourceRevision: 8,
      },
    });
  });

  it("reconciles a lost response when the server already accepted the idempotency key", () => {
    expect(
      decideStoredDraft(
        draft,
        context({ acceptedSubmissionIds: ["recovery-key"] }),
      ).status,
    ).toBe("ACCEPTED");
  });

  it("requires reconciliation after a second scorer advances the source revision", () => {
    expect(
      decideStoredDraft(draft, context({ sourceRevision: 9 })).status,
    ).toBe("STALE");
  });

  it("rejects cross-Account, wrong-game, and replaced-setup drafts", () => {
    expect(
      decideStoredDraft(draft, context({ accountId: "account-b" })).status,
    ).toBe("CROSS_ACCOUNT");
    expect(decideStoredDraft(draft, context({ gameId: "game-b" })).status).toBe(
      "WRONG_GAME",
    );
    expect(
      decideStoredDraft(draft, context({ setupSnapshotId: "setup-replaced" }))
        .status,
    ).toBe("SETUP_CHANGED");
  });

  it("fails closed for malformed, old-schema, and unsupported stored data", () => {
    expect(parseStoredScoringDraft("{not-json")).toEqual({
      ok: false,
      reason: "MALFORMED",
    });
    expect(
      parseStoredScoringDraft(JSON.stringify({ ...draft, schemaVersion: 0 })),
    ).toEqual({ ok: false, reason: "OLD_SCHEMA" });
    expect(
      parseStoredScoringDraft(
        JSON.stringify({
          ...draft,
          proposal: { eventType: "GameCompleted", payload: {} },
        }),
      ),
    ).toEqual({ ok: false, reason: "UNSUPPORTED_EVENT" });
    expect(
      parseStoredScoringDraft(
        JSON.stringify({ ...draft, kind: "PLATE_APPEARANCE" }),
      ),
    ).toEqual({ ok: false, reason: "UNSUPPORTED_EVENT" });
  });

  it("uses Account/game/kind-scoped storage keys and stores no names, contacts, or secrets", () => {
    expect(scoringDraftStorageKey("account-a", "game-a", "RUNNER_PLAY")).toBe(
      "baseballstattrack:scoring-draft:v1:account-a:game-a:RUNNER_PLAY",
    );
    const serialized = serializeStoredScoringDraft(draft);
    expect(serialized).not.toMatch(
      /displayName|email|phone|token|secret|notes|dateOfBirth/i,
    );
    expect(serialized).toContain('"schemaVersion":1');
  });

  it("defines every recovery phase and classifies actionable failures", () => {
    expect(SCORING_RECOVERY_PHASES).toEqual([
      "EDITING",
      "LOCALLY_PENDING",
      "SUBMITTING",
      "ACCEPTED",
      "RETRYABLE_FAILURE",
      "STALE_CONFLICT",
      "TERMINAL_REJECTION",
      "RECONCILED",
      "ABANDONED_LOCAL_DRAFT",
    ]);
    expect(classifyRecoveryFailure("NETWORK_FAILURE")).toBe(
      "RETRYABLE_FAILURE",
    );
    expect(classifyRecoveryFailure("STALE_SOURCE_REVISION")).toBe(
      "STALE_CONFLICT",
    );
    expect(classifyRecoveryFailure("INVALID_LINEUP")).toBe(
      "TERMINAL_REJECTION",
    );
    expect(draft.schemaVersion).toBe(SCORING_DRAFT_SCHEMA_VERSION);
  });

  it("warns for route navigation but not an in-page scoring jump", () => {
    const current = "https://score.test/games/score/game-a";
    expect(
      shouldWarnForScoringNavigation(
        current,
        `${current}#runner-only-actions`,
        true,
      ),
    ).toBe(false);
    expect(shouldWarnForScoringNavigation(current, "/accounts", true)).toBe(
      true,
    );
    expect(shouldWarnForScoringNavigation(current, "/accounts", false)).toBe(
      false,
    );
  });

  it("retains the key for an exact retry and rotates it for a changed proposal", () => {
    expect(
      idempotencyKeyForProposal(
        '{"outcome":"SINGLE"}',
        '{"outcome":"SINGLE"}',
        "original-key",
        () => "new-key",
      ),
    ).toBe("original-key");
    expect(
      idempotencyKeyForProposal(
        '{"outcome":"SINGLE"}',
        '{"outcome":"DOUBLE"}',
        "original-key",
        () => "new-key",
      ),
    ).toBe("new-key");
  });

  it("blocks a new editor from overwriting a recovered or malformed draft", () => {
    const stored = serializeStoredScoringDraft(draft);
    expect(storedDraftBlocksNewEditor(stored, "different-key")).toBe(true);
    expect(storedDraftBlocksNewEditor(stored, "recovery-key")).toBe(false);
    expect(storedDraftBlocksNewEditor("{malformed", "recovery-key")).toBe(true);
    expect(storedDraftBlocksNewEditor(null, "new-key")).toBe(false);
  });
});
