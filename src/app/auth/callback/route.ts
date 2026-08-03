import { NextResponse } from "next/server";

import { createSupabaseNextClient } from "@/server/auth/next-session";
import { deploymentConfiguration } from "@/server/config/runtime-environment";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const siteUrl = deploymentConfiguration().siteUrl;
  const redirectOrigin = siteUrl ? new URL(siteUrl).origin : requestUrl.origin;
  const code = requestUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.redirect(new URL("/login", redirectOrigin));
  }
  const client = await createSupabaseNextClient();
  const { error } = await client.auth.exchangeCodeForSession(code);
  return NextResponse.redirect(
    new URL(error ? "/login" : "/accounts", redirectOrigin),
  );
}
