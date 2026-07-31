import { z } from "zod";

import { MAX_PORTABLE_BYTES, PortableDataError } from "@/domain/portable-data";
import {
  RateLimitError,
  rateLimitHeaders,
  rateLimitStatus,
  safeRateLimitMessage,
} from "@/domain/rate-limits";
import { getPortableDataService } from "@/server/app/portable-data-service";
import { getRateLimitService } from "@/server/app/rate-limit-service";
import { getAuthorizationService } from "@/server/auth/application";
import {
  safeAuthorizationMessage,
  safeAuthorizationStatus,
} from "@/server/auth/errors";
import { authenticateRouteRequest } from "@/server/auth/next-session";
import { authorizeProtectedAction } from "@/server/auth/protected-boundary";

export const dynamic = "force-dynamic";

const accountIdSchema = z.string().trim().min(1).max(128);

function validationStatus(error: PortableDataError) {
  if (error.code === "OVERSIZED_FILE") return 413;
  if (
    error.code === "DUPLICATE_ID" ||
    error.code === "ROSTER_CONFLICT" ||
    error.code === "EXISTING_RECORD_CONFLICT"
  ) {
    return 409;
  }
  if (error.code === "EVENT_INTEGRITY" || error.code === "SUMMARY_MISMATCH") {
    return 422;
  }
  return 400;
}

export async function POST(request: Request) {
  try {
    const accountId = accountIdSchema.parse(
      new URL(request.url).searchParams.get("accountId"),
    );
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (
      !Number.isSafeInteger(contentLength) ||
      contentLength < 0 ||
      contentLength > MAX_PORTABLE_BYTES
    ) {
      throw new PortableDataError(
        "OVERSIZED_FILE",
        "Import file is too large.",
      );
    }
    const actor = await authorizeProtectedAction({
      origin: request.headers.get("origin"),
      host: request.headers.get("host"),
      authenticate: () => authenticateRouteRequest(request),
      authorization: getAuthorizationService(),
      target: { kind: "ACCOUNT", accountId },
      capability: "account.manage",
    });
    await getRateLimitService().enforce(
      {
        accountId,
        endpointClass: "REPORT_GENERATION",
        cost: Math.max(1, Math.ceil(contentLength / (1024 * 1024))),
      },
      actor,
    );
    const bytes = new Uint8Array(await request.arrayBuffer());
    const plan = await getPortableDataService().validateImport(
      accountId,
      bytes,
      actor,
    );
    return Response.json(plan, {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex, nofollow, noarchive",
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: "The import request is invalid." },
        { status: 400 },
      );
    }
    if (error instanceof PortableDataError) {
      return Response.json(
        {
          error: error.message,
          code: error.code,
          location: error.location,
        },
        {
          status: validationStatus(error),
          headers: { "Cache-Control": "no-store" },
        },
      );
    }
    if (error instanceof RateLimitError) {
      return Response.json(
        { error: safeRateLimitMessage(error) },
        { status: rateLimitStatus(error), headers: rateLimitHeaders(error) },
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
