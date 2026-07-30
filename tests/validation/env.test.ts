import { describe, expect, it } from "vitest";

import { parseServerEnv } from "@/lib/env";

describe("parseServerEnv", () => {
  it("defaults safe local development values", () => {
    expect(parseServerEnv({})).toMatchObject({
      NODE_ENV: "development",
      NEXT_PUBLIC_APP_ENV: "local",
    });
  });

  it("accepts configured Supabase and database boundaries", () => {
    expect(
      parseServerEnv({
        NODE_ENV: "test",
        NEXT_PUBLIC_APP_ENV: "preview",
        NEXT_PUBLIC_SITE_URL: "https://app.example.test",
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-anon-key",
        SUPABASE_OAUTH_PROVIDER: "github",
        DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/postgres",
        DIRECT_URL: "postgresql://postgres:postgres@localhost:5432/postgres",
      }),
    ).toMatchObject({
      NEXT_PUBLIC_APP_ENV: "preview",
      NEXT_PUBLIC_SITE_URL: "https://app.example.test",
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_OAUTH_PROVIDER: "github",
    });
  });
});
