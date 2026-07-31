import { z } from "zod";

import {
  RateLimitError,
  rateLimitHeaders,
  rateLimitStatus,
  safeRateLimitMessage,
} from "@/domain/rate-limits";
import {
  WebhookError,
  getWebhookAdministrationService,
} from "@/server/app/webhook-service";
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
      { error: "The webhook request is invalid." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (error instanceof RateLimitError) {
    return Response.json(
      { error: safeRateLimitMessage(error) },
      { status: rateLimitStatus(error), headers: rateLimitHeaders(error) },
    );
  }
  if (error instanceof WebhookError) {
    return Response.json(
      {
        error:
          error.status === 400
            ? "The webhook request is invalid."
            : error.status === 500
              ? "Webhook administration is temporarily unavailable."
              : "The webhook resource is unavailable.",
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
    const endpointId = z.uuid().nullable().parse(search.get("endpointId"));
    const actor = await administrator(request, accountId);
    const service = getWebhookAdministrationService();
    if (endpointId) {
      const deliveries = await service.history(accountId, endpointId, actor);
      return Response.json(
        {
          deliveries: deliveries.map((delivery) => ({
            id: delivery.externalId,
            eventId: delivery.event.externalId,
            sequence: delivery.event.sequence.toString(),
            eventName: delivery.event.eventName,
            payloadVersion: delivery.event.payloadVersion,
            occurredAt: delivery.event.occurredAt.toISOString(),
            eventRetentionUntil: delivery.event.retentionUntil.toISOString(),
            replayNumber: delivery.replayNumber,
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
    const endpoints = await service.list(accountId, actor);
    return Response.json(
      {
        endpoints: endpoints.map((endpoint) => ({
          id: endpoint.externalId,
          url: endpoint.url,
          status: endpoint.status,
          subscribedEvents: endpoint.subscribedEvents,
          secretVersion: endpoint.secretVersion,
          verifiedAt: endpoint.verifiedAt?.toISOString() ?? null,
          revokedAt: endpoint.revokedAt?.toISOString() ?? null,
          createdAt: endpoint.createdAt.toISOString(),
          deadLetterCount: endpoint._count.deliveries,
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
      .object({
        action: z.enum(["create", "verify", "rotate", "replay"]),
        accountId: id,
      })
      .loose()
      .parse(await request.json());
    const actor = await administrator(request, input.accountId);
    const service = getWebhookAdministrationService();
    const { action, ...command } = input;
    const result =
      action === "create"
        ? await service.create(command, actor)
        : action === "verify"
          ? await service.verify(command, actor)
          : action === "rotate"
            ? await service.rotate(command, actor)
            : await service.replay(command, actor);
    return Response.json(result, {
      status: action === "create" || action === "replay" ? 201 : 200,
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
      .object({ accountId: id, endpointId: z.uuid(), reasonCode: id })
      .strict()
      .parse(await request.json());
    const actor = await administrator(request, input.accountId);
    await getWebhookAdministrationService().revoke(input, actor);
    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
