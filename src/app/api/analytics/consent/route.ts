import { z } from "zod";

import { getProductAnalyticsService } from "@/server/app/product-analytics-service";
import { getAuthorizationService } from "@/server/auth/application";
import {
  safeAuthorizationMessage,
  safeAuthorizationStatus,
} from "@/server/auth/errors";
import { authenticateRouteRequest } from "@/server/auth/next-session";
import { authorizeProtectedRequest } from "@/server/auth/protected-boundary";
import { requireSameOrigin } from "@/server/auth/request-security";

export const dynamic = "force-dynamic";

const accountId = z.string().trim().min(1).max(128);

async function actor(request: Request, targetAccountId: string) {
  return authorizeProtectedRequest(
    () => authenticateRouteRequest(request),
    getAuthorizationService(),
    { kind: "ACCOUNT", accountId: targetAccountId },
    "account.view",
  );
}

function errorResponse(error: unknown) {
  if (error instanceof z.ZodError) {
    return Response.json(
      { error: "The analytics preference is invalid." },
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
    const targetAccountId = accountId.parse(
      new URL(request.url).searchParams.get("accountId"),
    );
    const preference = await getProductAnalyticsService().preference(
      targetAccountId,
      await actor(request, targetAccountId),
    );
    return Response.json(
      {
        ...preference,
        expiresAt: preference.expiresAt?.toISOString() ?? null,
        updatedAt: preference.updatedAt?.toISOString() ?? null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    requireSameOrigin(request);
    const input = z
      .object({
        accountId,
        status: z.enum(["OPTED_IN", "OPTED_OUT"]),
      })
      .strict()
      .parse(await request.json());
    const preference = await getProductAnalyticsService().setPreference(
      input,
      await actor(request, input.accountId),
    );
    return Response.json(
      {
        status: preference.status,
        policyVersion: preference.policyVersion,
        expiresAt: preference.expiresAt?.toISOString() ?? null,
        updatedAt: preference.updatedAt.toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    requireSameOrigin(request);
    const targetAccountId = accountId.parse(
      new URL(request.url).searchParams.get("accountId"),
    );
    await getProductAnalyticsService().deletePreference(
      targetAccountId,
      await actor(request, targetAccountId),
    );
    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
