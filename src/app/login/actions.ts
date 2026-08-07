"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";

import { getOAuthAuthenticationService } from "@/server/app/oauth-authentication-service";
import { getLocalAuthenticationService } from "@/server/app/local-authentication-service";
import { getApplicationSessionService } from "@/server/auth/application-session";
import { nextCookieStore } from "@/server/auth/next-session";
import { requireSameOriginValues } from "@/server/auth/request-security";

async function requireActionOrigin() {
  const requestHeaders = await headers();
  requireSameOriginValues(
    requestHeaders.get("origin"),
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"),
  );
}

export async function signIn(formData: FormData): Promise<never> {
  await requireActionOrigin();
  const provider = z.string().trim().parse(formData.get("provider"));
  const started = await getOAuthAuthenticationService().startSignIn(provider);
  (await nextCookieStore()).setAll([started.cookie]);
  redirect(started.authorizationUrl);
}

export async function signInLocal(formData: FormData): Promise<never> {
  await requireActionOrigin();
  try {
    const username = z.string().parse(formData.get("username"));
    const password = z.string().parse(formData.get("password"));
    const started = await getLocalAuthenticationService().signIn(
      username,
      password,
    );
    (await nextCookieStore()).setAll([started.cookie]);
    redirect("/accounts");
  } catch (error) {
    if (
      error instanceof z.ZodError ||
      (error instanceof Error && error.name === "AuthorizationError")
    ) {
      redirect("/login?error=local_credentials");
    }
    throw error;
  }
}

export async function signOut(): Promise<never> {
  await requireActionOrigin();
  await getApplicationSessionService().revokeCookies(await nextCookieStore());
  redirect("/login");
}
