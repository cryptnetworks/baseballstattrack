import { timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { getNotificationEventPublicationService } from "@/server/app/notification-service";
import { runtimeSecretConfiguration } from "@/server/config/runtime-environment";

export const dynamic = "force-dynamic";

function authorized(request: Request): boolean {
  const configured = runtimeSecretConfiguration().notificationEventToken;
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
      { error: "The event request is unavailable." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    const result =
      await getNotificationEventPublicationService().operationalFailure(
        await request.json(),
      );
    return Response.json(result, {
      status: 202,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof z.ZodError
            ? "The event request is invalid."
            : "The event request is temporarily unavailable.",
      },
      {
        status: error instanceof z.ZodError ? 400 : 500,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
