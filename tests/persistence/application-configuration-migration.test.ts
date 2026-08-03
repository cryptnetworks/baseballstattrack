import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "prisma/migrations/20260803143000_application_configuration/migration.sql",
  "utf8",
);

describe("application configuration migration", () => {
  it("creates Account-scoped current state and append-only revision history", () => {
    expect(migration).toContain('CREATE TABLE "ApplicationConfiguration"');
    expect(migration).toContain(
      'CREATE TABLE "ApplicationConfigurationRevision"',
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "ApplicationConfiguration_accountId_key"',
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "ApplicationConfigurationRevision_configurationId_revision_key"',
    );
    expect(migration).toContain(
      "prevent_application_configuration_history_mutation",
    );
    expect(migration).toContain(
      'NEW."currentRevision" <> OLD."currentRevision" + 1',
    );
    expect(migration).toContain(
      "application configuration head must match its immutable revision",
    );
    expect(migration).toContain(
      "application configuration revision lineage must be contiguous",
    );
    expect(migration).toContain(
      'CREATE CONSTRAINT TRIGGER "ApplicationConfiguration_history_required"',
    );
  });

  it("rejects secret-shaped keys and direct API access", () => {
    expect(migration).toContain("configuration_contains_secret_key");
    expect(migration).toContain(
      "(secret|token|password|api[_-]?key|private[_-]?key|signing[_-]?key)",
    );
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain(
      "FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role']",
    );
    expect(migration).toContain(
      "'REVOKE ALL ON TABLE %I FROM %I', 'ApplicationConfiguration'",
    );
  });
});
