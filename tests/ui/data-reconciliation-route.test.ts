import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const route = readFileSync(
  "src/app/api/admin/data-reconciliation/route.ts",
  "utf8",
);

describe("operator data reconciliation route", () => {
  it("uses same-origin protected game authorization, quotas, and no-store output", () => {
    expect(route).toContain("authorizeProtectedAction");
    expect(route).toContain('capability: "audit.view"');
    expect(route).toContain('kind: "GAME"');
    expect(route).toContain('endpointClass: "REPORT_GENERATION"');
    expect(route).toContain('"Cache-Control": "private, no-store, max-age=0"');
    expect(route).not.toContain("playerName");
  });
});
