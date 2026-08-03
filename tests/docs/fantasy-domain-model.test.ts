import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const contract = readFileSync(
  new URL("../../docs/FANTASY_DOMAIN_MODEL.md", import.meta.url),
  "utf8",
);
const decision = readFileSync(
  new URL(
    "../../docs/decisions/0014-account-scoped-immutable-fantasy-aggregates.md",
    import.meta.url,
  ),
  "utf8",
);

describe("fantasy domain model contract", () => {
  it.each([
    "## Non-negotiable invariants",
    "## One-way architecture",
    "## Identity and ownership",
    "## Fantasy league",
    "## Fantasy team and manager ownership",
    "## Fantasy player entry",
    "## Eligibility and ownership snapshots",
    "## Roster slots and append-only history",
    "## Authorization and delegation",
    "## Privacy and security",
    "## Persistence boundary",
    "## Adversarial review findings",
    "## Focused test contract",
    "## Deferred downstream work",
  ])("documents %s", (heading) => {
    expect(contract).toContain(heading);
  });

  it("keeps fantasy downstream from canonical baseball truth", () => {
    expect(contract).toMatch(/The arrows are one-way/iu);
    expect(contract).toMatch(/no fantasy operation writes baseball/iu);
    expect(contract).toMatch(/one opaque `baseballPlayerId`/iu);
    expect(contract).toMatch(
      /never copies\s+or replaces canonical player identity/iu,
    );
  });

  it("defines owned versioned league, team, player, and roster entities", () => {
    for (const field of [
      "FantasyLeague.id",
      "FantasyTeam.id",
      "FantasyPlayerEntry.id",
      "FantasyRosterSnapshot.id",
      "modelVersionId",
    ]) {
      expect(contract).toContain(`\`${field}\``);
    }
    expect(contract).toContain("DRAFT -> ACTIVE -> COMPLETED -> ARCHIVED");
    expect(contract).toContain("DRAFT -> ACTIVE -> WITHDRAWN -> ARCHIVED");
    expect(contract).toMatch(/append-only[\s\S]*revision chain/iu);
  });

  it("requires exact Account authorization and #107 delegation", () => {
    for (const capability of [
      "fantasy.league.manage",
      "fantasy.league.activate",
      "fantasy.team.manage",
      "fantasy.roster.manage",
    ]) {
      expect(contract).toContain(`\`${capability}\``);
    }
    expect(contract).toMatch(/Organization or League membership alone/iu);
    expect(contract).toMatch(/allowed `ACCOUNT`-scope decision/iu);
    expect(contract).toMatch(/Sibling Accounts, leagues, teams/iu);
  });

  it("excludes private fields and defines metadata-only visibility", () => {
    for (const excluded of [
      "birth dates",
      "ages",
      "contacts",
      "notes",
      "medical information",
      "youth classifications",
      "hidden analytics",
    ]) {
      expect(contract).toContain(excluded);
    }
    expect(contract).toContain("PUBLIC_METADATA_ONLY");
    expect(contract).toMatch(/not rosters, player identity/iu);
  });

  it("records the transaction consumer and defers prohibited downstream behavior", () => {
    expect(contract).toMatch(/#124 implements draft\/assignment/iu);
    expect(contract).toMatch(/#126 implements scoring periods/iu);
    expect(contract).toMatch(/#127: league\/team\/roster UI/iu);
    expect(contract).toMatch(/No Prisma model or migration is included/iu);
    expect(contract).toMatch(/Offline fantasy behavior.*out of scope/iu);
  });
});

describe("ADR 0014", () => {
  it("accepts Account-scoped immutable fantasy aggregates", () => {
    expect(decision).toContain("# ADR 0014");
    expect(decision).toMatch(/## Status\s+Accepted/iu);
    expect(decision).toMatch(/one canonical `baseballPlayerId`/iu);
    expect(decision).toMatch(/Roster state is an immutable revision chain/iu);
    expect(decision).toMatch(/No database schema is added/iu);
  });
});
