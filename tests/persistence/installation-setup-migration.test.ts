import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "prisma/migrations/20260807010000_installation_setup/migration.sql",
  "utf8",
);

describe("installation setup migration", () => {
  it("creates one server-owned persisted lifecycle record", () => {
    expect(migration).toContain('CREATE TABLE "InstallationSetup"');
    expect(migration).toContain(
      "'NOT_STARTED', 'BOOTSTRAP_IN_PROGRESS', 'ADMIN_CREATED'",
    );
    expect(migration).toContain("'CONFIGURATION_REQUIRED', 'READY'");
    expect(migration).toContain("VALUES ('installation', 'NOT_STARTED'");
    expect(migration).toContain('ON CONFLICT ("id") DO NOTHING');
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("REVOKE ALL ON TABLE");
  });

  it("requires completion actor and timestamp only for READY", () => {
    expect(migration).toContain(
      '(\"status\" = \'READY\') = (\"completedAt\" IS NOT NULL AND \"completedById\" IS NOT NULL)',
    );
  });
});
