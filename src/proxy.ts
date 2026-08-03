import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { authCookieOptions } from "@/server/auth/cookie-policy";
import { runtimeSecretConfiguration } from "@/server/config/runtime-environment";

export async function proxy(request: NextRequest) {
  const environment = runtimeSecretConfiguration();
  const url = environment.supabaseUrl;
  const key = environment.supabaseAnonymousKey;
  if (!url || !key) {
    const response = NextResponse.next({ request });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }

  let response = NextResponse.next({ request });
  const client = createServerClient(url, key, {
    cookieOptions: authCookieOptions(),
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  await client.auth.getUser();
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|service-worker.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
