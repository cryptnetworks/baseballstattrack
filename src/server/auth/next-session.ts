import { cookies } from "next/headers";

import {
  getApplicationSessionService,
  type SessionCookieStore,
} from "@/server/auth/application-session";

export async function nextCookieStore(): Promise<SessionCookieStore> {
  const store = await cookies();
  return {
    getAll: () => store.getAll().map(({ name, value }) => ({ name, value })),
    setAll: (values) => {
      try {
        for (const { name, value, options } of values) {
          store.set(name, value, options ?? {});
        }
      } catch {
        // The proxy owns rotation because Server Components cannot mutate cookies.
      }
    },
  };
}

export async function authenticatePageSession() {
  return getApplicationSessionService().authenticateCookies(
    await nextCookieStore(),
    false,
  );
}

export async function authenticateRouteRequest(request: Request) {
  return getApplicationSessionService().authenticateRequest(
    request,
    await nextCookieStore(),
    false,
  );
}
