import { describe, expect, it } from "vitest";

import { planSecurityAuditScopes } from "../../scripts/plan-security-ci.mjs";

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
