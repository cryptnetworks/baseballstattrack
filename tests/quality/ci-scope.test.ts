import { describe, expect, it } from "vitest";

import { planCiScopes } from "../../scripts/plan-ci.mjs";

describe("CI scope planner", () => {
  it("uses only the lightweight documentation gate for documentation", () => {
    expect(planCiScopes(["docs/CI_QUALITY_GATES.md"])).toEqual({
      application: false,
      api: false,
      containers: false,
      database: false,
      discord: false,
      documentation: true,
      operations: false,
    });
  });

  it("isolates Discord service changes from the Node application", () => {
    expect(
      planCiScopes(["services/discord-bot/src/baseball_bot/bot.py"]),
    ).toMatchObject({
      application: false,
      containers: false,
      discord: true,
      documentation: false,
    });
  });

  it("runs application, container, and operational gates for the installer", () => {
    expect(planCiScopes(["scripts/deploy/install.ts"])).toMatchObject({
      application: true,
      containers: true,
      operations: true,
    });
    expect(planCiScopes(["install.sh", "install.ps1"])).toMatchObject({
      application: true,
      containers: true,
      operations: true,
    });
  });

  it("runs database, operational, and container proofs for migrations", () => {
    expect(
      planCiScopes(["prisma/migrations/20260802000000_example/migration.sql"]),
    ).toMatchObject({
      application: true,
      containers: true,
      database: true,
      operations: true,
    });
  });

  it("checks API compatibility only for the versioned API boundary", () => {
    expect(planCiScopes(["src/app/api/v1/accounts/route.ts"])).toMatchObject({
      application: true,
      api: true,
    });
    expect(planCiScopes(["src/components/app-shell.tsx"])).toMatchObject({
      application: true,
      api: false,
    });
  });

  it("runs every gate when the CI planner changes", () => {
    expect(Object.values(planCiScopes([".github/workflows/ci.yml"]))).toEqual(
      Array(7).fill(true),
    );
  });

  it("limits dependency changes to the Node application and its images", () => {
    expect(planCiScopes(["package-lock.json"])).toEqual({
      application: true,
      api: false,
      containers: true,
      database: false,
      discord: false,
      documentation: false,
      operations: false,
    });
  });

  it("validates application and container ownership for environment templates", () => {
    expect(planCiScopes([".env.local.example"])).toMatchObject({
      application: true,
      containers: false,
    });
    expect(planCiScopes([".env.production.example"])).toMatchObject({
      application: true,
      containers: true,
    });
  });

  it("validates workflow policy without exercising unrelated runtimes", () => {
    expect(planCiScopes([".github/workflows/main-push-sast.yml"])).toEqual({
      application: false,
      api: false,
      containers: false,
      database: false,
      discord: false,
      documentation: true,
      operations: false,
    });

    expect(planCiScopes([".github/workflows/release.yml"])).toMatchObject({
      application: false,
      containers: true,
      discord: false,
      documentation: true,
    });
  });

  it("fails safe for an unknown path or an unavailable diff", () => {
    expect(planCiScopes(["new-runtime.config"])).toMatchObject({
      application: true,
    });
    expect(planCiScopes(["Dockerfile", "new-runtime.config"])).toMatchObject({
      application: true,
      containers: true,
    });
    expect(Object.values(planCiScopes([]))).toEqual(Array(7).fill(true));
  });
});
