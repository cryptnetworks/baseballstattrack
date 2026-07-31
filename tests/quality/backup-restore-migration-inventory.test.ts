import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

const script = resolve("scripts/verify-backup-restore.sh");
const temporaryRoots: string[] = [];

function migration(root: string, name: string) {
  const directory = join(root, name);
  mkdirSync(directory);
  writeFileSync(join(directory, "migration.sql"), "SELECT 1;\n");
}

function inventory(root: string) {
  return spawnSync("bash", [script], {
    encoding: "utf8",
    env: {
      ...process.env,
      MIGRATION_INVENTORY_ONLY: "1",
      MIGRATION_ROOT: root,
    },
  });
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("backup restore migration inventory", () => {
  it("automatically includes a newly checked-in migration", () => {
    const root = mkdtempSync(join(tmpdir(), "bst-migration-inventory-"));
    temporaryRoots.push(root);
    migration(root, "20260729000000_initial");
    migration(root, "20260731190000_existing");

    const before = inventory(root);
    expect(before).toMatchObject({ status: 0, stderr: "" });
    expect(before.stdout.trim().split("\n")).toEqual([
      "20260729000000_initial",
      "20260731190000_existing",
    ]);

    migration(root, "20260731213000_new_migration");
    const after = inventory(root);
    expect(after).toMatchObject({ status: 0, stderr: "" });
    expect(after.stdout.trim().split("\n")).toEqual([
      "20260729000000_initial",
      "20260731190000_existing",
      "20260731213000_new_migration",
    ]);
  });

  it("rejects a migration directory without migration.sql", () => {
    const root = mkdtempSync(join(tmpdir(), "bst-migration-inventory-"));
    temporaryRoots.push(root);
    mkdirSync(join(root, "20260731220000_incomplete"));

    const result = inventory(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("has no migration.sql");
  });
});
