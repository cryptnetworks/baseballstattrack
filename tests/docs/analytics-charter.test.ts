import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const charter = readFileSync(
  new URL("../../docs/ANALYTICS_CHARTER.md", import.meta.url),
  "utf8",
);

describe("analytics charter contract", () => {
  it.each([
    "## Purpose",
    "## Principles",
    "## Privacy and authorization",
    "## Corrections, replay, and freshness",
    "## Analytics data contract",
    "## Feature lifecycle and ownership",
    "## Boundary for #103",
    "## Boundary for #104",
    "## External data boundary",
    "## Delivery API boundary",
    "## Testing and release gates",
  ])("documents %s", (heading) => {
    expect(charter).toContain(heading);
  });

  it("defines confidence states and sample-size safeguards", () => {
    expect(charter).toContain("`INSUFFICIENT`");
    expect(charter).toContain("`LIMITED`");
    expect(charter).toContain("`SUPPORTED`");
    expect(charter).toContain("`STRONG`");
    expect(charter).toContain("20 opportunities and 3 completed games");
    expect(charter).toContain("Missing observations remain");
  });

  it("keeps unsafe analytics and unavailable provider data out of scope", () => {
    expect(charter).toContain("medical, injury, health, disability");
    expect(charter).toContain(
      "youth profiling beyond the authorized baseball-performance context",
    );
    expect(charter).toMatch(
      /live MLB activation and\s+canonical publication remain gated/u,
    );
    expect(charter).toMatch(/Staged,\s+quarantined,\s+malformed,\s+ambiguous/u);
    expect(charter).toContain("cannot appear as an insight");
  });

  it("requires lifecycle ownership and safe disablement", () => {
    expect(charter).toContain("owner, documentation, supported");
    expect(charter).toContain("disable mechanism");
    expect(charter).toContain("rollback path");
    expect(charter).toContain("Disabled");
    expect(charter).toContain("cannot publish results");
  });
});
