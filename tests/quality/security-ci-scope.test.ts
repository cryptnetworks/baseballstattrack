import { describe, expect, it } from "vitest";

import {
  planSecurityAuditScopes,
  planSecurityLanguages,
} from "../../scripts/plan-security-ci.mjs";

describe("security CI scope planner", () => {
  it("scans only Actions for workflow-only changes", () => {
    expect(
      planSecurityLanguages([".github/workflows/main-push-sast.yml"]),
    ).toEqual(["actions"]);
  });

  it("selects JavaScript and Python independently", () => {
    expect(planSecurityLanguages(["src/server/auth/session-store.ts"])).toEqual(
      ["javascript-typescript"],
    );
    expect(
      planSecurityLanguages([
        "services/discord-bot/src/baseball_bot/provider.py",
      ]),
    ).toEqual(["python"]);
  });

  it("deduplicates a mixed-language plan in a stable order", () => {
    expect(
      planSecurityLanguages([
        "src/app/api/auth/route.ts",
        ".github/actions/example/action.yml",
        "services/discord-bot/src/baseball_bot/bot.py",
        "src/app/api/auth/route.ts",
      ]),
    ).toEqual(["actions", "javascript-typescript", "python"]);
  });

  it("does not treat documentation or dependency manifests as SAST input", () => {
    expect(
      planSecurityLanguages([
        "docs/SECURITY_AUDIT.md",
        "package-lock.json",
        "services/discord-bot/requirements.lock",
      ]),
    ).toEqual([]);
  });

  it("enables every language when the diff cannot be trusted", () => {
    expect(planSecurityLanguages([], { forceFull: true })).toEqual([
      "actions",
      "javascript-typescript",
      "python",
    ]);
  });
});

describe("security audit scope planner", () => {
  it("separates Node and Python dependency audits", () => {
    expect(planSecurityAuditScopes(["package-lock.json"])).toEqual({
      containers: true,
      nodeDependencies: true,
      pythonDependencies: false,
    });
    expect(
      planSecurityAuditScopes(["services/discord-bot/requirements.lock"]),
    ).toEqual({
      containers: true,
      nodeDependencies: false,
      pythonDependencies: true,
    });
  });

  it("runs only container scanning for an image-definition change", () => {
    expect(
      planSecurityAuditScopes(["services/discord-bot/Dockerfile"]),
    ).toEqual({
      containers: true,
      nodeDependencies: false,
      pythonDependencies: false,
    });
  });

  it("enables the complete scheduled audit", () => {
    expect(planSecurityAuditScopes([], { forceFull: true })).toEqual({
      containers: true,
      nodeDependencies: true,
      pythonDependencies: true,
    });
  });
});
