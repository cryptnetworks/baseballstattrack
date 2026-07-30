import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

import { authCookieOptions } from "@/server/auth/cookie-policy";
import { AuthorizationError } from "@/server/auth/errors";
import { AUTH_PROVIDER, type AuthenticatedIdentity } from "@/server/auth/types";

export type SessionCookie = {
  name: string;
  value: string;
  options?: CookieOptions;
};

export type SessionCookieStore = {
  getAll(): Array<{ name: string; value: string }>;
  setAll(cookies: SessionCookie[]): void;
};

function configuration() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new AuthorizationError(
      "CONFIGURATION_ERROR",
      "Supabase authentication is not configured.",
    );
  }
  return { url, key };
}

export function createSupabaseCookieClient(cookieStore: SessionCookieStore) {
  const { url, key } = configuration();
  return createServerClient(url, key, {
    cookieOptions: authCookieOptions(),
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookies) => cookieStore.setAll(cookies),
    },
  });
}

function identityForSubject(subject: string | undefined) {
  if (!subject) {
    throw new AuthorizationError("AUTHENTICATION_REQUIRED");
  }
  return {
    provider: AUTH_PROVIDER,
    providerSubject: subject,
  } satisfies AuthenticatedIdentity;
}

function sessionFailure(error: unknown): AuthorizationError {
  const status =
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number"
      ? error.status
      : null;
  return new AuthorizationError(
    status !== null && status >= 500 ? "PROVIDER_FAILURE" : "INVALID_SESSION",
  );
}

export async function authenticateSupabaseCookies(
  cookieStore: SessionCookieStore,
): Promise<AuthenticatedIdentity> {
  const client = createSupabaseCookieClient(cookieStore);
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  if (error) throw sessionFailure(error);
  if (!user) throw new AuthorizationError("AUTHENTICATION_REQUIRED");
  return identityForSubject(user.id);
}

export async function authenticateSupabaseRequest(
  request: Request,
  cookieStore: SessionCookieStore,
): Promise<AuthenticatedIdentity> {
  const authorization = request.headers.get("authorization");
  if (!authorization) return authenticateSupabaseCookies(cookieStore);
  const match = /^Bearer ([^\s]+)$/i.exec(authorization);
  if (!match?.[1]) {
    throw new AuthorizationError("AUTHENTICATION_REQUIRED");
  }
  const { url, key } = configuration();
  const client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const {
    data: { user },
    error,
  } = await client.auth.getUser(match[1]);
  if (error) throw sessionFailure(error);
  if (!user) throw new AuthorizationError("AUTHENTICATION_REQUIRED");
  return identityForSubject(user.id);
}

export async function signOutSupabaseCookies(
  cookieStore: SessionCookieStore,
): Promise<void> {
  const client = createSupabaseCookieClient(cookieStore);
  const { error } = await client.auth.signOut({ scope: "local" });
  if (error) throw new AuthorizationError("PROVIDER_FAILURE");
}
