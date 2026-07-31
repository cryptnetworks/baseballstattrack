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
      { error: "The Discord settings request is invalid." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (error instanceof RateLimitError) {
    return Response.json(
      { error: safeRateLimitMessage(error) },
      { status: rateLimitStatus(error), headers: rateLimitHeaders(error) },
    );
  }
  if (error instanceof DiscordSettingsError) {
    return Response.json(
      { error: "The Discord settings resource is unavailable." },
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

function configurationResponse(
  configuration: Awaited<
    ReturnType<ReturnType<typeof getDiscordSettingsService>["get"]>
  >,
) {
  return {
    installation: configuration.installation,
    settings: {
      ...configuration.settings,
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
    const actor = await administrator(request, accountId);
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
    const actor = await administrator(request, input.accountId);
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
