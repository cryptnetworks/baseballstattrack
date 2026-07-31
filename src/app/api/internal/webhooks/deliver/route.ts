import { timingSafeEqual } from "node:crypto";

import {
  WebhookError,
  getWebhookDeliveryService,
} from "@/server/app/webhook-service";

export const dynamic = "force-dynamic";

function authorized(request: Request): boolean {
  const configured = process.env.WEBHOOK_WORKER_TOKEN;
  const presented = request.headers
    .get("authorization")
    ?.replace(/^Bearer /u, "");
  if (!configured || configured.length < 32 || !presented) return false;
  const expected = Buffer.from(configured);
  const actual = Buffer.from(presented);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return Response.json(
      { error: "The worker request is unavailable." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    const workerId = request.headers.get("x-webhook-worker-id") ?? "";
    const results = await getWebhookDeliveryService().deliverBatch(workerId);
    return Response.json(
      {
        claimed: results.length,
        succeeded: results.filter(({ outcome }) => outcome === "succeeded")
          .length,
        retried: results.filter(({ outcome }) => outcome === "retry").length,
        deadLettered: results.filter(({ outcome }) => outcome === "dead_letter")
          .length,
        cancelled: results.filter(({ outcome }) => outcome === "cancelled")
          .length,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof WebhookError && error.status === 400
            ? "The worker request is invalid."
            : "Webhook delivery is temporarily unavailable.",
      },
      {
        status: error instanceof WebhookError ? error.status : 500,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
