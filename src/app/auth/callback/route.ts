import { NextResponse } from "next/server";

import { createSupabaseNextClient } from "@/server/auth/next-session";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
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
