"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";

import { AuthorizationError } from "@/server/auth/errors";
import {
  createSupabaseNextClient,
  nextCookieStore,
} from "@/server/auth/next-session";
import { requireSameOriginValues } from "@/server/auth/request-security";
import { signOutSupabaseCookies } from "@/server/auth/supabase-session";
import { deploymentConfiguration } from "@/server/config/runtime-environment";

const supportedProviders = new Set(["google", "github", "azure"]);

async function requireActionOrigin() {
  const requestHeaders = await headers();
  requireSameOriginValues(
    requestHeaders.get("origin"),
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"),
  );
}

export async function signIn(): Promise<never> {
  await requireActionOrigin();
  const deployment = deploymentConfiguration();
  const siteUrl = deployment.siteUrl;
  const configuredProvider = deployment.supabaseOauthProvider;
  if (!siteUrl || !supportedProviders.has(configuredProvider)) {
    throw new AuthorizationError(
      "CONFIGURATION_ERROR",
      "Authentication sign-in is not configured.",
    );
  }
  const client = await createSupabaseNextClient();
  const { data, error } = await client.auth.signInWithOAuth({
    provider: configuredProvider as "google" | "github" | "azure",
    options: {
      redirectTo: new URL("/auth/callback", siteUrl).toString(),
      skipBrowserRedirect: true,
    },
  });
  if (error || !data.url) {
    throw new AuthorizationError(
      "CONFIGURATION_ERROR",
      "Authentication sign-in is unavailable.",
    );
  }
  redirect(data.url);
}

export async function signOut(): Promise<never> {
  await requireActionOrigin();
  await signOutSupabaseCookies(await nextCookieStore());
  redirect("/login");
}
