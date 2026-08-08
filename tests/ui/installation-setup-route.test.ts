import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const page = readFileSync("src/app/setup/page.tsx", "utf8");
const actions = readFileSync("src/app/setup/actions.ts", "utf8");
const service = readFileSync(
  "src/server/app/installation-setup-service.ts",
  "utf8",
);

describe("first-launch setup route", () => {
  it("uses existing authentication and Account authorization boundaries", () => {
    expect(actions).toContain("getOAuthAuthenticationService");
    expect(actions).toContain("getLocalAuthenticationService");
    expect(actions).toContain("authenticatePageSession");
    expect(page).toContain("getAuthorizationService().authorize");
    expect(service).toContain('"configuration.manage"');
  });

  it("collects only non-secret application identity and reports deployment-owned failures", () => {
    expect(page).toContain('name="installationName"');
    expect(page).toContain('name="organizationName"');
    expect(page).toContain('name="timezone"');
    expect(page).toContain('name="locale"');
    expect(page).toContain("Deployment configuration required");
    for (const forbidden of [
      'name="databaseUrl"',
      'name="clientSecret"',
      'name="apiKey"',
      'name="workerToken"',
    ])
      expect(page).not.toContain(forbidden);
  });
});
