import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const contract = readFileSync(
  new URL("../../docs/FANTASY_SCORING_AND_MATCHUPS.md", import.meta.url),
  "utf8",
);
const decision = readFileSync(
  new URL(
    "../../docs/decisions/0016-versioned-fantasy-results-and-standings.md",
    import.meta.url,
  ),
  "utf8",
);

describe("fantasy scoring and matchup contract", () => {
  it.each([
    "## Non-negotiable invariants",
    "## Scoring period identity",
    "## Team-period calculation",
    "## Result lineage and deterministic replay",
    "## Uncertainty and completion",
    "## Matchup calculation",
    "## Standings and playoff qualification",
    "## Corrections and result revisions",
    "## Authorization, isolation, and audit",
    "## Privacy and presentation boundary",
    "## Persistence and execution boundary",
    "## Adversarial review findings",
    "## Focused test contract",
    "## Deferred downstream work",
  ])("documents %s", (heading) => {
    expect(contract).toContain(heading);
  });

  it("keeps fantasy results downstream from verified statistics", () => {
    expect(contract).toMatch(/verified baseball statistics plus one exact/iu);
    expect(contract).toMatch(/never changes baseball events/iu);
    expect(contract).toContain("statistic derivation");
    expect(contract).toContain("baseball ruleset version ids");
    expect(contract).toMatch(/same sealed inputs is byte-equivalent/iu);
  });

  it("defines totals, matchups, standings, playoffs, and qualification", () => {
    expect(contract).toContain("category milli-points");
    expect(contract).toContain("total milli-points");
    expect(contract).toContain("Equal regular-season totals produce `TIE`");
    expect(contract).toMatch(/playoff\/championship totals/iu);
    expect(contract).toContain("standing points");
    expect(contract).toContain("CURRENT_CUTOFF");
    expect(contract).toContain("QUALIFIED");
    expect(contract).toContain("current streak");
  });

  it("never hides uncertainty or corrections", () => {
    for (const state of [
      "INCOMPLETE_GAME",
      "UNVERIFIED",
      "INSUFFICIENT_SAMPLE",
      "MISSING_STATISTICS",
      "AWAITING_FINAL_DATA",
    ]) {
      expect(contract).toContain(state);
    }
    expect(contract).toMatch(/never invents/iu);
    expect(contract).toMatch(/Corrections append a new result revision/iu);
    expect(contract).toMatch(
      /old\s+team result, matchup, and standings remain/iu,
    );
  });

  it("requires exact authorization and excludes UI/private data", () => {
    expect(contract).toContain("`fantasy.scoring.calculate`");
    expect(contract).toMatch(/Organization membership alone grants no/iu);
    expect(contract).toMatch(/Cross-Account and sibling-league/iu);
    expect(contract).toContain("DOB/age");
    expect(contract).toContain("hidden analytics");
    expect(contract).toMatch(/does not add UI \(#127\)/iu);
    expect(contract).toMatch(/No Prisma model or migration/iu);
  });
});

describe("ADR 0016", () => {
  it("accepts versioned fantasy results and standings", () => {
    expect(decision).toContain("# ADR 0016");
    expect(decision).toMatch(/## Status\s+Accepted/iu);
    expect(decision).toMatch(/three immutable result\s+layers/iu);
    expect(decision).toMatch(/Corrections append new revisions/iu);
    expect(decision).toContain("`fantasy.scoring.calculate`");
    expect(decision).toMatch(/No database schema, API, worker, UI/iu);
  });
});
