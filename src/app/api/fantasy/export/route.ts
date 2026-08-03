import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";

import { getFantasyExperienceService } from "@/server/app/fantasy-experience-service";
import { getAuthorizationService } from "@/server/auth/application";
import { AuthorizationError } from "@/server/auth/errors";
import { authenticateRouteRequest } from "@/server/auth/next-session";
import { selectedAccountCookie } from "@/server/auth/request-security";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const leagueId = z.uuid().parse(url.searchParams.get("league"));
    const accountId = (await cookies()).get(selectedAccountCookie.name)?.value;
    if (!accountId) throw new AuthorizationError("ACCOUNT_UNAVAILABLE");
    const identity = await authenticateRouteRequest(request);
    const authorization = getAuthorizationService();
    const actor = await authorization.authorize(
      identity,
      { kind: "ACCOUNT", accountId },
      "fantasy.league.manage",
    );
    const payload = await getFantasyExperienceService().exportLeague(
      accountId,
      leagueId,
      actor,
    );
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="fantasy-league-${leagueId}.json"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const status =
      error instanceof AuthorizationError
        ? 401
        : error instanceof z.ZodError
          ? 400
          : 404;
    return NextResponse.json(
      { error: "Fantasy league is unavailable." },
      { status },
    );
  }
}
