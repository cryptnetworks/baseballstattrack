import { describe, expect, it } from "vitest";

import { getApplicationReadiness } from "@/server/app/readiness-service";

const configuredEnvironment = {
  DATABASE_URL: "postgresql://synthetic:synthetic@db:5432/synthetic",
  REQUIRED_DATABASE_MIGRATION: "20260731173000_product_analytics_consent",
};

describe("getApplicationReadiness", () => {
  it("fails closed when required runtime configuration is absent", async () => {
    await expect(getApplicationReadiness({})).resolves.toEqual({
      status: "not_ready",
      checks: {
        configuration: false,
        database: false,
        schema: false,
        migration: false,
      },
    });
  });

  it("fails closed when the required migration pin is malformed", async () => {
    await expect(
      getApplicationReadiness({
        ...configuredEnvironment,
        REQUIRED_DATABASE_MIGRATION: "latest",
      }),
    ).resolves.toEqual({
      status: "not_ready",
      checks: {
        configuration: false,
        database: false,
        schema: false,
        migration: false,
      },
    });
  });

  it("does not expose a database failure", async () => {
    const readiness = await getApplicationReadiness(
      configuredEnvironment,
      async () => {
        throw new Error(
          "postgresql://private-user:private-password@private-host/private-db",
        );
      },
    );

    expect(readiness).toEqual({
      status: "not_ready",
      checks: {
        configuration: true,
        database: false,
        schema: false,
        migration: false,
      },
    });
    expect(JSON.stringify(readiness)).not.toContain("private");
  });

  it("distinguishes an available database from absent schema", async () => {
    await expect(
      getApplicationReadiness(configuredEnvironment, async () => ({
        database: true,
        schema: false,
        migration: false,
      })),
    ).resolves.toEqual({
      status: "not_ready",
      checks: {
        configuration: true,
        database: true,
        schema: false,
        migration: false,
      },
    });
  });

  it("requires both schema and the pinned migration", async () => {
    await expect(
      getApplicationReadiness(configuredEnvironment, async () => ({
        database: true,
        schema: true,
        migration: true,
      })),
    ).resolves.toEqual({
      status: "ready",
      checks: {
        configuration: true,
        database: true,
        schema: true,
        migration: true,
      },
    });
  });
});
