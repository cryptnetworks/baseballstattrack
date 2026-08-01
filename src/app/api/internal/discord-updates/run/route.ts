import { timingSafeEqual } from "node:crypto";

import { z } from "zod";

import {
  DiscordUpdateWorkerError,
  getDiscordUpdateWorkerService,
} from "@/server/app/discord-update-worker-service";
import { featureEnabled } from "@/server/config/feature-flags";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request): boolean {
  const configured = process.env.DISCORD_UPDATE_WORKER_TOKEN;
  const presented = request.headers
    .get("authorization")
    ?.replace(/^Bearer /u, "");
  if (!configured || configured.length < 32 || !presented) return false;
  const expected = Buffer.from(configured);
  const actual = Buffer.from(presented);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function summary(
  results: ReadonlyArray<{
    outcome: "succeeded" | "retry" | "dead_letter" | "cancelled";
  }>,
) {
  return {
    claimed: results.length,
    succeeded: results.filter(({ outcome }) => outcome === "succeeded").length,
    retried: results.filter(({ outcome }) => outcome === "retry").length,
    deadLettered: results.filter(({ outcome }) => outcome === "dead_letter")
      .length,
    cancelled: results.filter(({ outcome }) => outcome === "cancelled").length,
  };
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return Response.json(
      { error: "The update worker request is unavailable." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!featureEnabled("FEATURE_DISCORD_UPDATES_ENABLED")) {
    return Response.json(
      {
        disabled: true,
        evaluations: summary([]),
        deliveries: summary([]),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    const workerId = request.headers.get("x-discord-update-worker-id") ?? "";
    const service = getDiscordUpdateWorkerService();
    const evaluations = await service.evaluateBatch(workerId, {
      signal: request.signal,
    });
    const deliveries = await service.deliverBatch(workerId, {
      signal: request.signal,
    });
    return Response.json(
      { evaluations: summary(evaluations), deliveries: summary(deliveries) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const invalid =
      error instanceof z.ZodError ||
      (error instanceof DiscordUpdateWorkerError && error.status === 400);
    return Response.json(
      {
        error: invalid
          ? "The update worker request is invalid."
          : "Discord update delivery is temporarily unavailable.",
      },
      {
        status: invalid ? 400 : 500,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
