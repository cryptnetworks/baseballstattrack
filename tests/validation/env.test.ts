import { describe, expect, it } from "vitest";

import { parseServerEnv } from "@/lib/env";

describe("parseServerEnv", () => {
  it("defaults safe local development values", () => {
    expect(parseServerEnv({})).toMatchObject({
      NODE_ENV: "development",
      NEXT_PUBLIC_APP_ENV: "local",
    });
  });

  it("accepts deployment and database boundaries without provider credentials", () => {
    expect(
      parseServerEnv({
        NODE_ENV: "test",
        NEXT_PUBLIC_APP_ENV: "preview",
        NEXT_PUBLIC_SITE_URL: "https://app.example.test",
        DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/postgres",
        DIRECT_URL: "postgresql://postgres:postgres@localhost:5432/postgres",
      }),
    ).toMatchObject({
      NEXT_PUBLIC_APP_ENV: "preview",
      NEXT_PUBLIC_SITE_URL: "https://app.example.test",
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/postgres",
    });
  });
});
