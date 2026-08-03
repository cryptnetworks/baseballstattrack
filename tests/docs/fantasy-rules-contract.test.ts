import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const contract = readFileSync(
  new URL("../../docs/FANTASY_RULES_CONTRACT.md", import.meta.url),
  "utf8",
);
const decision = readFileSync(
  new URL(
    "../../docs/decisions/0013-versioned-weekly-fantasy-points.md",
    import.meta.url,
  ),
  "utf8",
);

describe("fantasy rules contract", () => {
  it.each([
    "## Non-negotiable invariants",
    "## Existing foundation and implementation boundary",
    "## Fantasy scoring identity",
    "## Initial format and low-maintenance rationale",
    "## Scoring categories and extension registry",
    "## Illustrative initial points template",
    "## Eligibility contract",
    "## Roster and lineup rules",
    "## Weekly cadence and participant obligations",
    "## Transaction boundary",
    "## Game lifecycle, corrections, and stat changes",
    "## Matchups, ties, and playoffs boundary",
    "## Ownership and delegation",
    "## Version lifecycle and historical binding",
    "## Privacy and security",
    "## Audit and reproducibility",
    "## Portability",
    "## Database and implementation deferral",
    "## Focused test contract",
    "## Adversarial review findings",
    "## Deferred downstream work",
  ])("documents %s", (heading) => {
    expect(contract).toContain(heading);
  });

  it("keeps fantasy downstream from canonical baseball truth", () => {
    expect(contract).toMatch(
      /Fantasy scoring consumes a versioned statistics/iu,
    );
    expect(contract).toMatch(/never writes\s+baseball events, scores/iu);
    expect(contract).toMatch(/The arrows are one-way/iu);
    expect(contract).toMatch(/never select[s]? "latest/iu);
  });

  it("defines stable immutable model identity and complete lineage", () => {
    for (const field of [
      "modelId",
      "modelVersionId",
      "owner",
      "version",
      "categories",
      "eligibility",
      "roster",
      "lifecycle",
      "contentDigest",
      "statisticRegistryVersion",
    ]) {
      expect(contract).toContain(`\`${field}\``);
    }
    expect(contract).toContain(
      "DRAFT -> REVIEWED -> ACTIVE -> DEPRECATED -> RETIRED",
    );
    expect(contract).toMatch(/Review seals semantics before activation/iu);
  });

  it("selects an understandable weekly format and obligation", () => {
    expect(contract).toContain("weekly head-to-head points");
    expect(contract).toContain("one full-lineup lock");
    expect(contract).toMatch(/five to ten minutes weekly/iu);
    expect(contract).toMatch(/no required daily action/iu);
    expect(contract).toContain("SEALED_UTC_INTERVALS");
  });

  it("defines extensible scoring without inventing unsupported statistics", () => {
    for (const category of [
      "runs",
      "hits",
      "doubles",
      "triples",
      "home runs",
      "RBI",
      "walks",
      "stolen bases",
      "strikeouts",
      "outs recorded",
      "earned runs",
    ]) {
      expect(contract.toLowerCase()).toContain(category.toLowerCase());
    }
    expect(contract).toMatch(/Wins and saves.*future/iu);
    expect(contract).toMatch(/must not infer\s+them/iu);
    expect(contract).toContain("milliPointsPerUnit");
  });

  it("defines eligibility without protected traits", () => {
    expect(contract).toMatch(/minimum\s+appearances/iu);
    expect(contract).toMatch(/minimum\s+pitching outs/iu);
    expect(contract).toContain("roster membership at lock");
    for (const privateField of [
      "birth date",
      "age",
      "medical",
      "guardian/contact",
      "youth classification",
      "hidden analytics",
    ]) {
      expect(contract).toMatch(
        new RegExp(privateField.replaceAll(" ", "\\s+"), "iu"),
      );
    }
  });

  it("defines lifecycle edge cases without implementing matchups or transactions", () => {
    for (const edge of [
      "postponed",
      "suspended",
      "incomplete",
      "abandoned",
      "cancelled",
      "corrections",
      "regular-season",
      "playoff tie",
    ]) {
      expect(contract).toContain(edge);
    }
    expect(contract).toContain("BEFORE_FINALIZATION_ONLY");
    expect(contract).toMatch(/#124 implements waiver, trade/iu);
    expect(contract).toMatch(/#126 implements these matchup/iu);
    expect(contract).toMatch(/every acquisition uses a daily waiver batch/iu);
    expect(contract).toMatch(/initial priority is reverse draft order/iu);
    expect(contract).toMatch(/trade needs explicit acceptance/iu);
    expect(contract).toMatch(/regular-season trade deadline/iu);
  });

  it("uses explicit owner capabilities and preserves Account isolation", () => {
    expect(contract).toContain("`fantasy.rules.manage`");
    expect(contract).toContain("`fantasy.rules.activate`");
    expect(contract).toMatch(/Organization\s+authority cannot activate/iu);
    expect(contract).toMatch(/another Account/iu);
    expect(contract).toMatch(/separate Organization approval/iu);
    expect(contract).toMatch(/never from a browser boolean/iu);
  });

  it("records implemented dependencies and defers prohibited work", () => {
    expect(contract).toMatch(/#123 defines fantasy league/iu);
    expect(contract).toMatch(/#124 defines transactions/iu);
    expect(contract).toMatch(/#126 implements deterministic matchup/iu);
    expect(contract).toMatch(/#127 owns configuration/iu);
    expect(contract).toMatch(/Offline fantasy behavior.*out of scope/iu);
    expect(contract).toMatch(/all M9 work remain[s]? out of scope/iu);
  });
});

describe("ADR 0013", () => {
  it("accepts versioned weekly points over canonical statistics", () => {
    expect(decision).toContain("# ADR 0013");
    expect(decision).toMatch(/## Status\s+Accepted/iu);
    expect(decision).toContain("weekly head-to-head points");
    expect(decision).toContain("integer milli-point weights");
    expect(decision).toMatch(/cannot write baseball\s+events/iu);
    expect(decision).toMatch(/remain deferred/iu);
  });
});
