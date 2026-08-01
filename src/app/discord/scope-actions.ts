"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { parseDiscordTrackedScopeKey } from "@/domain/discord-tracked-scopes";
import { RateLimitError } from "@/domain/rate-limits";
import { DiscordSettingsError } from "@/server/app/discord-settings-service";
import {
  DiscordTrackedScopesError,
  getDiscordTrackedScopesService,
} from "@/server/app/discord-tracked-scopes-service";
import { getAuthorizationService } from "@/server/auth/application";
import { authenticatePageSession } from "@/server/auth/next-session";
import { authorizeProtectedAction } from "@/server/auth/protected-boundary";

const accountId = z.string().trim().min(1).max(128);
const installationId = z.uuid();

async function authorize(account: string) {
  const requestHeaders = await headers();
  return authorizeProtectedAction({
    origin: requestHeaders.get("origin"),
    host: requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"),
    authenticate: authenticatePageSession,
    authorization: getAuthorizationService(),
    target: { kind: "ACCOUNT", accountId: account },
    capability: "discord.settings.configure",
  });
}

function resultUrl(server: string, result: "notice" | "error", code: string) {
  const search = new URLSearchParams({ server, [result]: code });
  return `/discord/teams?${search.toString()}`;
}

function safeError(error: unknown) {
  if (error instanceof z.ZodError) return "validation";
  if (error instanceof RateLimitError) return "rate-limited";
  if (error instanceof DiscordSettingsError) {
    if (error.code === "REVISION_CONFLICT") return "conflict";
    if (error.code === "INSTALLATION_INACTIVE") return "inactive";
    return "unavailable";
  }
  if (error instanceof DiscordTrackedScopesError) {
    if (error.code === "STALE_SCOPE") return "stale";
    if (error.code === "INSTALLATION_INACTIVE") return "inactive";
    return "unavailable";
  }
  throw error;
}

export async function saveDiscordTrackedScopes(formData: FormData) {
  const account = accountId.parse(formData.get("accountId"));
  const installation = installationId.parse(formData.get("installationId"));
  const actor = await authorize(account);
  let errorCode: string | null = null;
  try {
    await getDiscordTrackedScopesService().update(
      {
        accountId: account,
        installationId: installation,
        expectedRevision: z.coerce
          .number()
          .int()
          .min(0)
          .parse(formData.get("expectedRevision")),
        trackedScopes: formData
          .getAll("scope")
          .map(parseDiscordTrackedScopeKey),
      },
      actor,
    );
  } catch (error) {
    errorCode = safeError(error);
  }
  redirect(
    resultUrl(
      installation,
      errorCode ? "error" : "notice",
      errorCode ?? "saved",
    ),
  );
}
