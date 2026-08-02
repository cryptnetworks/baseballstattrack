import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const contract = readFileSync(
  new URL("../../docs/RULESET_CONTRACT.md", import.meta.url),
  "utf8",
);
const decision = readFileSync(
  new URL(
    "../../docs/decisions/0010-ruleset-identity-versioning-and-historical-binding.md",
    import.meta.url,
  ),
  "utf8",
);

describe("ruleset architecture contract", () => {
  it.each([
    "## Non-negotiable invariants",
    "## Conceptual model",
    "## Creation, ownership, and permissions",
    "## Version lifecycle",
    "## Activation and effective dates",
    "## Game binding and historical immutability",
    "## Supported rule-category extension points",
    "## Compatibility contract",
    "## Downstream boundaries",
    "## Privacy and security",
    "## Migration and rollback policy",
    "## Contract fixtures and future tests",
    "## Adversarial review findings",
  ])("documents %s", (heading) => {
    expect(contract).toContain(heading);
  });

  it("defines immutable identity, lifecycle, and binding", () => {
    expect(contract).toContain("`rulesetId`");
    expect(contract).toContain("`rulesetVersionId`");
    expect(contract).toContain("`contentDigest`");
    expect(contract).toContain(
      "DRAFT -> REVIEWED -> ACTIVE -> DEPRECATED -> RETIRED",
    );
    expect(contract).toContain(
      "The first accepted scoring event permanently seals that game's binding.",
    );
    expect(contract).toContain(
      "Replay never consults the latest, default, or currently active version.",
    );
  });

  it("fails unsupported rules and separates downstream version domains", () => {
    expect(contract).toContain("`UNSUPPORTED_RULESET`");
    expect(contract).toContain(
      "baseballRulesetVersionId + fantasyScoringModelVersionId",
    );
    expect(contract).toContain(
      'There is no name-only match, "closest" pack, current-default fallback, or',
    );
    expect(contract).toMatch(
      /Organization or League\s+membership does not grant Account-private/u,
    );
  });

  it("records the accepted architecture decision and implementation boundary", () => {
    expect(decision).toContain("## Status\n\nAccepted");
    expect(decision).toContain(
      "A stable `Ruleset` identity names one owner-controlled family.",
    );
    expect(decision).toContain(
      "Immediate schema migration:** rejected because #106 is the design gate",
    );
  });
});
