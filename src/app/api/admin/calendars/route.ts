import { z } from "zod";

import {
  RateLimitError,
  rateLimitHeaders,
  rateLimitStatus,
  safeRateLimitMessage,
} from "@/domain/rate-limits";
import {
  CalendarSyncError,
  getCalendarAdministrationService,
} from "@/server/app/calendar-sync-service";
import { getAuthorizationService } from "@/server/auth/application";
import {
  safeAuthorizationMessage,
  safeAuthorizationStatus,
} from "@/server/auth/errors";
import { authenticateRouteRequest } from "@/server/auth/next-session";
import { authorizeProtectedRequest } from "@/server/auth/protected-boundary";
import { requireSameOrigin } from "@/server/auth/request-security";

export const dynamic = "force-dynamic";

const id = z.string().trim().min(1).max(128);

async function administrator(request: Request, accountId: string) {
  return authorizeProtectedRequest(
    () => authenticateRouteRequest(request),
    getAuthorizationService(),
    { kind: "ACCOUNT", accountId },
    "account.manage",
  );
}

function errorResponse(error: unknown) {
  if (error instanceof z.ZodError) {
    return Response.json(
      { error: "The calendar request is invalid." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (error instanceof RateLimitError) {
    return Response.json(
      { error: safeRateLimitMessage(error) },
      { status: rateLimitStatus(error), headers: rateLimitHeaders(error) },
    );
  }
  if (error instanceof CalendarSyncError) {
    return Response.json(
      {
        error:
          error.status === 500
            ? "Calendar administration is temporarily unavailable."
            : "The calendar resource is unavailable.",
      },
      { status: error.status, headers: { "Cache-Control": "no-store" } },
    );
  }
  return Response.json(
    { error: safeAuthorizationMessage(error) },
    {
      status: safeAuthorizationStatus(error),
      headers: { "Cache-Control": "no-store" },
    },
  );
}

export async function GET(request: Request) {
  try {
    const accountId = id.parse(
      new URL(request.url).searchParams.get("accountId"),
    );
    const actor = await administrator(request, accountId);
    const connections = await getCalendarAdministrationService().list(
      accountId,
      actor,
    );
    return Response.json(
      {
        connections: connections.map((connection) => ({
          id: connection.externalId,
          provider: connection.provider,
          providerCalendarId: connection.providerCalendarId,
          timeZone: connection.timeZone,
          detailLevel: connection.detailLevel,
          status: connection.status,
          lastSyncAt: connection.lastSyncAt?.toISOString() ?? null,
          lastFailureAt: connection.lastFailureAt?.toISOString() ?? null,
          lastFailureCode: connection.lastFailureCode,
          disconnectedAt: connection.disconnectedAt?.toISOString() ?? null,
          createdAt: connection.createdAt.toISOString(),
          unresolved: connection.events.map((event) => ({
            gameId: event.game.externalId,
            scheduledAt: event.game.scheduledAt?.toISOString() ?? null,
            status: event.status,
            attemptCount: event.attemptCount,
            failureCode: event.lastFailureCode,
            lastAttemptAt: event.lastAttemptAt?.toISOString() ?? null,
          })),
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const input = z
      .object({
        action: z.enum(["connect", "retry"]),
        accountId: id,
      })
      .loose()
      .parse(await request.json());
    const actor = await administrator(request, input.accountId);
    const service = getCalendarAdministrationService();
    const { action, ...command } = input;
    const result =
      action === "connect"
        ? await service.connect(command, actor)
        : await service.retry(command, actor);
    return Response.json(result, {
      status: action === "connect" ? 201 : 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    requireSameOrigin(request);
    const input = z
      .object({ accountId: id, connectionId: z.uuid() })
      .strict()
      .parse(await request.json());
    const actor = await administrator(request, input.accountId);
    await getCalendarAdministrationService().disconnect(input, actor);
    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
