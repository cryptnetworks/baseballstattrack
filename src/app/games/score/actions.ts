"use server";

import { randomUUID } from "node:crypto";

import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  CorrectionWorkflowError,
  type CorrectionWorkflowResult,
} from "@/domain/corrections";
import { GameEventError, parseEventBody } from "@/domain/events/event-log";
import { RateLimitError } from "@/domain/rate-limits";
import {
  ScoringCorrectionError,
  buildCorrectionPayload,
  correctionReasonCodes,
  previewCorrection,
  type CorrectionDraft,
  type CorrectionPreview,
} from "@/features/scoring/scoring-corrections";
import { getCorrectionAuditReplayService } from "@/server/app/correction-audit-replay-service";
import { getGameEventService } from "@/server/app/game-event-service";
import { getAuthorizationService } from "@/server/auth/application";
import { AuthorizationError } from "@/server/auth/errors";
import { authenticatePageSession } from "@/server/auth/next-session";
import { authorizeProtectedAction } from "@/server/auth/protected-boundary";
import { selectedAccountCookie } from "@/server/auth/request-security";

export type RunnerPlayActionResult =
  | { status: "IDLE"; message: string }
  | { status: "SUCCESS"; message: string; acceptedRevision: number }
  | { status: "ERROR"; message: string; code: string };

export const initialRunnerPlayActionResult: RunnerPlayActionResult = {
  status: "IDLE",
  message: "",
};
export type PlateAppearanceActionResult = RunnerPlayActionResult;
export const initialPlateAppearanceActionResult: PlateAppearanceActionResult = {
  status: "IDLE",
  message: "",
};
export type LineupChangeActionResult = RunnerPlayActionResult;
export const initialLineupChangeActionResult: LineupChangeActionResult = {
  status: "IDLE",
  message: "",
};
export type ScoringRecoveryActionResult = RunnerPlayActionResult;
export const initialScoringRecoveryActionResult: ScoringRecoveryActionResult = {
  status: "IDLE",
  message: "",
};
export type CorrectionPreviewActionResult =
  | { status: "IDLE"; message: string }
  | {
      status: "PREVIEW";
      message: string;
      draft: CorrectionDraft;
      preview: CorrectionPreview;
    }
  | { status: "ERROR"; message: string; code: string };
export const initialCorrectionPreviewActionResult: CorrectionPreviewActionResult =
  {
    status: "IDLE",
    message: "",
  };
export type CorrectionApplyActionResult =
  | { status: "IDLE"; message: string }
  | {
      status: "SUCCESS";
      message: string;
      acceptedRevision: number;
      verificationStatus: CorrectionWorkflowResult["version"]["verificationStatus"];
    }
  | { status: "ERROR"; message: string; code: string };
export const initialCorrectionApplyActionResult: CorrectionApplyActionResult = {
  status: "IDLE",
  message: "",
};
export type ReopenGameActionResult = RunnerPlayActionResult;
export const initialReopenGameActionResult: ReopenGameActionResult = {
  status: "IDLE",
  message: "",
};

type ScoringSubmissionEventType =
  | "DefensiveAlignmentChanged"
  | "DefensiveSubstitutionMade"
  | "PitchingChangeMade"
  | "PlateAppearanceRecorded"
  | "RunnerPlayRecorded";

const id = z.string().trim().min(1).max(128);
const submissionSchema = z
  .object({
    accountId: id,
    gameId: id,
    setupSnapshotId: id,
    expectedRevision: z.coerce.number().int().nonnegative(),
    clientSubmissionId: id,
    body: z.string().min(1).max(20_000),
  })
  .strict();
const correctionSelectionSchema = z
  .object({
    accountId: id,
    gameId: id,
    setupSnapshotId: id,
    expectedRevision: z.coerce.number().int().nonnegative(),
    targetEventId: id,
    action: z.enum(["REVERSE_EVENT", "REPLACE_PLATE_JUDGMENT"]),
    replacementOutcome: z.string().trim().max(64).nullable(),
    errorFielderId: id.nullable(),
    reasonCode: z.enum(correctionReasonCodes),
    replacementId: id,
  })
  .strict();
