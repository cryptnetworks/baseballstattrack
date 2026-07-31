import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const exportRoute = readFileSync("src/app/api/data/export/route.ts", "utf8");
const requestRoute = readFileSync(
  "src/app/api/privacy/requests/route.ts",
  "utf8",
);
const lifecycle = readFileSync(
  "src/server/app/privacy-lifecycle-service.ts",
  "utf8",
);

describe("privacy lifecycle HTTP boundaries", () => {
  it("keeps export proof out of URLs and reauthorizes every artifact action", () => {
    expect(exportRoute).toContain('request.headers.get("x-export-token")');
    expect(exportRoute).not.toMatch(/searchParams\.get\("token"\)/u);
    expect(exportRoute).toContain("exportActor(request, input.accountId)");
    expect(exportRoute).toContain("private, no-store, max-age=0");
    expect(exportRoute).not.toContain("Access-Control-Allow-Origin");
  });

  it("requires same-origin destructive requests and target-specific capabilities", () => {
    expect(requestRoute.match(/requireSameOrigin\(request\)/gu)).toHaveLength(
      2,
    );
    expect(requestRoute).toContain('"account.delete_request"');
    expect(requestRoute).toContain('"privacy.request"');
    expect(requestRoute).toContain('"privacy.manage"');
    expect(requestRoute).toContain("authorizeProtectedRequest");
    expect(requestRoute).toContain('"Cache-Control": "no-store"');
  });

  it("limits execution to a service actor and uses exact confirmations", () => {
    expect(lifecycle).toContain('actor.actorKind !== "SERVICE"');
    expect(lifecycle).toContain("PRIVACY_CONFIRMATION[parsed.target]");
    expect(lifecycle).toContain("ACCOUNT_DELETION_GRACE_MILLISECONDS");
    expect(lifecycle).toContain("LIFECYCLE_CONFLICT");
  });
});
