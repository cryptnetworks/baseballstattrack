import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const contract = readFileSync(
  "docs/FANTASY_USER_INTERFACE_AND_NOTIFICATIONS.md",
  "utf8",
);
const audit = readFileSync("docs/M8_EXIT_AUDIT.md", "utf8");

describe("fantasy experience documentation", () => {
  it("documents UI, notification, authorization, privacy, and persistence contracts", () => {
    for (const heading of [
      "Experience model",
      "Persistence and atomicity",
      "Authorization and delegated access",
      "Notifications and consent",
      "Accessibility and responsive behavior",
      "Privacy and retention",
      "Operational boundary",
    ]) {
      expect(contract).toContain(`## ${heading}`);
    }
    expect(contract).toContain("never synthesizes a score in the browser");
    expect(contract).toContain(
      "delegated browser requests therefore fail closed",
    );
  });

  it("audits all M8 dependencies and defers M9", () => {
    for (const issue of [
      "#101",
      "#106",
      "#107",
      "#123",
      "#124",
      "#125",
      "#126",
      "#127",
    ]) {
      expect(audit).toMatch(new RegExp(`\\| ${issue}\\s+\\|`));
    }
    expect(audit).toContain("## Architecture review");
    expect(audit).toContain("## Security review");
    expect(audit).toContain("## Privacy review");
    expect(audit).toContain("## Remaining risks");
    expect(audit).toContain("## M9 deferrals");
    expect(audit).toContain("M9 is not started");
  });
});
