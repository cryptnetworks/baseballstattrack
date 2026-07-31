import { z } from "zod";

import { getNotificationPreferenceService } from "@/server/app/notification-service";
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

async function recipient(request: Request, accountId: string) {
  return authorizeProtectedRequest(
    () => authenticateRouteRequest(request),
    getAuthorizationService(),
    { kind: "ACCOUNT", accountId },
    "account.view",
  );
}

function errorResponse(error: unknown) {
  return Response.json(
    { error: safeAuthorizationMessage(error) },
    {
      status:
        error instanceof z.ZodError ? 400 : safeAuthorizationStatus(error),
      headers: { "Cache-Control": "no-store" },
    },
  );
}

export async function GET(request: Request) {
  try {
    const accountId = id.parse(
      new URL(request.url).searchParams.get("accountId"),
    );
    const actor = await recipient(request, accountId);
    const preferences = await getNotificationPreferenceService().list(
      accountId,
      actor,
    );
    return Response.json(
      {
        preferences: preferences.map((preference) => ({
          id: preference.externalId,
          teamId: preference.teamId,
          scope: preference.scopeKey,
          channel: preference.channel,
          subscribedEvents: preference.subscribedEvents,
          status: preference.status,
          sensitiveContent: preference.sensitiveContent,
          optedOutAt: preference.optedOutAt?.toISOString() ?? null,
          disabledAt: preference.disabledAt?.toISOString() ?? null,
          createdAt: preference.createdAt.toISOString(),
          updatedAt: preference.updatedAt.toISOString(),
        })),
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
    const { accountId } = z
      .object({ accountId: id })
      .strict()
      .parse(await request.json());
    const actor = await recipient(request, accountId);
    const result = await getNotificationPreferenceService().optOut(
      accountId,
      actor,
    );
    return Response.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
