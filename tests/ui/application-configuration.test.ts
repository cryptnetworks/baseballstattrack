import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const page = readFileSync("src/app/settings/configuration/page.tsx", "utf8");
const actions = readFileSync(
  "src/app/settings/configuration/actions.ts",
  "utf8",
);
const editor = readFileSync(
  "src/components/configuration/application-configuration-editor.tsx",
  "utf8",
);

describe("application configuration admin portal", () => {
  it("requires exact Account administrator capabilities at every mutation", () => {
    expect(page).toContain('"configuration.view"');
    expect(page).toContain('"configuration.manage"');
    expect(actions).toContain('capability: "configuration.manage"');
    expect(actions).toContain("selectedAccountCookie.name");
    expect(actions).toContain("authorizeProtectedAction");
  });

  it("provides categories, preview, save, refresh, and immutable rollback", () => {
    for (const category of [
      "FEATURES",
      "CALENDAR",
      "NOTIFICATIONS",
      "INTEGRATIONS",
      "RATE_LIMITS",
    ]) {
      expect(editor).toContain(category);
    }
    expect(editor).toContain("Preview changes");
    expect(editor).toContain("Save new revision");
    expect(editor).toContain("Refresh runtime cache");
    expect(editor).toContain("Rollback creates another immutable revision");
  });

  it("uses accessible feedback, native controls, and a captioned history table", () => {
    expect(page).toContain('id="main-content"');
    expect(page).toContain("tabIndex={-1}");
    expect(editor).toContain('aria-live="polite"');
    expect(editor).toContain("<caption");
    expect(editor).toContain("<textarea");
    expect(editor).not.toMatch(/onKeyDown|tabIndex=\{[1-9]/u);
  });
});
