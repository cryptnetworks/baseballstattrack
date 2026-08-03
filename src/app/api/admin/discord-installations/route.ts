import { NextResponse } from "next/server";
import { z } from "zod";

import {
  discordInstallationCommandSchema,
  DISCORD_INSTALLATION_PERMISSION_LABELS,
} from "@/domain/discord-installation";
import {
  RateLimitError,
  rateLimitHeaders,
  rateLimitStatus,
  safeRateLimitMessage,
} from "@/domain/rate-limits";
import {
  DiscordInstallationError,
  getDiscordInstallationService,
} from "@/server/app/discord-installation-service";
import { getAuthorizationService } from "@/server/auth/application";
import { discordOAuthStateCookie } from "@/server/auth/discord-oauth-state";
import {
  safeAuthorizationMessage,
  safeAuthorizationStatus,
} from "@/server/auth/errors";
import { authenticateRouteRequest } from "@/server/auth/next-session";
import { authorizeProtectedRequest } from "@/server/auth/protected-boundary";
import { requireSameOrigin } from "@/server/auth/request-security";
import type { Capability } from "@/server/auth/types";
import { requestCorrelation } from "@/server/observability/operational-events";

export const dynamic = "force-dynamic";

const accountIdSchema = z.string().trim().min(1).max(128);

async function authorize(
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
        code: "DISCORD_INSTALLATION_REQUEST_INVALID",
        error: "The Discord installation request is invalid.",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (error instanceof RateLimitError) {
    return Response.json(
      {
        code: "DISCORD_INSTALLATION_RATE_LIMITED",
        error: safeRateLimitMessage(error),
      },
      { status: rateLimitStatus(error), headers: rateLimitHeaders(error) },
    );
  }
  if (error instanceof DiscordInstallationError) {
    return Response.json(
      {
        code:
          error.code === "AUTHORIZATION_INVALID"
            ? "DISCORD_AUTHORIZATION_INVALID"
            : error.code === "RESOURCE_UNAVAILABLE"
              ? "DISCORD_RESOURCE_UNAVAILABLE"
              : "DISCORD_INSTALLATION_TEMPORARILY_UNAVAILABLE",
        error:
          error.code === "AUTHORIZATION_INVALID"
            ? "Discord did not authorize the requested server and permissions."
            : error.code === "RESOURCE_UNAVAILABLE"
              ? "The Discord installation resource is unavailable."
              : "Discord installation is temporarily unavailable.",
      },
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
            : "DISCORD_INSTALLATION_TEMPORARILY_UNAVAILABLE",
      error: safeAuthorizationMessage(error),
    },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(request: Request) {
  try {
    const accountId = accountIdSchema.parse(
      new URL(request.url).searchParams.get("accountId"),
    );
    const actor = await authorize(request, accountId, "discord.settings.view");
    const installations = await (
      await getDiscordInstallationService(accountId)
    ).list(accountId, actor);
    return Response.json(
      { installations },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const command = discordInstallationCommandSchema.parse(
      await request.json(),
    );
    const capability =
      command.action === "start"
        ? "discord.settings.configure"
        : "discord.settings.operate";
    const actor = await authorize(request, command.accountId, capability);
    const correlation = requestCorrelation(request);
    const service = await getDiscordInstallationService(command.accountId);
    if (command.action === "disconnect") {
      const installation = await service.disconnect(
        command,
        actor,
        correlation.correlationId,
      );
      return Response.json(
        { installation },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const start = await service.begin(command, actor);
    const response = NextResponse.json(
      {
        authorizationUrl: start.authorizationUrl,
        expiresAt: start.expiresAt.toISOString(),
        permissions: DISCORD_INSTALLATION_PERMISSION_LABELS,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
    response.cookies.set(discordOAuthStateCookie.name, start.stateCookie, {
      ...discordOAuthStateCookie.options,
      expires: start.expiresAt,
    });
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
