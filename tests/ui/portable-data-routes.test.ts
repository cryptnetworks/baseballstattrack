import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const exportRoute = readFileSync("src/app/api/data/export/route.ts", "utf8");
const importRoute = readFileSync(
  "src/app/api/data/import/validate/route.ts",
  "utf8",
);

describe("portable data HTTP boundaries", () => {
  it("reauthorizes one-time export preparation, download, and cancellation", () => {
    expect(exportRoute).toContain("exportActor(request, input.accountId)");
    expect(exportRoute).toContain('"report.export"');
    expect(exportRoute).toContain("export async function POST");
    expect(exportRoute).toContain("export async function GET");
    expect(exportRoute).toContain("export async function DELETE");
    expect(exportRoute).toContain('"x-export-token"');
    expect(exportRoute).toContain("requireSameOrigin(request)");
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
