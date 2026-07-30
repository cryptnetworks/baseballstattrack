"use server";

import { cookies } from "next/headers";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getAuthorizationService } from "@/server/auth/application";
import { authenticatePageSession } from "@/server/auth/next-session";
import { authorizeProtectedAction } from "@/server/auth/protected-boundary";
import { selectedAccountCookie } from "@/server/auth/request-security";

const accountIdSchema = z.string().trim().min(1).max(128);

export async function selectAccount(formData: FormData): Promise<never> {
  const requestHeaders = await headers();
  const accountId = accountIdSchema.parse(formData.get("accountId"));
  await authorizeProtectedAction({
    origin: requestHeaders.get("origin"),
    host: requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"),
    authenticate: authenticatePageSession,
    authorization: getAuthorizationService(),
    target: { kind: "ACCOUNT", accountId },
    capability: "account.view",
  });
  const store = await cookies();
  store.set(
    selectedAccountCookie.name,
    accountId,
    selectedAccountCookie.options,
  );
  redirect("/games/setup");
}
