import { z } from "zod";

import {
  RateLimitError,
  rateLimitHeaders,
  rateLimitStatus,
  safeRateLimitMessage,
} from "@/domain/rate-limits";
import {
  DiscordSettingsError,
  getDiscordSettingsService,
} from "@/server/app/discord-settings-service";
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

async function authorize(
  request: Request,
  accountId: string,
  capability: "discord.settings.view" | "discord.settings.configure",
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
        code: "DISCORD_SETTINGS_REQUEST_INVALID",
        error: "The Discord settings request is invalid.",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (error instanceof RateLimitError) {
    return Response.json(
      {
        code: "DISCORD_SETTINGS_RATE_LIMITED",
        error: safeRateLimitMessage(error),
      },
      { status: rateLimitStatus(error), headers: rateLimitHeaders(error) },
    );
  }
  if (error instanceof DiscordSettingsError) {
    const code =
      error.code === "REVISION_CONFLICT"
        ? "DISCORD_SETTINGS_CONFLICT"
        : error.code === "INSTALLATION_INACTIVE"
          ? "DISCORD_INSTALLATION_INACTIVE"
          : "DISCORD_RESOURCE_UNAVAILABLE";
    return Response.json(
      {
        code,
        error:
          error.code === "REVISION_CONFLICT"
            ? "The Discord settings changed. Reload before saving again."
            : "The Discord settings resource is unavailable.",
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
            : "DISCORD_SETTINGS_TEMPORARILY_UNAVAILABLE",
      error: safeAuthorizationMessage(error),
    },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function configurationResponse(
  configuration: Awaited<
    ReturnType<ReturnType<typeof getDiscordSettingsService>["get"]>
  >,
) {
  return {
    installation: configuration.installation,
    settings: {
      ...configuration.settings,
      pausedAt: configuration.settings.pausedAt?.toISOString() ?? null,
      manualRefreshRequestedAt:
        configuration.settings.manualRefreshRequestedAt?.toISOString() ?? null,
      nextScheduledEvaluationAt:
        configuration.settings.nextScheduledEvaluationAt?.toISOString() ?? null,
      lastSuccessfulUpdateAt:
        configuration.settings.lastSuccessfulUpdateAt?.toISOString() ?? null,
      createdAt: configuration.settings.createdAt?.toISOString() ?? null,
      updatedAt: configuration.settings.updatedAt?.toISOString() ?? null,
    },
  };
}

export async function GET(request: Request) {
  try {
    const search = new URL(request.url).searchParams;
    const accountId = id.parse(search.get("accountId"));
    const installationId = z.uuid().parse(search.get("installationId"));
    const actor = await authorize(request, accountId, "discord.settings.view");
    const configuration = await getDiscordSettingsService().get(
      accountId,
      installationId,
      actor,
    );
    return Response.json(configurationResponse(configuration), {
      headers: {
        "Cache-Control": "no-store",
        ETag: `"discord-settings-${configuration.settings.revision}"`,
      },
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
        action: z.enum(["update", "reset"]),
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
    const service = getDiscordSettingsService();
    const configuration =
      input.action === "update"
        ? await service.update(command, actor)
        : await service.reset(command, actor);
    return Response.json(configurationResponse(configuration), {
      headers: {
        "Cache-Control": "no-store",
        ETag: `"discord-settings-${configuration.settings.revision}"`,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
