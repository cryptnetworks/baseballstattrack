import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const ecosystem = readFileSync(
  new URL("../../docs/FANTASY_LEAGUE_ECOSYSTEM.md", import.meta.url),
  "utf8",
);
const rulesIndex = readFileSync(
  new URL("../../docs/RULES_AND_CALCULATIONS.md", import.meta.url),
  "utf8",
);

describe("fantasy league ecosystem integration contract", () => {
  it.each([
    "## Completion map",
    "## One-way architecture",
    "## League lifecycle and ownership",
    "## Permissions and delegation",
    "## Rules and version compatibility",
    "## Transactions and roster history",
    "## Scoring, matchups, and standings",
    "## Notifications and experience",
    "## Privacy and retention",
    "## Integration review",
    "## Future extensions and remaining risks",
  ])("documents %s", (heading) => {
    expect(ecosystem).toContain(heading);
  });

  it("coordinates every prerequisite and fantasy child issue", () => {
    for (const issue of [
      "#101",
      "#106",
      "#107",
      "#125",
      "#123",
      "#124",
      "#126",
      "#127",
    ]) {
      expect(ecosystem).toMatch(new RegExp(`\\| ${issue}\\s+\\|`));
    }
  });

  it("keeps fantasy downstream and makes integration boundaries discoverable", () => {
    expect(ecosystem).toContain("The arrows are one-way");
    expect(ecosystem).toMatch(/cannot create or update baseball events/iu);
    expect(ecosystem).toContain("fantasy.team.manage");
    expect(ecosystem).toContain("fails closed");
    expect(ecosystem).toContain("M9 work is not part");
    expect(rulesIndex).toContain(
      "[Fantasy league ecosystem](FANTASY_LEAGUE_ECOSYSTEM.md)",
    );
  });
});
