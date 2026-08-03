import { type NextRequest, NextResponse } from "next/server";

import {
  clearOAuthAttemptCookies,
  getOAuthAuthenticationService,
  oauthAttemptCookie,
} from "@/server/app/oauth-authentication-service";
import { safeAuthorizationStatus } from "@/server/auth/errors";
import { loadAuthenticationProviderConfiguration } from "@/server/auth/provider-configuration";

export const dynamic = "force-dynamic";

function redirectOrigin() {
  return new URL(loadAuthenticationProviderConfiguration().callbackUrl).origin;
}

function applyCookies(
  response: NextResponse,
  values: ReadonlyArray<{
    name: string;
    value: string;
    options?: Parameters<NextResponse["cookies"]["set"]>[2];
  }>,
) {
  for (const cookie of values) {
    if (cookie.options) {
      response.cookies.set(cookie.name, cookie.value, cookie.options);
    } else {
      response.cookies.set(cookie.name, cookie.value);
    }
  }
}

async function callback(
  request: NextRequest,
  values: URLSearchParams | FormData,
) {
  const origin = redirectOrigin();
  const code = values.get("code");
  const state = values.get("state");
  const providerError = values.get("error");
  const attemptCookieValue = request.cookies.get(
    oauthAttemptCookie.name,
  )?.value;
  if (
    providerError ||
    typeof code !== "string" ||
    typeof state !== "string" ||
    !attemptCookieValue
  ) {
    const response = NextResponse.redirect(
      new URL("/login?error=oauth_callback", origin),
    );
    applyCookies(response, clearOAuthAttemptCookies);
    return response;
  }
  try {
    const completed = await getOAuthAuthenticationService().complete({
      code,
      state,
      attemptCookie: attemptCookieValue,
      signal: request.signal,
    });
    const response = NextResponse.redirect(new URL(completed.returnTo, origin));
    applyCookies(response, [
      completed.sessionCookie,
      ...clearOAuthAttemptCookies,
    ]);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    const response = NextResponse.redirect(
      new URL(
        safeAuthorizationStatus(error) === 500
          ? "/login?error=provider_unavailable"
          : "/login?error=oauth_callback",
        origin,
      ),
    );
    applyCookies(response, clearOAuthAttemptCookies);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}

export async function GET(request: NextRequest) {
  return callback(request, request.nextUrl.searchParams);
}

export async function POST(request: NextRequest) {
  return callback(request, await request.formData());
}