const correctionSubmissionSchema = correctionSelectionSchema.extend({
  eventId: id,
  playTransactionId: id,
  idempotencyKey: id,
  recordedAt: z.iso.datetime(),
  confirmed: z.literal("yes"),
});
const reopenSchema = z
  .object({
    accountId: id,
    gameId: id,
    setupSnapshotId: id,
    expectedRevision: z.coerce.number().int().nonnegative(),
    eventId: id,
    playTransactionId: id,
    clientSubmissionId: id,
    recordedAt: z.iso.datetime(),
    reasonCode: z.literal("SCORER_REVIEW"),
    confirmed: z.literal("yes"),
  })
  .strict();

function optionalId(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" && value.trim() ? value : null;
}

function correctionInput(formData: FormData) {
  return {
    accountId: formData.get("accountId"),
    gameId: formData.get("gameId"),
    setupSnapshotId: formData.get("setupSnapshotId"),
    expectedRevision: formData.get("expectedRevision"),
    targetEventId: formData.get("targetEventId"),
    action: formData.get("action"),
    replacementOutcome: optionalId(formData, "replacementOutcome"),
    errorFielderId: optionalId(formData, "errorFielderId"),
    reasonCode: formData.get("reasonCode"),
    replacementId: formData.get("replacementId"),
  };
}

async function authorizeGameAction(
  accountId: string,
  gameId: string,
  capability: "game.correct" | "game.reopen",
) {
  const selected = (await cookies()).get(selectedAccountCookie.name)?.value;
  if (selected !== accountId) {
    throw new AuthorizationError("ACCOUNT_UNAVAILABLE");
  }
  const requestHeaders = await headers();
  return authorizeProtectedAction({
    origin: requestHeaders.get("origin"),
    host: requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"),
    authenticate: authenticatePageSession,
    authorization: getAuthorizationService(),
    target: { kind: "GAME", accountId, gameId },
    capability,
  });
}

function safeCorrectionFailure(error: unknown) {
  if (error instanceof RateLimitError) {
    return {
      status: "ERROR" as const,
      code: error.code,
      message:
        error.code === "IDEMPOTENCY_CONFLICT"
          ? "This correction retry identity was used for different content. Reload before submitting again."
          : `Too many correction requests. Retry in ${error.retryAfterSeconds} seconds.`,
    };
  }
  if (error instanceof ScoringCorrectionError) {
    return {
      status: "ERROR" as const,
      code: error.code,
      message: error.message,
    };
  }
  if (error instanceof CorrectionWorkflowError) {
    const messages: Partial<Record<CorrectionWorkflowError["code"], string>> = {
      STALE_SOURCE_REVISION:
        "The game changed elsewhere. Reload the current history and preview the correction again.",
      LIFECYCLE_CONFLICT:
        "The game lifecycle changed. Verified games must be reopened before correction.",
      INVALID_CORRECTION:
        "The replacement does not produce valid replayable game history.",
      DUPLICATE_SUBMISSION:
        "This correction identity was already used for different content. Reload and try again.",
      NOT_FOUND_OR_INACCESSIBLE:
        "The selected game or correction target is unavailable.",
    };
    return {
      status: "ERROR" as const,
      code: error.code,
      message:
        messages[error.code] ??
        "The correction was rejected without changing accepted history.",
    };
  }
  if (error instanceof GameEventError) {
    return {
      status: "ERROR" as const,
      code: error.code,
      message:
        error.code === "STALE_SOURCE_REVISION"
          ? "The game changed elsewhere. Reload and preview the correction again."
          : "The proposed correction is not valid against authoritative history.",
    };
  }
  if (error instanceof AuthorizationError) {
    return {
      status: "ERROR" as const,
      code: error.code,
      message: "Correction history is unavailable for this account and game.",
    };
  }
  if (error instanceof z.ZodError) {
    return {
      status: "ERROR" as const,
      code: "INVALID_INPUT",
      message:
        "Select a play, correction action, supported reason, and any required replacement fields.",
    };
  }
  return {
    status: "ERROR" as const,
    code: "UNEXPECTED_FAILURE",
    message: "The correction request failed closed. Try again.",
  };
}

