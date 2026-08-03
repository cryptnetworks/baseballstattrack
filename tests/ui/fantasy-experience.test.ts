import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const manager = readFileSync(
  "src/components/fantasy/fantasy-league-manager.tsx",
  "utf8",
);
const page = readFileSync("src/app/fantasy/[[...section]]/page.tsx", "utf8");
const actions = readFileSync("src/app/fantasy/actions.ts", "utf8");
const exportRoute = readFileSync("src/app/api/fantasy/export/route.ts", "utf8");

describe("fantasy experience UI", () => {
  it("provides every M8 fantasy view and explicit uncertainty", () => {
    for (const section of [
      "overview",
      "team",
      "roster",
      "transactions",
      "standings",
      "scoring",
      "notifications",
      "commissioner",
    ]) {
      expect(manager).toContain(section);
    }
    expect(manager).toContain("Uncertainty");
    expect(manager).toContain("Prior result lineage");
    expect(manager).toContain("remains preserved");
  });

  it("uses keyboard-native controls, focus targets, and accessible tables", () => {
    expect(page).toContain('id="main-content"');
    expect(page).toContain("tabIndex={-1}");
    expect(manager.match(/<caption/g)?.length).toBeGreaterThanOrEqual(3);
    expect(manager).toContain('scope="col"');
    expect(manager).toContain('scope="row"');
    expect(manager).toContain('aria-current={item === section ? "page"');
    expect(manager).toContain('role={error ? "alert" : "status"}');
    expect(manager).not.toMatch(/onKeyDown|tabIndex=\{[1-9]/);
  });

  it("re-authorizes mutations and exports at exact Account boundaries", () => {
    expect(actions).toContain("authorizeProtectedAction");
    expect(actions).toContain("selectedAccountCookie.name");
    expect(actions).toContain('authorize(accountId, "fantasy.team.manage")');
    expect(actions).toContain('commissioner ? "fantasy.league.manage"');
    expect(exportRoute).toContain("selectedAccountCookie.name");
    expect(exportRoute).toContain('"fantasy.league.manage"');
    expect(exportRoute).toContain('"Cache-Control": "private, no-store"');
  });
});
