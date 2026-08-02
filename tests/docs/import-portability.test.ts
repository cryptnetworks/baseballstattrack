import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const contract = readFileSync(
  new URL("../../docs/IMPORT_PORTABILITY.md", import.meta.url),
  "utf8",
);

describe("import portability contract", () => {
  it.each([
    "## Import package identity",
    "## Provenance model",
    "## Ruleset handling",
    "## Entity portability matrix",
    "## Identity resolution",
    "## Import lifecycle",
    "## Validation and review report",
    "## Atomicity, retries, and recovery",
    "## Correction and verification behavior",
    "## Privacy and security",
    "## Derived statistics and reports",
    "## Schema and migration policy",
    "## Focused test contract",
    "## Adversarial review findings",
  ])("documents %s", (heading) => {
    expect(contract).toContain(heading);
  });

  it("defines package identity, compatibility, digests, and provenance", () => {
    expect(contract).toContain("packageId");
    expect(contract).toContain("sourceSystem");
    expect(contract).toContain("schemaCompatibility");
    expect(contract).toContain("contentDigest");
    expect(contract).toContain("derivationVersion");
    expect(contract).toContain("sourceAuthority");
    expect(contract).toContain("sha256-canonical-json-v1");
    expect(contract).toMatch(/a checksum is not producer authentication/iu);
  });

  it("requires exact ruleset handling or quarantine without coercion", () => {
    expect(contract).toContain("### 1. Exact digest match");
    expect(contract).toContain("### 2. Explicit reviewed mapping");
    expect(contract).toContain("### 3. Quarantine");
    expect(contract).toMatch(/never match by name, choose the latest rules/iu);
    expect(contract).toContain(
      "A ruleset resolution is immutable once a game is committed.",
    );
  });

  it("defines every portable entity and rejects ambiguous identity", () => {
    for (const entity of [
      "Account",
      "Team",
      "Player",
      "Season",
      "Roster",
      "Game",
      "Setup revision",
      "Event",
      "Correction",
      "Statistics",
      "Reports",
    ]) {
      expect(contract).toMatch(new RegExp(`\\|\\s+${entity}\\s+\\|`, "u"));
    }
    expect(contract).toContain("Never fuzzy/name-only match");
    expect(contract).toContain("silent team merging");
    expect(contract).toMatch(/the\s+default outcome is quarantine/iu);
  });

  it("seals lifecycle, commit, correction, privacy, and Account boundaries", () => {
    for (const state of [
      "RECEIVED",
      "VALIDATED",
      "REVIEWED",
      "COMMITTED",
      "RECONCILED",
      "AVAILABLE",
      "PARTIALLY_VALIDATED",
      "QUARANTINED",
      "REJECTED",
    ]) {
      expect(contract).toContain(state);
    }
    expect(contract).toContain("one atomic canonical promotion");
    expect(contract).toContain("original immutable source events");
    expect(contract).toContain("authentication records");
    expect(contract).toContain("exact target Account");
  });
});
