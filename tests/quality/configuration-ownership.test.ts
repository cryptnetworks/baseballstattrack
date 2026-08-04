import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const templates = [
  ".env.example",
  ".env.production.example",
  ".env.local.example",
] as const;

const databaseOwnedLegacyKeys = [
  "FEATURE_ICS_CALENDAR_ENABLED",
  "FEATURE_EMAIL_NOTIFICATIONS_ENABLED",
  "FEATURE_DISCORD_NOTIFICATIONS_ENABLED",
  "FEATURE_DISCORD_UPDATES_ENABLED",
  "ICS_FEED_DETAIL_LEVEL",
  "NOTIFICATION_DESTINATIONS_JSON",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_FROM",
  "NOTIFICATION_DISCORD_API_BASE_URL",
  "EXTERNAL_DATA_PROVIDER_BASE_URL",
  "DISCORD_INSTALLATION_CREDENTIAL_REFERENCE",
  "DISCORD_INSTALLATION_API_BASE_URL",
  "DISCORD_INSTALLATION_TIMEOUT_MS",
  "DISCORD_STATISTICS_API_BASE_URL",
  "DISCORD_UPDATE_API_BASE_URL",
  "RATE_LIMIT_POLICIES_JSON",
] as const;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.[cm]?[jt]sx?$/u.test(entry.name) ? [path] : [];
  });
}

describe("configuration ownership policy", () => {
  it("keeps database-owned application settings out of environment templates", () => {
    for (const template of templates) {
      const content = readFileSync(resolve(root, template), "utf8");
      for (const key of databaseOwnedLegacyKeys) {
        expect(content, `${key} leaked into ${template}`).not.toMatch(
          new RegExp(`^${key}=`, "mu"),
        );
      }
    }
  });

  it("isolates local-only values from the production bootstrap", () => {
    const production = readFileSync(
      resolve(root, ".env.production.example"),
      "utf8",
    );
    const local = readFileSync(resolve(root, ".env.local.example"), "utf8");
    expect(production).not.toMatch(
      /localhost|127\.0\.0\.1|\.example\.test|local-only/u,
    );
    expect(local).toContain("Local-development bootstrap only");
    expect(local).toContain("http://localhost:3000");
  });

  it("allows application source to read process.env only at named boundaries", () => {
    const readers = sourceFiles(resolve(root, "src"))
      .filter((path) => readFileSync(path, "utf8").includes("process.env"))
      .map((path) => relative(root, path))
      .sort();
    expect(readers).toEqual([
      "src/lib/runtime-mode.ts",
      "src/server/config/runtime-environment.ts",
    ]);
  });
});
