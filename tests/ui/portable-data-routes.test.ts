import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const exportRoute = readFileSync("src/app/api/data/export/route.ts", "utf8");
const importRoute = readFileSync(
  "src/app/api/data/import/validate/route.ts",
  "utf8",
);

describe("portable data HTTP boundaries", () => {
  it("reauthorizes export download and returns safe ephemeral headers", () => {
    expect(exportRoute.match(/authorizeProtectedRequest/g)).toHaveLength(3);
    expect(exportRoute).toContain('"report.export"');
    expect(exportRoute).toContain('"Content-Disposition"');
    expect(exportRoute).toContain("application/json; charset=utf-8");
    expect(exportRoute).toContain("private, no-store");
    expect(exportRoute).toContain("noindex, nofollow, noarchive");
    expect(exportRoute).not.toContain("public");
  });

  it("uses a separate same-origin import capability and preflight size limit", () => {
    expect(importRoute).toContain("authorizeProtectedAction");
    expect(importRoute).toContain('"account.manage"');
    expect(importRoute).not.toContain('"report.export"');
    expect(importRoute).toContain("content-length");
    expect(importRoute).toContain("MAX_PORTABLE_BYTES");
    expect(importRoute).toContain("request.arrayBuffer()");
    expect(importRoute).toContain("no-store");
  });
});
