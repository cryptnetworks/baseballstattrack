import { timingSafeEqual } from "node:crypto";

import { z } from "zod";

import {
  ExternalIngestionError,
  getExternalIngestionService,
} from "@/server/app/external-ingestion-service";

export const dynamic = "force-dynamic";

function authorized(request: Request) {
  const configured = process.env.EXTERNAL_INGESTION_WORKER_TOKEN;
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
      { error: "The ingestion worker request is unavailable." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    const input = z
      .object({
        accountId: z.string().trim().min(8).max(128),
        sourceId: z.uuid(),
        runKey: z.string().trim().min(8).max(128),
        mode: z.enum(["SCHEDULED", "BACKFILL"]),
        from: z.iso.datetime(),
        to: z.iso.datetime(),
      })
      .strict()
      .parse(await request.json());
    const result = await getExternalIngestionService().run({
      accountId: input.accountId,
      sourceExternalId: input.sourceId,
      runKey: input.runKey,
      mode: input.mode,
      from: new Date(input.from),
      to: new Date(input.to),
    });
    return Response.json(result, {
      status: result.idempotent ? 200 : 202,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof z.ZodError ||
          (error instanceof ExternalIngestionError &&
            error.code !== "PROVIDER_UNAVAILABLE")
            ? "The ingestion worker request is invalid or unavailable."
            : "External ingestion is temporarily unavailable.",
      },
      {
        status: error instanceof z.ZodError ? 400 : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
