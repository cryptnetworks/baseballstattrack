import { z } from "zod";

import {
  RateLimitError,
  rateLimitHeaders,
  rateLimitStatus,
  safeRateLimitMessage,
} from "@/domain/rate-limits";
import {
  DataReconciliationError,
  getDataReconciliationService,
} from "@/server/app/data-reconciliation-service";
import { getRateLimitService } from "@/server/app/rate-limit-service";
import { getAuthorizationService } from "@/server/auth/application";
import {
  safeAuthorizationMessage,
  safeAuthorizationStatus,
} from "@/server/auth/errors";
import { authenticateRouteRequest } from "@/server/auth/next-session";
import { authorizeProtectedAction } from "@/server/auth/protected-boundary";

export const dynamic = "force-dynamic";

const id = z.string().trim().min(1).max(128);
const requestSchema = z
  .object({
    accountId: id,
    gameId: id,
    setupSnapshotId: id,
    correlationId: id.nullable().default(null),
    trigger: z.enum(["MANUAL", "CORRECTION", "IMPORT", "REPROCESS"]),
  })
  .strict();

export async function POST(request: Request) {
  try {
    const input = requestSchema.parse(await request.json());
    const actor = await authorizeProtectedAction({
      origin: request.headers.get("origin"),
      host: request.headers.get("host"),
      authenticate: () => authenticateRouteRequest(request),
      authorization: getAuthorizationService(),
      target: {
        kind: "GAME",
        accountId: input.accountId,
        gameId: input.gameId,
      },
      capability: "audit.view",
    });
    await getRateLimitService().enforce(
      { accountId: input.accountId, endpointClass: "REPORT_GENERATION" },
      actor,
    );
    const report = await getDataReconciliationService().reconcile(input, actor);
    return Response.json(report, {
      status: report.blocking ? 422 : 200,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: "The reconciliation request is invalid." },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (error instanceof RateLimitError) {
      return Response.json(
        { error: safeRateLimitMessage(error) },
        { status: rateLimitStatus(error), headers: rateLimitHeaders(error) },
      );
    }
    if (error instanceof DataReconciliationError) {
      return Response.json(
        { error: "The reconciliation source changed. Retry the request." },
        { status: 409, headers: { "Cache-Control": "no-store" } },
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
