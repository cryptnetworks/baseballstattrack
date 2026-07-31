import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const overrideRoute = readFileSync(
  "src/app/api/admin/rate-limit-overrides/route.ts",
  "utf8",
);
const accountAction = readFileSync("src/app/accounts/actions.ts", "utf8");
const scoringService = readFileSync(
  "src/server/app/game-event-service.ts",
  "utf8",
);

describe("rate-limit application boundaries", () => {
  it("protects override grant and revocation with origin, authority, limits, and audit service", () => {
    expect(overrideRoute.match(/requireSameOrigin\(request\)/gu)).toHaveLength(
      2,
    );
    expect(overrideRoute).toContain('"account.manage"');
    expect(overrideRoute).toContain('endpointClass: "ADMINISTRATION"');
    expect(overrideRoute).toContain("grantOverride(input, actor)");
    expect(overrideRoute).toContain("revokeOverride(input, actor)");
    expect(overrideRoute).toContain('"Cache-Control": "no-store"');
  });

  it("enforces Account selection and scoring at trusted server boundaries", () => {
    expect(accountAction).toContain('endpointClass: "ACCOUNT_SELECTION"');
    expect(scoringService).toContain('"SCORING_MUTATION"');
    expect(scoringService).toContain('"CORRECTION_VERIFICATION"');
    expect(scoringService).toContain("clientSubmissionId");
    expect(scoringService).toContain("rateLimitFingerprint");
  });
});