function safeFailure(
  error: unknown,
): Extract<RunnerPlayActionResult, { status: "ERROR" }> {
  if (error instanceof RateLimitError) {
    return {
      status: "ERROR" as const,
      code: error.code,
      message:
        error.code === "IDEMPOTENCY_CONFLICT"
          ? "This scoring retry identity was used for a different play. Reload before submitting again."
          : `Scoring is temporarily rate limited. Keep this play and retry it in ${error.retryAfterSeconds} seconds.`,
    };
  }
  if (error instanceof GameEventError) {
    const messages: Partial<Record<GameEventError["code"], string>> = {
      STALE_SOURCE_REVISION:
        "The game changed elsewhere. The authoritative state has been reloaded; review the play and try again.",
      INVALID_RUNNER_MOVEMENT:
        "The proposed runner outcomes conflict with the authoritative base state.",
      INVALID_BASEBALL_TRANSITION:
        "The proposed play would create an impossible out, run, or inning state.",
      INVALID_LINEUP:
        "The batter, runner, or fielding attribution no longer matches the active lineup.",
      INVALID_PITCHER:
        "Pitcher responsibility no longer matches the authoritative game.",
      INVALID_LIFECYCLE_TRANSITION:
        "This game is no longer available for live scoring. Reload its authoritative status.",
      DUPLICATE_IDEMPOTENCY_KEY:
        "This submission identity was already used for a different play. Reload and try again.",
    };
    return {
      status: "ERROR",
      code: error.code,
      message:
        messages[error.code] ??
        "The authoritative scoring engine rejected this play. Review the current state and try again.",
    };
  }
  if (error instanceof AuthorizationError) {
    return {
      status: "ERROR",
      code: error.code,
      message: "This game is unavailable for scoring.",
    };
  }
  if (error instanceof z.ZodError || error instanceof SyntaxError) {
    return {
      status: "ERROR",
      code: "INVALID_INPUT",
      message: "The scoring proposal is incomplete or invalid.",
    };
  }
  return {
    status: "ERROR",
    code: "UNEXPECTED_FAILURE",
    message: "The play could not be recorded. Try again.",
  };
}

async function acceptScoringSubmission(
  formData: FormData,
  allowedEventTypes: readonly [
    ScoringSubmissionEventType,
    ...ScoringSubmissionEventType[],
  ],
) {
  const input = submissionSchema.parse({
    accountId: formData.get("accountId"),
    gameId: formData.get("gameId"),
    setupSnapshotId: formData.get("setupSnapshotId"),
    expectedRevision: formData.get("expectedRevision"),
    clientSubmissionId: formData.get("clientSubmissionId"),
    body: formData.get("body"),
  });
  const selected = (await cookies()).get(selectedAccountCookie.name)?.value;
  if (selected !== input.accountId) {
    throw new AuthorizationError("ACCOUNT_UNAVAILABLE");
  }
  const body = parseEventBody(JSON.parse(input.body));
  if (
    !allowedEventTypes.includes(body.eventType as ScoringSubmissionEventType)
  ) {
    throw new GameEventError(
      "INVALID_PAYLOAD",
      "This scoring surface cannot submit that event type.",
    );
  }
  const requestHeaders = await headers();
  const actor = await authorizeProtectedAction({
    origin: requestHeaders.get("origin"),
    host: requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"),
    authenticate: authenticatePageSession,
    authorization: getAuthorizationService(),
    target: {
      kind: "GAME",
      accountId: input.accountId,
      gameId: input.gameId,
    },
    capability: "game.score",
  });
  const accepted = await getGameEventService().accept(
    {
      accountId: input.accountId,
      gameId: input.gameId,
      setupSnapshotId: input.setupSnapshotId,
      expectedRevision: input.expectedRevision,
      eventId: randomUUID(),
      playTransactionId: randomUUID(),
      clientSubmissionId: input.clientSubmissionId,
      recordedAt: new Date().toISOString(),
      body,
    },
    actor,
  );
  revalidatePath(`/games/score/${input.gameId}`);
  return accepted;
}

export async function recordRunnerPlayAction(
  _previous: RunnerPlayActionResult,
  formData: FormData,
): Promise<RunnerPlayActionResult> {
  try {
    const accepted = await acceptScoringSubmission(formData, [
      "RunnerPlayRecorded",
    ]);
    return {
      status: "SUCCESS",
      message: accepted.idempotentReplay
        ? "Runner play was already recorded; authoritative state reloaded."
        : "Runner play recorded atomically.",
      acceptedRevision: accepted.event.acceptedRevision,
    };
  } catch (error) {
    if (
      error instanceof GameEventError &&
      error.code === "STALE_SOURCE_REVISION"
    ) {
      const gameId = id.safeParse(formData.get("gameId"));
      if (gameId.success) revalidatePath(`/games/score/${gameId.data}`);
    }
    return safeFailure(error);
  }
}

