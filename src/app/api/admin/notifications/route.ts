import { z } from "zod";

import {
  RateLimitError,
  rateLimitHeaders,
  rateLimitStatus,
  safeRateLimitMessage,
} from "@/domain/rate-limits";
import {
  NotificationError,
  getNotificationAdministrationService,
} from "@/server/app/notification-service";
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
      { error: "The notification request is invalid." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (error instanceof RateLimitError) {
    return Response.json(
      { error: safeRateLimitMessage(error) },
      { status: rateLimitStatus(error), headers: rateLimitHeaders(error) },
    );
  }
  if (error instanceof NotificationError) {
    return Response.json(
      {
        error:
          error.status === 400
            ? "The notification request is invalid."
            : error.status === 500
              ? "Notification administration is temporarily unavailable."
              : "The notification resource is unavailable.",
      },
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

export async function GET(request: Request) {
  try {
    const search = new URL(request.url).searchParams;
    const accountId = id.parse(search.get("accountId"));
    const history = search.get("history") === "true";
    const preferenceId = z.uuid().nullable().parse(search.get("preferenceId"));
    const actor = await administrator(request, accountId);
    const service = await getNotificationAdministrationService(accountId);
    if (history) {
      const deliveries = await service.history(
        accountId,
        preferenceId ?? undefined,
        actor,
      );
      return Response.json(
        {
          deliveries: deliveries.map((delivery) => ({
            id: delivery.externalId,
            preferenceId: delivery.preference.externalId,
            scope: delivery.preference.scopeKey,
            eventId: delivery.event.externalId,
            eventName: delivery.event.eventName,
            eventVersion: delivery.event.payloadVersion,
            eventSequence: delivery.event.sequence.toString(),
            occurredAt: delivery.event.occurredAt.toISOString(),
            channel: delivery.channel,
            messageVersion: delivery.messageVersion,
            status: delivery.status,
            attemptCount: delivery.attemptCount,
            nextAttemptAt: delivery.nextAttemptAt.toISOString(),
            lastFailureCode: delivery.lastFailureCode,
            deliveredAt: delivery.deliveredAt?.toISOString() ?? null,
            deadLetteredAt: delivery.deadLetteredAt?.toISOString() ?? null,
            cancelledAt: delivery.cancelledAt?.toISOString() ?? null,
            createdAt: delivery.createdAt.toISOString(),
          })),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const preferences = await service.list(accountId, actor);
    return Response.json(
      {
        preferences: preferences.map((preference) => ({
          id: preference.externalId,
          membershipId: preference.membershipId,
          teamId: preference.teamId,
          scope: preference.scopeKey,
          channel: preference.channel,
          destinationReference: preference.destinationReference,
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

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const input = z
      .object({ action: z.literal("configure"), accountId: id })
      .loose()
      .parse(await request.json());
    const actor = await administrator(request, input.accountId);
    const command: Record<string, unknown> = { ...input };
    delete command.action;
    const result = await (
      await getNotificationAdministrationService(input.accountId)
    ).configure(command, actor);
    return Response.json(result, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    requireSameOrigin(request);
    const input = z
      .object({
        accountId: id,
        preferenceId: z.uuid(),
        reasonCode: id,
      })
      .strict()
      .parse(await request.json());
    const actor = await administrator(request, input.accountId);
    await (
      await getNotificationAdministrationService(input.accountId)
    ).disable(input, actor);
    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
