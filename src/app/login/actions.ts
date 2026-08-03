"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";

import { getOAuthAuthenticationService } from "@/server/app/oauth-authentication-service";
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

export async function signOut(): Promise<never> {
  await requireActionOrigin();
  await getApplicationSessionService().revokeCookies(await nextCookieStore());
  redirect("/login");
}
