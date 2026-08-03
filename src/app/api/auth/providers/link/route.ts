import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getOAuthAuthenticationService } from "@/server/app/oauth-authentication-service";
import { applicationSessionCookie } from "@/server/auth/application-session";
import {
  AuthorizationError,
  safeAuthorizationMessage,
  safeAuthorizationStatus,
} from "@/server/auth/errors";
import { requireSameOriginValues } from "@/server/auth/request-security";

const requestSchema = z.object({ provider: z.string().trim().min(1) }).strict();

function sessionToken(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  if (authorization) {
    const match = /^Bearer ([^\s]+)$/iu.exec(authorization);
    return match?.[1] ?? null;
  }
  return request.cookies.get(applicationSessionCookie.name)?.value ?? null;
}

export async function POST(request: NextRequest) {
  try {
    requireSameOriginValues(
      request.headers.get("origin"),
      request.headers.get("x-forwarded-host") ?? request.headers.get("host"),
    );
    const token = sessionToken(request);
    if (!token) throw new AuthorizationError("AUTHENTICATION_REQUIRED");
    const contentType = request.headers.get("content-type") ?? "";
    const input = requestSchema.parse(
      contentType.includes("application/json")
        ? await request.json()
        : Object.fromEntries(await request.formData()),
    );
    const started = await getOAuthAuthenticationService().startLink(
      input.provider,
      token,
    );
    const response = NextResponse.redirect(started.authorizationUrl, 303);
    if (started.cookie.options) {
      response.cookies.set(
        started.cookie.name,
        started.cookie.value,
        started.cookie.options,
      );
    } else {
      response.cookies.set(started.cookie.name, started.cookie.value);
    }
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: safeAuthorizationMessage(error) },
      { status: safeAuthorizationStatus(error) },
    );
  }
}
