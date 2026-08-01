import { z } from "zod";

import {
  CalendarFeedError,
  getCalendarFeedService,
} from "@/server/app/calendar-feed-service";
import { getAuthorizationService } from "@/server/auth/application";
import {
  safeAuthorizationMessage,
  safeAuthorizationStatus,
} from "@/server/auth/errors";
import { authenticateRouteRequest } from "@/server/auth/next-session";
import { authorizeProtectedRequest } from "@/server/auth/protected-boundary";

export const dynamic = "force-dynamic";

const accountIdSchema = z.string().trim().min(1).max(128);

export async function GET(request: Request) {
  try {
    const search = new URL(request.url).searchParams;
    const accountId = accountIdSchema.parse(search.get("accountId"));
    const teamId = z.uuid().parse(search.get("teamId"));
    const actor = await authorizeProtectedRequest(
      () => authenticateRouteRequest(request),
      getAuthorizationService(),
      { kind: "ACCOUNT", accountId },
      "account.manage",
    );
    const subscription = await getCalendarFeedService().subscription(
      { accountId, teamId },
      actor,
    );
    return Response.json(subscription, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: "The calendar request is invalid." },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (error instanceof CalendarFeedError) {
      return Response.json(
        { error: "The calendar feed is unavailable." },
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
}

export async function POST() {
  return Response.json(
    {
      error:
        "Provider calendar synchronization has been retired; use an ICS feed.",
    },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}

export const DELETE = POST;
