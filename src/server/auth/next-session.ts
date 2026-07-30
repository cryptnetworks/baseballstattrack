import { cookies } from "next/headers";

import {
  authenticateSupabaseCookies,
  authenticateSupabaseRequest,
  createSupabaseCookieClient,
  type SessionCookieStore,
} from "@/server/auth/supabase-session";

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
        // Server Components cannot write cookies. The proxy refreshes them.
      }
    },
  };
}

export async function authenticatePageSession() {
  return authenticateSupabaseCookies(await nextCookieStore());
}

export async function authenticateRouteRequest(request: Request) {
  return authenticateSupabaseRequest(request, await nextCookieStore());
}

export async function createSupabaseNextClient() {
  return createSupabaseCookieClient(await nextCookieStore());
}
