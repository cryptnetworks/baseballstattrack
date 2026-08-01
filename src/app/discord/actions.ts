"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { discordSettingsSectionSchema } from "@/domain/discord-settings-navigation";
import { getRateLimitService } from "@/server/app/rate-limit-service";
import { getAuthorizationService } from "@/server/auth/application";
import { authenticatePageSession } from "@/server/auth/next-session";
import { authorizeProtectedAction } from "@/server/auth/protected-boundary";
import { selectedAccountCookie } from "@/server/auth/request-security";

const accountIdSchema = z.string().trim().min(1).max(128);

export async function selectDiscordAccount(formData: FormData): Promise<never> {
  const requestHeaders = await headers();
  const accountId = accountIdSchema.parse(formData.get("accountId"));
  const section = discordSettingsSectionSchema.parse(formData.get("section"));
  const actor = await authorizeProtectedAction({
    origin: requestHeaders.get("origin"),
    host: requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"),
    authenticate: authenticatePageSession,
    authorization: getAuthorizationService(),
    target: { kind: "ACCOUNT", accountId },
    capability: "discord.settings.view",
  });
  await getRateLimitService().enforce(
    { accountId, endpointClass: "ACCOUNT_SELECTION" },
    actor,
  );
  (await cookies()).set(
    selectedAccountCookie.name,
    accountId,
    selectedAccountCookie.options,
  );
  redirect(`/discord/${section}`);
}
