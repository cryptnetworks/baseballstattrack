import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "prisma/migrations/20260806010000_configuration_entries/migration.sql",
  "utf8",
);

describe("configuration entry migration", () => {
  it("stores identity and references without secret material", () => {
    expect(migration).toContain('CREATE TABLE "ConfigurationEntry"');
    expect(migration).toContain('CREATE TABLE "SecretReference"');
    expect(migration).toContain('"referenceIdentifier" TEXT NOT NULL');
    expect(migration).toContain('"visibility" "ConfigurationVisibility"');
    expect(migration).toContain("configuration_contains_secret_key");
    expect(migration).toContain('"secretReferenceId" IS NOT NULL');
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
  });
});