export async function recordPlateAppearanceAction(
  _previous: PlateAppearanceActionResult,
  formData: FormData,
): Promise<PlateAppearanceActionResult> {
  try {
    const accepted = await acceptScoringSubmission(formData, [
      "PlateAppearanceRecorded",
    ]);
    return {
      status: "SUCCESS",
      message: accepted.idempotentReplay
        ? "Plate appearance was already recorded; authoritative state reloaded."
        : "Plate appearance recorded atomically.",
      acceptedRevision: accepted.event.acceptedRevision,
    };
  } catch (error) {
    if (
      error instanceof GameEventError &&
      error.code === "STALE_SOURCE_REVISION"
    ) {
      const gameId = id.safeParse(formData.get("gameId"));
      if (gameId.success) revalidatePath(`/games/score/${gameId.data}`);
    }
    return safeFailure(error);
  }
}

export async function recordLineupChangeAction(
  _previous: LineupChangeActionResult,
  formData: FormData,
): Promise<LineupChangeActionResult> {
  try {
    const accepted = await acceptScoringSubmission(formData, [
      "DefensiveSubstitutionMade",
      "DefensiveAlignmentChanged",
      "PitchingChangeMade",
    ]);
    return {
      status: "SUCCESS",
      message: accepted.idempotentReplay
        ? "Lineup change was already recorded; authoritative state reloaded."
        : "Lineup change recorded at the current game state.",
      acceptedRevision: accepted.event.acceptedRevision,
    };
  } catch (error) {
    if (
      error instanceof GameEventError &&
      error.code === "STALE_SOURCE_REVISION"
    ) {
      const gameId = id.safeParse(formData.get("gameId"));
      if (gameId.success) revalidatePath(`/games/score/${gameId.data}`);
    }
    return safeFailure(error);
  }
}

export async function recordRecoveredScoringAction(
  _previous: ScoringRecoveryActionResult,
  formData: FormData,
): Promise<ScoringRecoveryActionResult> {
  try {
    const accepted = await acceptScoringSubmission(formData, [
      "PlateAppearanceRecorded",
      "RunnerPlayRecorded",
      "DefensiveSubstitutionMade",
      "DefensiveAlignmentChanged",
      "PitchingChangeMade",
    ]);
    return {
      status: "SUCCESS",
      message: accepted.idempotentReplay
        ? "The interrupted action was already accepted. State is reconciled."
        : "The recovered action was accepted. State is reconciled.",
      acceptedRevision: accepted.event.acceptedRevision,
    };
  } catch (error) {
    if (
      error instanceof GameEventError &&
      error.code === "STALE_SOURCE_REVISION"
    ) {
      const gameId = id.safeParse(formData.get("gameId"));
      if (gameId.success) revalidatePath(`/games/score/${gameId.data}`);
    }
    return safeFailure(error);
  }
}

export async function previewScoringCorrectionAction(
  _previous: CorrectionPreviewActionResult,
  formData: FormData,
): Promise<CorrectionPreviewActionResult> {
  try {
    const draft = correctionSelectionSchema.parse(correctionInput(formData));
    const actor = await authorizeGameAction(
      draft.accountId,
      draft.gameId,
      "game.correct",
    );
    const history =
      await getCorrectionAuditReplayService().loadCorrectionContext(
        draft.accountId,
        draft.gameId,
        draft.setupSnapshotId,
        actor,
      );
    const current = history.events.at(-1)?.acceptedRevision ?? 0;
    if (current !== draft.expectedRevision) {
      throw new CorrectionWorkflowError(
        "STALE_SOURCE_REVISION",
        "Expected source revision is stale.",
      );
    }
    const payload = buildCorrectionPayload(history.events, draft);
    return {
      status: "PREVIEW",
      message:
        "Preview calculated from authoritative history. It has not been accepted.",
      draft,
      preview: previewCorrection(history.setup, history.events, payload),
    };
  } catch (error) {
    return safeCorrectionFailure(error);
  }
}

