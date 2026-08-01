import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

const script = resolve("scripts/check-database-storage.sh");
const workspaces: string[] = [];

function fakeDf(output: string, exitCode = 0) {
  const root = mkdtempSync(join(tmpdir(), "bst-storage-health-"));
  const bin = join(root, "bin");
  workspaces.push(root);
  mkdirSync(bin);
  const executable = join(bin, "df");
  writeFileSync(
    executable,
    `#!/bin/sh\nprintf '%s\\n' '${output.replaceAll("'", "'\\''")}'\nexit ${exitCode}\n`,
  );
  chmodSync(executable, 0o700);
  return `${bin}:${process.env.PATH ?? "/usr/bin:/bin"}`;
}

function runCheck(path: string, environment: Record<string, string> = {}) {
  return spawnSync("/bin/bash", [script], {
    encoding: "utf8",
    env: {
      ...process.env,
      DB_STORAGE_PATH: path,
      DB_STORAGE_VOLUME_NAME: "test-postgres-volume",
      ...environment,
    },
  });
}

function measured(usage: number) {
  const total = 104_857_600;
  const used = Math.ceil((total * usage) / 100);
  const available = total - used;
  return [
    "Filesystem 1024-blocks Used Available Capacity Mounted on",
    `fixture ${total} ${used} ${available} ${usage}% /database`,
  ].join("\n");
}

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

describe("database storage health check", () => {
  it("reports healthy storage below 70 percent", () => {
    const result = runCheck("/database", { PATH: fakeDf(measured(69)) });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Status:\nHealthy");
    expect(result.stdout).toContain("Capacity:\n100.00 GiB");
    expect(result.stdout).toContain("database_storage_usage_percent 69");
  });

  it("reports warning storage from 70 through 75 percent", () => {
    for (const usage of [70, 75]) {
      const result = runCheck("/database", { PATH: fakeDf(measured(usage)) });

      expect(result.status).toBe(1);
      expect(result.stdout).toContain("Status:\nWarning");
    }
  });

  it("reports critical storage above 75 percent", () => {
    const result = runCheck("/database", { PATH: fakeDf(measured(76)) });

    expect(result.status).toBe(2);
    expect(result.stdout).toContain("Status:\nCritical");
    expect(result.stdout).toContain(
      "Increase storage capacity before continuing normal operations.",
    );
  });

  it("fails safely when the filesystem path is missing", () => {
    const result = runCheck("/private/missing-database-path", {
      PATH: fakeDf("", 1),
    });

    expect(result.status).toBe(3);
    expect(result.stdout).toContain("Status:\nUnknown");
    expect(result.stdout).not.toContain("/private/missing-database-path");
  });

  it("fails safely when filesystem permissions are denied", () => {
    const result = runCheck("/private/database-path", {
      PATH: fakeDf("permission denied", 1),
    });

    expect(result.status).toBe(3);
    expect(result.stdout).toContain("Status:\nUnknown");
    expect(result.stdout).not.toContain("permission denied");
    expect(result.stdout).not.toContain("/private/database-path");
  });

  it("fails safely when filesystem inspection is unsupported", () => {
    const root = mkdtempSync(join(tmpdir(), "bst-storage-unsupported-"));
    workspaces.push(root);

    const result = runCheck("/database", { PATH: root });

    expect(result.status).toBe(3);
    expect(result.stdout).toContain("Status:\nUnknown");
    expect(result.stdout).toContain("filesystem information was unavailable");
  });

  it("rejects threshold overrides that weaken the production policy", () => {
    const result = runCheck("/database", {
      PATH: fakeDf(measured(69)),
      DB_STORAGE_WARNING_PERCENT: "80",
      DB_STORAGE_CRITICAL_PERCENT: "90",
    });

    expect(result.status).toBe(3);
    expect(result.stderr).toContain("warning <= 70, critical <= 75");
  });

  it("does not echo an unsafe volume label", () => {
    const result = runCheck("/database", {
      PATH: fakeDf(measured(69)),
      DB_STORAGE_VOLUME_NAME: "volume\nforged-log-line",
    });

    expect(result.status).toBe(3);
    expect(result.stdout).toContain("Volume:\ninvalid-volume-label");
    expect(result.stdout).not.toContain("forged-log-line");
  });
});
