import { type NextRequest, NextResponse } from "next/server";

import {
  applicationSessionCookie,
  getApplicationSessionService,
  type SessionCookieStore,
} from "@/server/auth/application-session";
import { AuthorizationError } from "@/server/auth/errors";

export async function proxy(request: NextRequest) {
  const response = NextResponse.next({ request });
  response.headers.set("Cache-Control", "private, no-store");
  if (!request.cookies.has(applicationSessionCookie.name)) return response;

  const store: SessionCookieStore = {
    getAll: () =>
      request.cookies.getAll().map(({ name, value }) => ({ name, value })),
    setAll: (values) => {
      for (const cookie of values) {
        if (cookie.options) {
          response.cookies.set(cookie.name, cookie.value, cookie.options);
        } else {
          response.cookies.set(cookie.name, cookie.value);
        }
      }
    },
  };
  try {
    await getApplicationSessionService().authenticateCookies(store, true);
  } catch (error) {
    if (
      error instanceof AuthorizationError &&
      ["INVALID_SESSION", "SESSION_EXPIRED"].includes(error.code)
    ) {
      response.cookies.set(applicationSessionCookie.name, "", {
        ...applicationSessionCookie.options,
        maxAge: 0,
      });
    }
  }
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|service-worker.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
