"use server";

import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { GameEventError } from "@/domain/events/event-log";
import { getGameEventService } from "@/server/app/game-event-service";
import { getAuthorizationService } from "@/server/auth/application";
import { AuthorizationError } from "@/server/auth/errors";
import { authenticatePageSession } from "@/server/auth/next-session";
import { authorizeProtectedAction } from "@/server/auth/protected-boundary";
import { selectedAccountCookie } from "@/server/auth/request-security";

export type VerifyBoxScoreActionResult =
  | { status: "IDLE"; message: string }
  | { status: "SUCCESS"; message: string; acceptedRevision: number }
  | { status: "ERROR"; message: string; code: string };

export const initialVerifyBoxScoreActionResult: VerifyBoxScoreActionResult = {
  status: "IDLE",
  message: "",
};

const id = z.string().trim().min(1).max(128);
const schema = z
  .object({
    accountId: id,
    gameId: id,
    setupSnapshotId: id,
    expectedRevision: z.coerce.number().int().nonnegative(),
    eventId: id,
    playTransactionId: id,
    clientSubmissionId: id,
    recordedAt: z.iso.datetime(),
    mode: z.enum(["VERIFY", "REVERIFY"]),
    confirmed: z.literal("yes"),
  })
  .strict();

function safeFailure(error: unknown): VerifyBoxScoreActionResult {
  if (error instanceof GameEventError) {
    return {
      status: "ERROR",
      code: error.code,
      message:
        error.code === "STALE_SOURCE_REVISION"
          ? "The game changed. Reload and review the current box score before verifying."
          : error.code === "INVALID_LIFECYCLE_TRANSITION"
            ? "This game is not currently eligible for verification."
            : "Verification failed closed because authoritative history is inconsistent.",
    };
  }
  if (error instanceof AuthorizationError) {
    return {
      status: "ERROR",
      code: error.code,
      message: "This box score is unavailable for verification.",
    };
  }
  if (error instanceof z.ZodError) {
    return {
      status: "ERROR",
      code: "INVALID_INPUT",
      message: "Explicit verification confirmation is required.",
    };
  }
  return {
    status: "ERROR",
    code: "UNEXPECTED_FAILURE",
    message: "Verification could not be completed. Try again.",
  };
}

export async function verifyBoxScoreAction(
  _previous: VerifyBoxScoreActionResult,
  formData: FormData,
): Promise<VerifyBoxScoreActionResult> {
  try {
    const input = schema.parse({
      accountId: formData.get("accountId"),
      gameId: formData.get("gameId"),
      setupSnapshotId: formData.get("setupSnapshotId"),
      expectedRevision: formData.get("expectedRevision"),
      eventId: formData.get("eventId"),
      playTransactionId: formData.get("playTransactionId"),
      clientSubmissionId: formData.get("clientSubmissionId"),
      recordedAt: formData.get("recordedAt"),
      mode: formData.get("mode"),
      confirmed: formData.get("confirmed"),
    });
    const selected = (await cookies()).get(selectedAccountCookie.name)?.value;
    if (selected !== input.accountId) {
      throw new AuthorizationError("ACCOUNT_UNAVAILABLE");
    }
    const requestHeaders = await headers();
    const capability =
      input.mode === "REVERIFY" ? "game.reverify" : "game.verify";
    const actor = await authorizeProtectedAction({
      origin: requestHeaders.get("origin"),
      host:
        requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"),
      authenticate: authenticatePageSession,
      authorization: getAuthorizationService(),
      target: {
        kind: "GAME",
        accountId: input.accountId,
        gameId: input.gameId,
      },
      capability,
    });
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
        body: { eventType: "GameVerified", payload: {} },
      },
      actor,
    );
    revalidatePath(`/games/${input.gameId}/box-score`);
    revalidatePath(`/games/score/${input.gameId}`);
    return {
      status: "SUCCESS",
      message: accepted.idempotentReplay
        ? "This exact verification was already accepted. The report is reconciled."
        : input.mode === "REVERIFY"
          ? "Corrected game reverified at the current report version."
          : "Game verified at the current report version.",
      acceptedRevision: accepted.event.acceptedRevision,
    };
  } catch (error) {
    const gameId = id.safeParse(formData.get("gameId"));
    if (
      gameId.success &&
      error instanceof GameEventError &&
      error.code === "STALE_SOURCE_REVISION"
    ) {
      revalidatePath(`/games/${gameId.data}/box-score`);
    }
    return safeFailure(error);
  }
}
