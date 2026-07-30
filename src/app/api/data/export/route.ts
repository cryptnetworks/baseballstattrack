import { z } from "zod";

import { getPortableDataService } from "@/server/app/portable-data-service";
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
    const accountId = accountIdSchema.parse(
      new URL(request.url).searchParams.get("accountId"),
    );
    const authorization = getAuthorizationService();
    const actor = await authorizeProtectedRequest(
      () => authenticateRouteRequest(request),
      authorization,
      { kind: "ACCOUNT", accountId },
      "report.export",
    );
    const artifact = await getPortableDataService().exportAccount(
      accountId,
      actor,
    );
    await authorizeProtectedRequest(
      () => authenticateRouteRequest(request),
      authorization,
      { kind: "ACCOUNT", accountId },
      "report.export",
    );
    return new Response(artifact.bytes as BodyInit, {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Disposition": `attachment; filename="${artifact.fileName}"`,
        "Content-Type": "application/json; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        "X-Export-Checksum": artifact.checksum,
        "X-Robots-Tag": "noindex, nofollow, noarchive",
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: "The export request is invalid." },
        { status: 400 },
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
