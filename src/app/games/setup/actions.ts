"use server";

import { randomUUID } from "node:crypto";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  buildSaveSetupCommand,
  parseSetupWorkflowDraft,
  validateSetupDraft,
  type CreateGameResult,
  type SetupFieldError,
  type SetupMutationResult,
} from "@/features/game-setup/workflow";
import { GameSetupError } from "@/domain/setup/game-setup";
import { GameEventError } from "@/domain/events/event-log";
import { getAuthorizationService } from "@/server/auth/application";
import { AuthorizationError } from "@/server/auth/errors";
import { authenticatePageSession } from "@/server/auth/next-session";
import { authorizeProtectedAction } from "@/server/auth/protected-boundary";
import { selectedAccountCookie } from "@/server/auth/request-security";
import { getGameEventService } from "@/server/app/game-event-service";
import { getGameSetupService } from "@/server/app/game-setup-service";

const id = z.string().trim().min(1).max(128);
const createDraftSchema = z
  .object({
    accountId: id,
    seasonId: id,
    managedTeamSeasonId: id,
    scheduledAt: z.string().trim().min(1).max(40),
    location: z.string().trim().max(120),
    weatherCondition: z
      .enum([
        "CLEAR",
        "PARTLY_CLOUDY",
        "CLOUDY",
        "LIGHT_RAIN",
        "RAIN",
        "WINDY",
        "INDOOR",
      ])
      .nullable(),
    temperatureF: z.int().min(-20).max(130).nullable(),
  })
  .strict();

async function requestBoundary() {
  const requestHeaders = await headers();
  return {
    origin: requestHeaders.get("origin"),
    host: requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"),
  };
}

async function requireSelectedAccount(accountId: string) {
  const selected = (await cookies()).get(selectedAccountCookie.name)?.value;
  if (selected !== accountId) {
    throw new AuthorizationError("ACCOUNT_UNAVAILABLE");
  }
}

function safeError(error: unknown): {
  code: string;
  message: string;
  fieldErrors: SetupFieldError[];
} {
  if (error instanceof GameSetupError) {
    const messages: Partial<Record<GameSetupError["code"], string>> = {
      STALE_SETUP_REVISION:
        "This setup changed elsewhere. Reload the authoritative draft before saving.",
      IMMUTABLE_SETUP: "This game has started and setup can no longer change.",
      ROSTER_INELIGIBLE:
        "A selected player is no longer eligible. Review the lineup and remove or replace that player.",
      INVALID_PARTICIPANT: "Review the home and away participants.",
      INVALID_LINEUP: "Review the batting order and defensive assignments.",
      INVALID_PITCHER: "Choose exactly one eligible starting pitcher per side.",
      SETUP_INCOMPLETE:
        "Complete the required setup sections before readiness.",
      DUPLICATE_SUBMISSION:
        "This save identity was already used for different setup data. Reload and retry.",
    };
    return {
      code: error.code,
      message:
        messages[error.code] ??
        (error.code === "NOT_FOUND_OR_INACCESSIBLE" ||
        error.code === "ACCOUNT_MISMATCH" ||
        error.code === "AUTHORIZATION_REQUIRED"
          ? "The requested game setup is unavailable."
          : "The setup could not be saved. Review the form and try again."),
      fieldErrors: error.issues.map(({ field, code }) => ({
        field,
        message: `Review this field (${code.replaceAll("_", " ")}).`,
      })),
    };
  }
  if (error instanceof GameEventError) {
    return {
      code: error.code,
      message:
        error.code === "STALE_SOURCE_REVISION"
          ? "The game changed elsewhere. Reload before starting."
          : "The game could not be started from its current authoritative state.",
      fieldErrors: [],
    };
  }
  if (error instanceof AuthorizationError) {
    return {
      code: error.code,
      message: "The requested game setup is unavailable.",
      fieldErrors: [],
    };
  }
  if (error instanceof z.ZodError) {
    return {
      code: "INVALID_INPUT",
      message: "Review the highlighted setup fields.",
      fieldErrors: error.issues.slice(0, 20).map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    };
  }
  return {
    code: "UNEXPECTED_FAILURE",
    message: "The setup could not be saved. Try again.",
    fieldErrors: [],
  };
}

function localDateTimeIso(value: string) {
  const parsed = new Date(
    /(?:Z|[+-]\d{2}:\d{2})$/u.test(value) ? value : `${value}Z`,
  );
  if (Number.isNaN(parsed.valueOf())) {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["scheduledAt"],
        message: "Enter a valid game date.",
        input: value,
      },
    ]);
  }
  return parsed.toISOString();
}

export async function createDraftGameAction(
  _previous: CreateGameResult,
  formData: FormData,
): Promise<CreateGameResult> {
  try {
    const temperature = String(formData.get("temperatureF") ?? "").trim();
    const weather = String(formData.get("weatherCondition") ?? "").trim();
    const input = createDraftSchema.parse({
      accountId: formData.get("accountId"),
      seasonId: formData.get("seasonId"),
      managedTeamSeasonId: formData.get("managedTeamSeasonId"),
      scheduledAt: formData.get("scheduledAt"),
      location: formData.get("location"),
      weatherCondition: weather.length > 0 ? weather : null,
      temperatureF: temperature.length > 0 ? Number(temperature) : null,
    });
    await requireSelectedAccount(input.accountId);
    const boundary = await requestBoundary();
    const actor = await authorizeProtectedAction({
      ...boundary,
      authenticate: authenticatePageSession,
      authorization: getAuthorizationService(),
      target: { kind: "ACCOUNT", accountId: input.accountId },
      capability: "game.create",
    });
    const game = await getGameSetupService().createDraftGame(
      {
        ...input,
        scheduledAt: localDateTimeIso(input.scheduledAt),
        location: input.location.length > 0 ? input.location : null,
      },
      actor,
    );
    redirect(`/games/setup/${game.id}`);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "digest" in error &&
      String(error.digest).startsWith("NEXT_REDIRECT")
    ) {
      throw error;
    }
    const failure = safeError(error);
    return {
      status: "ERROR",
      message: failure.message,
      fieldErrors: failure.fieldErrors,
    };
  }
}

