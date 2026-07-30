import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const page = readFileSync("src/app/reports/season/page.tsx", "utf8");
const shell = readFileSync("src/components/app/application-shell.tsx", "utf8");
const playerPage = readFileSync(
  "src/app/reports/season/players/[playerId]/page.tsx",
  "utf8",
);

describe("season dashboard presentation", () => {
  it("uses semantic tables, headings, status text, and source links", () => {
    expect(page).toContain('aria-label="Dashboard filters"');
    expect(page).toContain("<caption");
    expect(page).toContain('scope="col"');
    expect(page).toContain('scope="row"');
    expect(page).toContain("verified games only");
    expect(page).toContain("correctedAwaitingReverification");
    expect(page).toContain("/box-score");
    expect(page).toContain("/reports/season/players/");
  });

  it("keeps responsive tables locally scrollable and controls touch sized", () => {
    expect(page).toContain("overflow-x-auto");
    expect(page).toContain("min-h-11");
    expect(page).toContain("sm:grid-cols");
    expect(page).toContain("Textual run totals");
  });

  it("connects the dashboard from primary navigation", () => {
    expect(shell).toContain('href="/reports/season"');
    expect(shell).toContain("Seasons");
  });

  it("provides an authorized, versioned player-season summary", () => {
    expect(playerPage).toContain('kind: "SEASON"');
    expect(playerPage).toContain('"report.view"');
    expect(playerPage).toContain("Verified games only");
    expect(playerPage).toContain("Source games");
    expect(playerPage).toContain("/box-score");
    expect(playerPage).toContain("Version and freshness");
  });
});
