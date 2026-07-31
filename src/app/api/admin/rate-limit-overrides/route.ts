import { z } from "zod";

import {
  RateLimitError,
  RateLimitOverrideError,
  rateLimitClasses,
  rateLimitHeaders,
  rateLimitStatus,
  safeRateLimitMessage,
} from "@/domain/rate-limits";
import { getRateLimitService } from "@/server/app/rate-limit-service";
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
const grantSchema = z
  .object({
    accountId: id,
    endpointClass: z.enum(rateLimitClasses),
    actorKind: z.enum(["USER", "SERVICE"]).nullable(),
    actorId: id.nullable(),
    actorLimit: z.int().positive(),
    accountLimit: z.int().positive(),
    reasonCode: z.string().trim().min(3).max(64),
    expiresAt: z.iso.datetime(),
  })
  .strict();
const revokeSchema = z
  .object({ accountId: id, overrideId: id, reasonCode: id })
  .strict();

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
      { error: "The override request is invalid." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (error instanceof RateLimitError) {
    return Response.json(
      { error: safeRateLimitMessage(error) },
      { status: rateLimitStatus(error), headers: rateLimitHeaders(error) },
    );
  }
  if (error instanceof RateLimitOverrideError) {
    return Response.json(
      { error: "The override request could not be completed." },
      { status: error.status, headers: { "Cache-Control": "no-store" } },
    );
  }
  const status = safeAuthorizationStatus(error);
  return Response.json(
    { error: safeAuthorizationMessage(error) },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const input = grantSchema.parse(await request.json());
    const actor = await administrator(request, input.accountId);
    const service = getRateLimitService();
    await service.enforce(
      { accountId: input.accountId, endpointClass: "ADMINISTRATION" },
      actor,
    );
    const override = await service.grantOverride(input, actor);
    return Response.json(
      {
        overrideId: override.id,
        endpointClass: override.endpointClass,
        expiresAt: override.expiresAt.toISOString(),
        status: override.status,
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    requireSameOrigin(request);
    const input = revokeSchema.parse(await request.json());
    const actor = await administrator(request, input.accountId);
    const service = getRateLimitService();
    await service.enforce(
      { accountId: input.accountId, endpointClass: "ADMINISTRATION" },
      actor,
    );
    await service.revokeOverride(input, actor);
    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
