import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "prisma/migrations/20260803121500_fantasy_experience/migration.sql",
  "utf8",
);

describe("fantasy experience migration", () => {
  it("uses Account-scoped keys, append-only history, and source lineage", () => {
    expect(migration).toContain('CREATE TABLE "FantasyLeagueWorkspace"');
    expect(migration).toContain('CREATE TABLE "FantasyLeagueEvent"');
    expect(migration).toContain('CREATE TABLE "FantasyResultSnapshot"');
    expect(migration).toContain('"baseballRulesetVersionIds" TEXT[] NOT NULL');
    expect(migration).toContain(
      '"statisticDerivationVersions" INTEGER[] NOT NULL',
    );
    expect(migration).toContain('"sourceRevisions" INTEGER[] NOT NULL');
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "FantasyLeagueWorkspace_accountId_externalId_key"',
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "FantasyResultSnapshot_fantasyLeagueId_kind_logicalId_revision_k"',
    );
    expect(migration).toContain("prevent_fantasy_history_mutation");
  });

  it("fails direct API access closed and protects revision order", () => {
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain(
      "FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role']",
    );
    expect(migration).toContain(
      "'REVOKE ALL ON TABLE %I FROM %I', 'FantasyLeagueWorkspace'",
    );
    expect(migration).toContain('NEW."revision" <> OLD."revision" + 1');
    expect(migration).toContain(
      'CREATE INDEX "FantasyLeagueWorkspace_accountId_status_updatedAt_idx"',
    );
  });
});
