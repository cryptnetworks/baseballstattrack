import { z } from "zod";

import {
  PrivacyLifecycleError,
  createPrivacyRequestSchema,
} from "@/domain/privacy-lifecycle";
import {
  RateLimitError,
  rateLimitFingerprint,
  rateLimitHeaders,
  rateLimitStatus,
  safeRateLimitMessage,
} from "@/domain/rate-limits";
import { getPrivacyLifecycleService } from "@/server/app/privacy-lifecycle-service";
import { getRateLimitService } from "@/server/app/rate-limit-service";
import { getAuthorizationService } from "@/server/auth/application";
import {
  safeAuthorizationMessage,
  safeAuthorizationStatus,
} from "@/server/auth/errors";
import { authenticateRouteRequest } from "@/server/auth/next-session";
import { authorizeProtectedRequest } from "@/server/auth/protected-boundary";
import { requireSameOrigin } from "@/server/auth/request-security";
import type { Capability } from "@/server/auth/types";

export const dynamic = "force-dynamic";

const referenceSchema = z
  .object({
    accountId: z.string().trim().min(1).max(128),
    requestId: z.string().trim().min(1).max(128),
    target: z.enum(["ACCOUNT", "USER", "PLAYER"]),
  })
  .strict();

function capability(target: "ACCOUNT" | "USER" | "PLAYER"): Capability {
  return target === "ACCOUNT"
    ? "account.delete_request"
    : target === "USER"
      ? "privacy.request"
      : "privacy.manage";
}

async function privacyActor(
  request: Request,
  accountId: string,
  target: "ACCOUNT" | "USER" | "PLAYER",
) {
  return authorizeProtectedRequest(
    () => authenticateRouteRequest(request),
    getAuthorizationService(),
    { kind: "ACCOUNT", accountId },
    capability(target),
  );
}

function errorResponse(error: unknown) {
  if (error instanceof z.ZodError) {
    return Response.json(
      { error: "The privacy request is invalid." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (error instanceof PrivacyLifecycleError) {
    return Response.json(
      { error: "The privacy request could not be completed." },
      { status: 409, headers: { "Cache-Control": "no-store" } },
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

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const input = createPrivacyRequestSchema.parse(await request.json());
    const actor = await privacyActor(request, input.accountId, input.target);
    await getRateLimitService().enforce(
      {
        accountId: input.accountId,
        endpointClass: "ADMINISTRATION",
        operationKey: input.clientRequestId,
        fingerprint: rateLimitFingerprint(
          input.target,
          input.targetId,
          input.reasonCode,
          input.confirmation,
        ),
      },
      actor,
    );
    const result = await getPrivacyLifecycleService().createRequest(
      input,
      actor,
    );
    return Response.json(
      {
        requestId: result.request.id,
        status: result.request.status,
        scheduledFor: result.request.scheduledFor.toISOString(),
        idempotentRetry: result.idempotentRetry,
      },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    requireSameOrigin(request);
    const url = new URL(request.url);
    const input = referenceSchema.parse({
      accountId: url.searchParams.get("accountId"),
      requestId: url.searchParams.get("requestId"),
      target: url.searchParams.get("target"),
    });
    const actor = await privacyActor(request, input.accountId, input.target);
    await getRateLimitService().enforce(
      { accountId: input.accountId, endpointClass: "ADMINISTRATION" },
      actor,
    );
    await getPrivacyLifecycleService().cancelRequest(input, actor);
    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
