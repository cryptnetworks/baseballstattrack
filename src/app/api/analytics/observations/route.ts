import { z } from "zod";

import { getAnalyticsObservationService } from "@/server/app/analytics-observation-service";
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

async function authorize(
  request: Request,
  accountId: string,
  gameId: string,
  capability: "game.score" | "report.view",
) {
  return authorizeProtectedRequest(
    () => authenticateRouteRequest(request),
    getAuthorizationService(),
    { kind: "GAME", accountId, gameId },
    capability,
  );
}

function errorResponse(error: unknown) {
  if (error instanceof z.ZodError) {
    return Response.json(
      { error: "The analytics observation is invalid." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
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
    const search = new URL(request.url).searchParams;
    const accountId = id.parse(search.get("accountId"));
    const gameId = id.parse(search.get("gameId"));
    const observations = await getAnalyticsObservationService().list(
      { accountId, gameId },
      await authorize(request, accountId, gameId, "report.view"),
    );
    return Response.json(
      { observations },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const input = await request.json();
    const accountId = id.parse(input?.accountId);
    const gameId = id.parse(input?.gameId);
    const observation = await getAnalyticsObservationService().create(
      input,
      await authorize(request, accountId, gameId, "game.score"),
    );
    return Response.json(
      { observation },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