export async function applyScoringCorrectionAction(
  _previous: CorrectionApplyActionResult,
  formData: FormData,
): Promise<CorrectionApplyActionResult> {
  try {
    const input = correctionSubmissionSchema.parse({
      ...correctionInput(formData),
      eventId: formData.get("eventId"),
      playTransactionId: formData.get("playTransactionId"),
      idempotencyKey: formData.get("idempotencyKey"),
      recordedAt: formData.get("recordedAt"),
      confirmed: formData.get("confirmed"),
    });
    const actor = await authorizeGameAction(
      input.accountId,
      input.gameId,
      "game.correct",
    );
    const service = getCorrectionAuditReplayService();
    const history = await service.loadCorrectionContext(
      input.accountId,
      input.gameId,
      input.setupSnapshotId,
      actor,
    );
    const current = history.events.at(-1)?.acceptedRevision ?? 0;
    const correction = buildCorrectionPayload(history.events, input, {
      allowSuperseded: true,
    });
    if (current === input.expectedRevision) {
      previewCorrection(history.setup, history.events, correction);
    }
    const accepted = await service.applyCorrection(
      {
        action: "APPLY_CORRECTION",
        accountId: input.accountId,
        gameId: input.gameId,
        setupSnapshotId: input.setupSnapshotId,
        expectedSourceRevision: input.expectedRevision,
        eventId: input.eventId,
        playTransactionId: input.playTransactionId,
        idempotencyKey: input.idempotencyKey,
        correlationId: input.idempotencyKey,
        recordedAt: input.recordedAt,
        correction,
      },
      actor,
    );
    revalidatePath(`/games/score/${input.gameId}`);
    return {
      status: "SUCCESS",
      message: accepted.idempotentReplay
        ? "This exact correction was already accepted. Authoritative history is reconciled."
        : "Correction accepted. Replay, statistics, and the audit trail were updated.",
      acceptedRevision: accepted.correction.acceptedRevision,
      verificationStatus: accepted.version.verificationStatus,
    };
  } catch (error) {
    const gameId = id.safeParse(formData.get("gameId"));
    if (
      gameId.success &&
      ((error instanceof CorrectionWorkflowError &&
        error.code === "STALE_SOURCE_REVISION") ||
        (error instanceof GameEventError &&
          error.code === "STALE_SOURCE_REVISION"))
    ) {
      revalidatePath(`/games/score/${gameId.data}`);
    }
    return safeCorrectionFailure(error);
  }
}

export async function reopenGameForCorrectionAction(
  _previous: ReopenGameActionResult,
  formData: FormData,
): Promise<ReopenGameActionResult> {
  try {
    const input = reopenSchema.parse({
      accountId: formData.get("accountId"),
      gameId: formData.get("gameId"),
      setupSnapshotId: formData.get("setupSnapshotId"),
      expectedRevision: formData.get("expectedRevision"),
      eventId: formData.get("eventId"),
      playTransactionId: formData.get("playTransactionId"),
      clientSubmissionId: formData.get("clientSubmissionId"),
      recordedAt: formData.get("recordedAt"),
      reasonCode: formData.get("reasonCode"),
      confirmed: formData.get("confirmed"),
    });
    const actor = await authorizeGameAction(
      input.accountId,
      input.gameId,
      "game.reopen",
    );
    const accepted = await getGameEventService().accept(
      {
        accountId: input.accountId,
        gameId: input.gameId,
        setupSnapshotId: input.setupSnapshotId,
        expectedRevision: input.expectedRevision,
        eventId: input.eventId,
        playTransactionId: input.playTransactionId,
        clientSubmissionId: input.clientSubmissionId,
        recordedAt: input.recordedAt,
        body: {
          eventType: "GameReopened",
          payload: { reasonCode: input.reasonCode },
        },
      },
      actor,
    );
    revalidatePath(`/games/score/${input.gameId}`);
    return {
      status: "SUCCESS",
      message: accepted.idempotentReplay
        ? "The game was already reopened. Authoritative state is reconciled."
        : "Game reopened explicitly. Corrections now require fresh preview and confirmation.",
      acceptedRevision: accepted.event.acceptedRevision,
    };
  } catch (error) {
    return safeFailure(error);
  }
}
