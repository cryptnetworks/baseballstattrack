import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const contract = readFileSync(
  new URL("../../docs/LEAGUE_DELEGATION_MODEL.md", import.meta.url),
  "utf8",
);
const decision = readFileSync(
  new URL(
    "../../docs/decisions/0012-organization-and-league-delegation.md",
    import.meta.url,
  ),
  "utf8",
);

describe("league delegation model", () => {
  it.each([
    "## Non-negotiable invariants",
    "## Existing authority and implementation boundary",
    "## Principal and ownership model",
    "## Scope hierarchy and inheritance",
    "## Capability and scope matrix",
    "## Restricted actions and approval",
    "## Least privilege and decision algorithm",
    "## Delegation lifecycle, revocation, and offboarding",
    "## Audit contract",
    "## Ownership and history matrix",
    "## Ruleset contract interaction",
    "## Import portability interaction",
    "## Privacy and cross-team minimum fields",
    "## Database and migration requirements",
    "## Focused test contract",
    "## Adversarial review findings",
    "## Deferred downstream work",
  ])("documents %s", (heading) => {
    expect(contract).toContain(heading);
  });

  it("separates organization membership from Account consent", () => {
    expect(contract).toMatch(
      /Organization membership grants zero Account authority/iu,
    );
    expect(contract).toContain("AccountDelegation");
    expect(contract).toContain("approvedByAccountMembershipId");
    expect(contract).toMatch(/There are no wildcard, name-based/iu);
    expect(contract).toMatch(/sibling Account/iu);
  });

  it("defines explicit capabilities and restricted approvals", () => {
    for (const capability of [
      "organization.members.manage",
      "organization.ownership.transfer",
      "league.settings.manage",
      "team.view",
      "ruleset.activate",
      "data.import.review",
      "data.import.commit",
      "report.export",
      "game.correct",
      "game.verify",
      "fantasy.league.manage",
      "fantasy.league.activate",
      "fantasy.team.manage",
      "fantasy.roster.manage",
      "fantasy.scoring.calculate",
    ]) {
      expect(contract).toContain(`\`${capability}\``);
    }
    expect(contract).toMatch(
      /ownership transfer approver must be a different/iu,
    );
    expect(contract).toMatch(/Review and commit are separate exact/iu);
  });

  it("preserves ruleset, import, ownership, and baseball history", () => {
    expect(contract).toMatch(/Accepted game setup and source event/iu);
    expect(contract).toMatch(/package[\s\S]*evidence, never authorization/iu);
    expect(contract).toMatch(/Ownership never moves to the Organization/iu);
    expect(contract).toContain("append-only corrections");
  });

  it("keeps cross-team data minimum-field and excludes private youth data", () => {
    expect(contract).toContain("minimum-field projection");
    for (const excluded of [
      "private player identity",
      "birth date/age",
      "guardian/contact information",
      "medical or eligibility notes",
      "raw scoring events",
    ]) {
      expect(contract).toContain(excluded);
    }
    expect(contract).toMatch(/most\s+restrictive applicable policy wins/iu);
  });

  it("requires a complete future migration instead of partial authority", () => {
    expect(contract).toContain("No database change is included in #107");
    expect(contract).toMatch(/one\s+reviewed forward migration/iu);
    expect(contract).toContain("Account-scoped composite foreign keys");
    expect(contract).toContain("Supabase RLS/service-role boundaries");
    expect(contract).toMatch(/No route may read these future tables/iu);
  });

  it("records the fantasy contract consumers and keeps later work deferred", () => {
    expect(contract).toMatch(/#123[\s\S]*fantasy domain model/iu);
    expect(contract).toMatch(/transactions \(#124\)/u);
    expect(contract).toMatch(/scoring\/standings\/playoffs \(#126\)/u);
    expect(contract).toMatch(/UI\s+\(#127\)/u);
    expect(contract).toContain("offline mode");
    expect(contract).toContain("M9");
  });
});

describe("ADR 0012", () => {
  it("accepts separate organization and Account delegation authority", () => {
    expect(decision).toContain("# ADR 0012");
    expect(decision).toMatch(/## Status\s+Accepted/iu);
    expect(decision).toMatch(
      /Organization membership\s+has no Account authority/iu,
    );
    expect(decision).toContain("one complete forward migration");
    expect(decision).toMatch(/no implied\s+permissions/iu);
  });
});
