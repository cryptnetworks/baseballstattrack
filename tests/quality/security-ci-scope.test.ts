import { describe, expect, it } from "vitest";

import { planSecurityAuditScopes } from "../../scripts/plan-security-ci.mjs";

describe("security audit scope planner", () => {
  it("separates Node and Python dependency audits", () => {
    expect(planSecurityAuditScopes(["package-lock.json"])).toEqual({
      containers: true,
      nodeDependencies: true,
      pythonDependencies: false,
      sast: false,
    });
    expect(
      planSecurityAuditScopes(["services/discord-bot/requirements.lock"]),
    ).toEqual({
      containers: true,
      nodeDependencies: false,
      pythonDependencies: true,
      sast: false,
    });
  });

  it("runs only container scanning for an image-definition change", () => {
    expect(
      planSecurityAuditScopes(["services/discord-bot/Dockerfile"]),
    ).toEqual({
      containers: true,
      nodeDependencies: false,
      pythonDependencies: false,
      sast: false,
    });
  });

  it("enables the complete scheduled audit", () => {
    expect(planSecurityAuditScopes([], { forceFull: true })).toEqual({
      containers: true,
      nodeDependencies: true,
      pythonDependencies: true,
      sast: true,
    });
  });

  it("selects SAST for analyzable source and workflow changes", () => {
    expect(planSecurityAuditScopes(["src/app/page.tsx"]).sast).toBe(true);
    expect(planSecurityAuditScopes([".github/workflows/ci.yml"]).sast).toBe(
      true,
    );
    expect(planSecurityAuditScopes(["services/discord-bot/bot.py"]).sast).toBe(
      true,
    );
  });

  it("does not select SAST for documentation-only changes", () => {
    expect(planSecurityAuditScopes(["docs/CI_QUALITY_GATES.md"]).sast).toBe(
      false,
    );
  });
});
