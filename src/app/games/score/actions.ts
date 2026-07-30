"use server";

import { randomUUID } from "node:crypto";

import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { GameEventError, parseEventBody } from "@/domain/events/event-log";
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

function safeFailure(
  error: unknown,
): Extract<RunnerPlayActionResult, { status: "ERROR" }> {
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
