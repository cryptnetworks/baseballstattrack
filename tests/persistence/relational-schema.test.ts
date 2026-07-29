import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryFile = (path: string) => resolve(process.cwd(), path);

describe("relational domain schema", () => {
  it("models the required account-owned baseball boundaries without prohibited player fields", async () => {
    const schema = await readFile(
      repositoryFile("prisma/schema.prisma"),
      "utf8",
    );

    for (const model of [
      "Account",
      "Team",
      "Season",
      "TeamSeason",
      "Player",
      "RosterEntry",
      "Game",
      "GameSetupSnapshot",
      "LineupSlotSnapshot",
      "PlayTransaction",
      "SourceEvent",
      "ProjectionCheckpoint",
      "PrivacyOverlay",
    ]) {
      expect(schema).toContain(`model ${model} {`);
    }

    expect(schema).toContain("@@unique([accountId, teamId, seasonId])");
    expect(schema).toContain("@@unique([accountId, gameId, id])");
    expect(schema).toContain("@@unique([gameId, sequence])");
    expect(schema).not.toMatch(
      /\b(dateOfBirth|birthYear|ageBand|email|phone|notes)\b/i,
    );
  });

  it("keeps tenant scope, append-only history, and privacy overlays in database constraints", async () => {
    const migration = await readFile(
      repositoryFile(
        "prisma/migrations/20260729000000_relational_domain_schema/migration.sql",
      ),
      "utf8",
    );

    expect(migration).toContain(
      'FOREIGN KEY ("accountId", "gameId") REFERENCES "Game"("accountId", "id")',
    );
    expect(migration).toContain("MembershipRoleAssignment_scope_check");
    expect(migration).toContain("CapabilityGrant_scope_check");
    expect(migration).toContain("ProjectionCheckpoint_scope_check");
    expect(migration).toContain("PrivacyOverlayField_target_check");
    expect(migration).toContain("SourceEvent_append_only");
    expect(migration).toContain("PrivacyOverlay_append_only");
  });
});
