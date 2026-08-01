import { z } from "zod";

import {
  RateLimitError,
  rateLimitHeaders,
  rateLimitStatus,
  safeRateLimitMessage,
} from "@/domain/rate-limits";
import {
  DiscordPermissionsError,
  getDiscordPermissionsService,
} from "@/server/app/discord-permissions-service";
import { getAuthorizationService } from "@/server/auth/application";
import {
  safeAuthorizationMessage,
  safeAuthorizationStatus,
} from "@/server/auth/errors";
import { authenticateRouteRequest } from "@/server/auth/next-session";
import { authorizeProtectedRequest } from "@/server/auth/protected-boundary";
import { requireSameOrigin } from "@/server/auth/request-security";
import type { Capability } from "@/server/auth/types";

export const dynamic = "force-dynamic";

const id = z.string().trim().min(1).max(128);

function authorize(
  request: Request,
  accountId: string,
  capability: Capability,
) {
  return authorizeProtectedRequest(
    () => authenticateRouteRequest(request),
    getAuthorizationService(),
    { kind: "ACCOUNT", accountId },
    capability,
  );
}

function errorResponse(error: unknown) {
  if (error instanceof z.ZodError) {
    return Response.json(
      {
        code: "DISCORD_PERMISSION_REQUEST_INVALID",
        error: "The Discord permission request is invalid.",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (error instanceof RateLimitError) {
    return Response.json(
      {
        code: "DISCORD_PERMISSION_RATE_LIMITED",
        error: safeRateLimitMessage(error),
      },
      { status: rateLimitStatus(error), headers: rateLimitHeaders(error) },
    );
  }
  if (error instanceof DiscordPermissionsError) {
    const code =
      error.code === "REVISION_CONFLICT"
        ? "DISCORD_PERMISSION_CONFLICT"
        : error.code === "MEMBERSHIP_STALE"
          ? "DISCORD_MEMBERSHIP_STALE"
          : "DISCORD_RESOURCE_UNAVAILABLE";
    return Response.json(
      { code, error: error.message },
      { status: error.status, headers: { "Cache-Control": "no-store" } },
    );
  }
  const status = safeAuthorizationStatus(error);
  return Response.json(
    {
      code:
        status === 401
          ? "SIGN_IN_REQUIRED"
          : status === 403
            ? "DISCORD_PERMISSION_REQUIRED"
            : "DISCORD_PERMISSION_TEMPORARILY_UNAVAILABLE",
      error: safeAuthorizationMessage(error),
    },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(request: Request) {
  try {
    const search = new URL(request.url).searchParams;
    const accountId = id.parse(search.get("accountId"));
    const installationId = z.uuid().parse(search.get("installationId"));
    const view = z
      .enum(["grants", "audit"])
      .default("grants")
      .parse(search.get("view") ?? undefined);
    const actor = await authorize(
      request,
      accountId,
      view === "audit" ? "discord.settings.operate" : "discord.settings.view",
    );
    const service = getDiscordPermissionsService();
    const result =
      view === "audit"
        ? await service.history(accountId, installationId, actor)
        : await service.list(accountId, installationId, actor);
    return Response.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const input = z
      .object({
        action: z.enum(["update", "revoke"]),
        accountId: id,
      })
      .loose()
      .parse(await request.json());
    const actor = await authorize(
      request,
      input.accountId,
      "discord.settings.configure",
    );
    const command: Record<string, unknown> = { ...input };
    delete command.action;
    const service = getDiscordPermissionsService();
    const grant =
      input.action === "update"
        ? await service.update(command, actor)
        : await service.revoke(command, actor);
    return Response.json(grant, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
