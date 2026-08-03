import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const contract = readFileSync(
  new URL("../../docs/FANTASY_TRANSACTIONS.md", import.meta.url),
  "utf8",
);
const decision = readFileSync(
  new URL(
    "../../docs/decisions/0015-deterministic-fantasy-roster-transactions.md",
    import.meta.url,
  ),
  "utf8",
);

describe("fantasy transaction contract", () => {
  it.each([
    "## Non-negotiable invariants",
    "## Transaction state",
    "## Policy and roster-assignment method",
    "## Command envelope and authorization",
    "## Idempotency and concurrency",
    "## Add and drop behavior",
    "## Trade behavior",
    "## Waiver claims and deterministic batch processing",
    "## Lineup changes and locks",
    "## Atomicity and rollback",
    "## Audit contract",
    "## Historical and scoring boundary",
    "## Privacy and security",
    "## Persistence and execution boundary",
    "## Adversarial review findings",
    "## Focused test contract",
    "## Deferred downstream work",
  ])("documents %s", (heading) => {
    expect(contract).toContain(heading);
  });

  it("defines authorized auditable command identity", () => {
    for (const field of [
      "operationId",
      "auditId",
      "accountId",
      "fantasyLeagueId",
      "expectedRevision",
      "submittedAt",
      "authority",
    ]) {
      expect(contract).toContain(`\`${field}\``);
    }
    expect(contract).toContain("`fantasy.roster.manage`");
    expect(contract).toMatch(
      /Authorization is evaluated before the revision/iu,
    );
    expect(contract).toMatch(/Every accepted, queued, cancelled, and denied/iu);
  });

  it("defines deterministic concurrency, idempotency, and rollback", () => {
    expect(contract).toMatch(/canonical request digest/iu);
    expect(contract).toContain("IDEMPOTENCY_CONFLICT");
    expect(contract).toContain("STALE_REVISION");
    expect(contract).toMatch(/only one concurrent writer/iu);
    expect(contract).toMatch(
      /If either roster fails, the\s+other is rolled back/iu,
    );
    expect(contract).toMatch(/conditional drop[\s\S]*discarded/iu);
  });

  it("implements objective draft, waiver, trade, and lineup policy", () => {
    expect(contract).toContain("`DRAFT`");
    expect(contract).toContain("`COMMISSIONER_ASSIGNMENT`");
    expect(contract).toContain("`DAILY_WAIVERS`");
    expect(contract).toContain("`initialAssignmentDeadline`");
    expect(contract).toMatch(
      /priority, then submission time, then stable claim id/iu,
    );
    expect(contract).toMatch(/moves only each successful team/iu);
    expect(contract).toMatch(/exact acceptance from both/iu);
    expect(contract).toMatch(/There is no subjective commissioner veto/iu);
    expect(contract).toMatch(/sealed UTC `\[startsAt, endsAt\)`/iu);
  });

  it("preserves baseball, result, and standings history", () => {
    expect(contract).toMatch(/cannot write baseball players/iu);
    expect(contract).toMatch(/never edit[s]? an\s+earlier snapshot/iu);
    expect(contract).toMatch(/past fantasy results/iu);
    expect(contract).toMatch(/historical standings/iu);
    expect(contract).toMatch(/#126 will select exact roster snapshot ids/iu);
  });

  it("excludes scoring, UI, private data, and partial persistence", () => {
    expect(contract).toMatch(/does not add a database scheduler/iu);
    expect(contract).toMatch(/scoring engine \(#126\)/iu);
    expect(contract).toMatch(/UI \(#127\)/iu);
    expect(contract).toMatch(/No Prisma migration/iu);
    for (const excluded of [
      "player names",
      "DOB/age",
      "guardian/contact details",
      "medical",
      "hidden analytics",
    ]) {
      expect(contract).toContain(excluded);
    }
  });
});

describe("ADR 0015", () => {
  it("accepts deterministic fantasy roster transactions", () => {
    expect(decision).toContain("# ADR 0015");
    expect(decision).toMatch(/## Status\s+Accepted/iu);
    expect(decision).toMatch(/pure transaction state machine/iu);
    expect(decision).toMatch(/daily\s+waiver batches/iu);
    expect(decision).toMatch(/No persistence or scheduler is added/iu);
  });
});
