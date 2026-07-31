import { timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { getCalendarSynchronizationService } from "@/server/app/calendar-sync-service";

export const dynamic = "force-dynamic";

function authorized(request: Request): boolean {
  const configured = process.env.CALENDAR_SYNC_WORKER_TOKEN;
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
      { error: "The calendar worker request is unavailable." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    const input = z
      .object({
        workerId: z.string().trim().min(8).max(128),
        connectionId: z.uuid().optional(),
      })
      .strict()
      .parse(await request.json());
    const result = await getCalendarSynchronizationService().run(input);
    return Response.json(result, {
      status: result.outcome === "idle" ? 200 : 202,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof z.ZodError
            ? "The calendar worker request is invalid."
            : "Calendar synchronization is temporarily unavailable.",
      },
      {
        status: error instanceof z.ZodError ? 400 : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
