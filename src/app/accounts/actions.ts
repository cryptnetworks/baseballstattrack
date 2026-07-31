"use server";

import { cookies } from "next/headers";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getRateLimitService } from "@/server/app/rate-limit-service";
import { getProductAnalyticsService } from "@/server/app/product-analytics-service";
import { getAuthorizationService } from "@/server/auth/application";
import { authenticatePageSession } from "@/server/auth/next-session";
import { authorizeProtectedAction } from "@/server/auth/protected-boundary";
import { selectedAccountCookie } from "@/server/auth/request-security";

const accountIdSchema = z.string().trim().min(1).max(128);

export async function selectAccount(formData: FormData): Promise<never> {
  const requestHeaders = await headers();
  const accountId = accountIdSchema.parse(formData.get("accountId"));
  const actor = await authorizeProtectedAction({
    origin: requestHeaders.get("origin"),
    host: requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"),
    authenticate: authenticatePageSession,
    authorization: getAuthorizationService(),
    target: { kind: "ACCOUNT", accountId },
    capability: "account.view",
  });
  await getRateLimitService().enforce(
    { accountId, endpointClass: "ACCOUNT_SELECTION" },
    actor,
  );
  const store = await cookies();
  store.set(
    selectedAccountCookie.name,
    accountId,
    selectedAccountCookie.options,
  );
  redirect("/games/setup");
}

export async function updateProductAnalyticsPreference(formData: FormData) {
  const requestHeaders = await headers();
  const accountId = accountIdSchema.parse(formData.get("accountId"));
  const status = z
    .enum(["OPTED_IN", "OPTED_OUT"])
    .parse(formData.get("status"));
  const actor = await authorizeProtectedAction({
    origin: requestHeaders.get("origin"),
    host: requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"),
    authenticate: authenticatePageSession,
    authorization: getAuthorizationService(),
    target: { kind: "ACCOUNT", accountId },
    capability: "account.view",
  });
  await getProductAnalyticsService().setPreference(
    { accountId, status },
    actor,
  );
  revalidatePath("/accounts");
}
