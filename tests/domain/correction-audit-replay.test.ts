import { describe, expect, it, vi } from "vitest";

import {
  CorrectionWorkflowError,
  parseCorrectionCommand,
  requireCorrectionActor,
} from "@/domain/corrections";
import { CorrectionAuditReplayService } from "@/server/app/correction-audit-replay-service";
import type { PrismaGameEventRepository } from "@/server/data/game-event-repository";
import { trustedActorForTest } from "../fixtures/trusted-actor";

const command = {
  action: "APPLY_CORRECTION",
  accountId: "account-a",
  gameId: "game-a",
  setupSnapshotId: "setup-a",
  expectedSourceRevision: 4,
  eventId: "correction-a",
  playTransactionId: "transaction-a",
  idempotencyKey: "submission-a",
  correlationId: "correlation-a",
  recordedAt: "2026-07-29T18:00:00.000Z",
  correction: {
    policy: "REVERSE_EVENTS",
    targetEventIds: ["event-a"],
    replacements: [],
    reasonCode: "SCORER_REVIEW",
  },
} as const;

const actor = {
  accountId: "account-a",
  actorId: "actor-a",
  actorKind: "SERVICE",
  actorUserId: null,
  membershipId: null,
  capability: "game.correct",
  scope: { kind: "GAME", gameId: "game-a" },
  authorizedAt: "2026-07-29T17:59:00.000Z",
} as const;

describe("correction command boundary", () => {
  it("normalizes a complete correction command and exact authorized scope", () => {
    expect(parseCorrectionCommand(command)).toEqual(command);
    expect(requireCorrectionActor(actor, "account-a", "game-a")).toEqual(actor);
  });

  it("rejects missing reasons, cross-Account actors, and wrong Game scope", () => {
    expect(() =>
      parseCorrectionCommand({
        ...command,
        correction: { ...command.correction, reasonCode: "" },
      }),
    ).toThrowError(CorrectionWorkflowError);
    expect(() =>
      requireCorrectionActor(actor, "account-b", "game-a"),
    ).toThrowError(expect.objectContaining({ code: "ACCOUNT_MISMATCH" }));
    expect(() =>
      requireCorrectionActor(actor, "account-a", "game-b"),
    ).toThrowError(expect.objectContaining({ code: "AUTHORIZATION_REQUIRED" }));
  });

  it("does not call persistence when authorization fails", async () => {
    const acceptCorrection = vi.fn();
    const service = new CorrectionAuditReplayService({
      acceptCorrection,
    } as unknown as PrismaGameEventRepository);

    await expect(
      service.applyCorrection(command, {
        ...trustedActorForTest(actor),
        target: {
          ...trustedActorForTest(actor).target,
          gameId: "another-game",
        },
      }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_REQUIRED" });
    expect(acceptCorrection).not.toHaveBeenCalled();
  });

  it("denies correction-history loading outside exact authorized Account and Game scope", async () => {
    const loadAcceptedHistory = vi.fn();
    const service = new CorrectionAuditReplayService({
      loadAcceptedHistory,
    } as unknown as PrismaGameEventRepository);

    await expect(
      service.loadCorrectionContext(
        "account-a",
        "game-a",
        "setup-a",
        trustedActorForTest({
          ...actor,
          scope: { kind: "GAME", gameId: "another-game" },
        }),
      ),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_REQUIRED" });
    expect(loadAcceptedHistory).not.toHaveBeenCalled();
  });
});
