"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getInstallationSetupService } from "@/server/app/installation-setup-service";
import { ApplicationConfigurationError } from "@/server/app/application-configuration-service";
import { getLocalAuthenticationService } from "@/server/app/local-authentication-service";
import { getOAuthAuthenticationService } from "@/server/app/oauth-authentication-service";
import { AuthorizationError } from "@/server/auth/errors";
import {
  authenticatePageSession,
  nextCookieStore,
} from "@/server/auth/next-session";
import { requireSameOriginValues } from "@/server/auth/request-security";
import { InstallationSetupError } from "@/server/data/installation-setup-repository";

async function requireActionOrigin() {
  const requestHeaders = await headers();
  requireSameOriginValues(
    requestHeaders.get("origin"),
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"),
  );
}

function setupError(error: unknown) {
  if (error instanceof z.ZodError)
    return "Review the setup values and try again.";
  if (error instanceof AuthorizationError)
    return "Administrator authorization is required.";
  if (
    error instanceof InstallationSetupError ||
    error instanceof ApplicationConfigurationError
  )
    return error.message;
  return "Setup could not be completed safely.";
}

export async function signInSetupOAuth(formData: FormData): Promise<never> {
  await requireActionOrigin();
  const provider = z.string().trim().parse(formData.get("provider"));
  const started = await getOAuthAuthenticationService().startSignIn(
    provider,
    "/setup",
  );
  (await nextCookieStore()).setAll([started.cookie]);
  redirect(started.authorizationUrl);
}

export async function signInSetupLocal(formData: FormData): Promise<never> {
  await requireActionOrigin();
  try {
    const started = await getLocalAuthenticationService().signIn(
      z.string().parse(formData.get("username")),
      z.string().parse(formData.get("password")),
    );
    (await nextCookieStore()).setAll([started.cookie]);
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof AuthorizationError)
      redirect("/setup?error=Invalid%20local%20credentials.");
    throw error;
  }
  redirect("/setup");
}

export async function bootstrapAdministrator(
  formData: FormData,
): Promise<never> {
  await requireActionOrigin();
  try {
    const identity = await authenticatePageSession();
    if (!identity) throw new AuthorizationError("AUTHENTICATION_REQUIRED");
    await getInstallationSetupService().bootstrap(identity, {
      accountName: formData.get("accountName"),
      accountSlug: formData.get("accountSlug"),
    });
  } catch (error) {
    redirect(`/setup?error=${encodeURIComponent(setupError(error))}`);
  }
  redirect("/setup?notice=Initial%20administrator%20created.");
}

export async function initializeConfiguration(
  formData: FormData,
): Promise<never> {
  await requireActionOrigin();
  try {
    const identity = await authenticatePageSession();
    if (!identity) throw new AuthorizationError("AUTHENTICATION_REQUIRED");
    await getInstallationSetupService().configure(identity, {
      accountId: formData.get("accountId"),
      identity: {
        installationName: formData.get("installationName"),
        organizationName: formData.get("organizationName"),
        timezone: formData.get("timezone"),
        locale: formData.get("locale"),
      },
    });
  } catch (error) {
    redirect(`/setup?error=${encodeURIComponent(setupError(error))}`);
  }
  redirect("/setup?notice=Application%20identity%20saved.");
}

export async function completeSetup(): Promise<never> {
  await requireActionOrigin();
  try {
    const identity = await authenticatePageSession();
    if (!identity) throw new AuthorizationError("AUTHENTICATION_REQUIRED");
    await getInstallationSetupService().complete(identity);
  } catch (error) {
    redirect(`/setup?error=${encodeURIComponent(setupError(error))}`);
  }
  redirect("/settings/configuration?notice=First-launch%20setup%20complete.");
}
