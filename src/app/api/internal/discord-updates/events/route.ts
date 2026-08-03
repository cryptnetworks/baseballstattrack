import { timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { getDiscordUpdatePublicationService } from "@/server/app/discord-update-worker-service";
import { featureEnabled } from "@/server/config/feature-flags";
import { runtimeSecretConfiguration } from "@/server/config/runtime-environment";

export const dynamic = "force-dynamic";

function authorized(request: Request): boolean {
  const configured = runtimeSecretConfiguration().discordUpdateEventToken;
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
      { error: "The update event request is unavailable." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    const input = await request.json();
    const accountId = z
      .object({ accountId: z.string().trim().min(1).max(128) })
      .loose()
      .parse(input).accountId;
    if (!(await featureEnabled("FEATURE_DISCORD_UPDATES_ENABLED", accountId))) {
      return Response.json(
        { disabled: true, outcome: "unavailable", created: 0 },
        { status: 202, headers: { "Cache-Control": "no-store" } },
      );
    }
    const result = await getDiscordUpdatePublicationService().publish(input);
    return Response.json(result, {
      status: 202,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof z.ZodError
            ? "The update event request is invalid."
            : "The update event request is temporarily unavailable.",
      },
      {
        status: error instanceof z.ZodError ? 400 : 500,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