export async function mutateGameSetupAction(
  _previous: SetupMutationResult,
  formData: FormData,
): Promise<SetupMutationResult> {
  const rawIntent = formData.get("intent");
  const intent =
    rawIntent === "READY" || rawIntent === "START" ? rawIntent : "SAVE";
  const reuseCurrentSetup = formData.get("reuseCurrentSetup") === "true";
  try {
    const rawDraft = String(formData.get("draft") ?? "");
    const draft = parseSetupWorkflowDraft(JSON.parse(rawDraft));
    await requireSelectedAccount(draft.accountId);
    const boundary = await requestBoundary();
    const authorization = getAuthorizationService();
    const setupService = getGameSetupService();

    if (intent === "START") {
      const [viewActor, startActor] = await Promise.all([
        authorizeProtectedAction({
          ...boundary,
          authenticate: authenticatePageSession,
          authorization,
          target: {
            kind: "GAME",
            accountId: draft.accountId,
            gameId: draft.gameId,
          },
          capability: "game.view",
        }),
        authorizeProtectedAction({
          ...boundary,
          authenticate: authenticatePageSession,
          authorization,
          target: {
            kind: "GAME",
            accountId: draft.accountId,
            gameId: draft.gameId,
          },
          capability: "game.start",
        }),
      ]);
      const current = await setupService.loadCurrentSetup(
        { accountId: draft.accountId, gameId: draft.gameId },
        viewActor,
      );
      if (
        current.game.status !== "READY" ||
        current.game.revision !== 0 ||
        !current.game.readySetupSnapshotId ||
        current.game.setupRevision !== draft.expectedSetupRevision
      ) {
        throw new GameSetupError(
          "STALE_SETUP_REVISION",
          "Ready setup changed before start.",
        );
      }
      await getGameEventService().accept(
        {
          accountId: draft.accountId,
          gameId: draft.gameId,
          setupSnapshotId: current.game.readySetupSnapshotId,
          expectedRevision: 0,
          eventId: randomUUID(),
          playTransactionId: randomUUID(),
          clientSubmissionId: draft.clientSubmissionId,
          recordedAt: new Date().toISOString(),
          body: { eventType: "GameStarted", payload: {} },
        },
        startActor,
      );
      revalidatePath(`/games/setup/${draft.gameId}`);
      return {
        status: "SUCCESS",
        intent,
        message: "Game started from the accepted ready setup.",
        setupRevision: current.game.setupRevision,
        setupSnapshotId: current.game.readySetupSnapshotId,
        gameStatus: "IN_PROGRESS",
        acceptedClientSubmissionId: draft.clientSubmissionId,
        nextClientSubmissionId: randomUUID(),
        fieldErrors: [],
      };
    }

    const localErrors = validateSetupDraft(draft, {
      requireReady: intent === "READY",
    });
    if (localErrors.length > 0) {
      return {
        status: "ERROR",
        intent,
        code: "INVALID_INPUT",
        message: "Review the setup before continuing.",
        fieldErrors: localErrors,
      };
    }
    const setupActor = await authorizeProtectedAction({
      ...boundary,
      authenticate: authenticatePageSession,
      authorization,
      target: {
        kind: "GAME",
        accountId: draft.accountId,
        gameId: draft.gameId,
      },
      capability: "game.setup",
    });
    const saved =
      intent === "READY" && reuseCurrentSetup && draft.expectedSetupRevision > 0
        ? await setupService
            .loadWorkflowContext(
              { accountId: draft.accountId, gameId: draft.gameId },
              setupActor,
            )
            .then((current) => {
              if (
                current.game.setupRevision !== draft.expectedSetupRevision ||
                !current.setup
              ) {
                throw new GameSetupError(
                  "STALE_SETUP_REVISION",
                  "Current setup changed before readiness.",
                );
              }
              return { setup: current.setup, idempotentReplay: true };
            })
        : await setupService.saveSetupRevision(
            buildSaveSetupCommand(draft),
            setupActor,
          );
    let gameStatus: "DRAFT" | "READY" = "DRAFT";
    if (intent === "READY") {
      await setupService.markSetupReady(
        {
          accountId: draft.accountId,
          gameId: draft.gameId,
          setupSnapshotId: saved.setup.id,
          expectedSetupRevision: saved.setup.setupRevision,
        },
        setupActor,
      );
      gameStatus = "READY";
    }
    revalidatePath("/games/setup");
    revalidatePath(`/games/setup/${draft.gameId}`);
    return {
      status: "SUCCESS",
      intent,
      message:
        intent === "READY"
          ? "Setup saved and marked ready."
          : "Draft saved to the authoritative game record.",
      setupRevision: saved.setup.setupRevision,
      setupSnapshotId: saved.setup.id,
      gameStatus,
      acceptedClientSubmissionId: draft.clientSubmissionId,
      nextClientSubmissionId: randomUUID(),
      fieldErrors: [],
    };
  } catch (error) {
    const failure = safeError(error);
    return {
      status: "ERROR",
      intent,
      code: failure.code,
      message: failure.message,
      fieldErrors: failure.fieldErrors,
    };
  }
}
