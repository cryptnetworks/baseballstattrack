import { NextResponse } from "next/server";

import { discordInstallationCallbackSchema } from "@/domain/discord-installation";
import {
  DiscordInstallationError,
  getDiscordInstallationService,
} from "@/server/app/discord-installation-service";
import { getAuthorizationService } from "@/server/auth/application";
import {
  discordOAuthStateCookie,
  verifyDiscordOAuthState,
} from "@/server/auth/discord-oauth-state";
import { authenticateRouteRequest } from "@/server/auth/next-session";
import { authorizeProtectedRequest } from "@/server/auth/protected-boundary";
import { loadDiscordInstallationConfiguration } from "@/server/config/discord-installation";
import { requestCorrelation } from "@/server/observability/operational-events";

export const dynamic = "force-dynamic";

function destination(request: Request, status: string) {
  const requestUrl = new URL(request.url);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  const redirectOrigin = siteUrl ? new URL(siteUrl).origin : requestUrl.origin;
  return new URL(
    `/accounts?discord=${encodeURIComponent(status)}`,
    redirectOrigin,
  );
}

function clearState(response: NextResponse) {
  response.cookies.set(discordOAuthStateCookie.name, "", {
    ...discordOAuthStateCookie.options,
    maxAge: 0,
    expires: new Date(0),
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const stateCookie =
    request.headers
      .get("cookie")
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${discordOAuthStateCookie.name}=`))
      ?.slice(discordOAuthStateCookie.name.length + 1) ?? null;
  if (url.searchParams.has("error")) {
    return clearState(NextResponse.redirect(destination(request, "cancelled")));
  }
  try {
    const callback = discordInstallationCallbackSchema.parse({
      code: url.searchParams.get("code"),
      state: url.searchParams.get("state"),
      guildId: url.searchParams.get("guild_id"),
      permissions: url.searchParams.get("permissions"),
    });
    const state = verifyDiscordOAuthState({
      cookieValue: stateCookie,
      returnedState: callback.state,
      secret: loadDiscordInstallationConfiguration().stateSecret,
    });
    const actor = await authorizeProtectedRequest(
      () => authenticateRouteRequest(request),
      getAuthorizationService(),
      { kind: "ACCOUNT", accountId: state.accountId },
      "discord.settings.configure",
    );
    await getDiscordInstallationService().complete(
      callback,
      stateCookie,
      actor,
      requestCorrelation(request).correlationId,
    );
    return clearState(NextResponse.redirect(destination(request, "connected")));
  } catch (error) {
    const status =
      error instanceof DiscordInstallationError &&
      error.code === "PROVIDER_UNAVAILABLE"
        ? "unavailable"
        : "invalid";
    return clearState(NextResponse.redirect(destination(request, status)));
  }
}
