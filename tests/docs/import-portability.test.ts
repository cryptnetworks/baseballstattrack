import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const contract = readFileSync(
  new URL("../../docs/IMPORT_PORTABILITY.md", import.meta.url),
  "utf8",
);
const decision = readFileSync(
  new URL(
    "../../docs/decisions/0011-import-portability-quarantine-and-atomic-promotion.md",
    import.meta.url,
  ),
  "utf8",
);

describe("import portability contract", () => {
  it.each([
    "## Import package identity",
    "## Provenance model",
    "## External provider boundary",
    "## Ruleset handling",
    "## Entity portability matrix",
    "## Identity resolution",
    "## Import lifecycle",
    "## Validation and review report",
    "## Atomicity, retries, and recovery",
    "## Correction and verification behavior",
    "## Authorization boundary",
    "## Privacy and security",
    "## Derived statistics and reports",
    "## Schema and migration policy",
    "## Focused test contract",
    "### Current executable coverage and deferred validation",
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
    const entities = [
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
    ];
    for (const entity of entities) {
      expect(contract).toMatch(new RegExp(`\\|\\s+${entity}\\s+\\|`, "u"));
    }
    const auditSection = contract.slice(
      contract.indexOf("### Per-entity audit behavior"),
      contract.indexOf("Team-season participation"),
    );
    expect(auditSection).toContain("Required audit behavior");
    for (const entity of entities) {
      expect(auditSection).toMatch(new RegExp(`\\|\\s+${entity}\\s+\\|`, "u"));
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
      "INVALID",
      "UNSUPPORTED",
      "REJECTED",
    ]) {
      expect(contract).toContain(state);
    }
    expect(contract).toContain("one atomic canonical promotion");
    expect(contract).toContain("original immutable source events");
    expect(contract).toContain("authentication records");
    expect(contract).toContain("exact target Account");
  });

  it("keeps dry runs hypothetical and canonical baseball data immutable", () => {
    for (const finding of [
      "records found",
      "conflicts",
      "missing dependencies",
      "ruleset dispositions",
      "identity resolutions",
      "privacy issues",
      "expected changes",
    ]) {
      expect(contract).toContain(finding);
    }
    for (const canonicalEntity of [
      "events",
      "corrections",
      "statistics",
      "projection checkpoints",
    ]) {
      expect(contract).toContain(canonicalEntity);
    }
    expect(contract).toContain("mutationCount: 0");
    expect(contract).toContain("never reserve identifiers");
  });

  it("requires authenticated least-privilege authorization and safe audits", () => {
    expect(contract).toContain("trusted application");
    expect(contract).toContain("data.import.validate");
    expect(contract).toContain("data.import.review");
    expect(contract).toContain("data.import.commit");
    expect(contract).toMatch(/can never select an owner/iu);
    expect(contract).toMatch(/fail closed/iu);
    expect(contract).toMatch(/another\s+Account/iu);
  });

  it("keeps provider evidence versioned and non-canonical", () => {
    for (const evidence of [
      "provider identity",
      "source version",
      "retrieval time",
      "confidence",
      "correction/supersession state",
    ]) {
      expect(contract).toContain(evidence);
    }
    expect(contract).toMatch(/does not make provider data\s+canonical truth/iu);
    expect(contract).toContain("never publishes automatically");
  });
});

describe("ADR 0011", () => {
  it("accepts quarantine and atomic promotion as the architecture", () => {
    expect(decision).toContain("# ADR 0011");
    expect(decision).toMatch(/## Status\s+Accepted/iu);
    expect(decision).toContain("exact version/content-digest");
    expect(decision).toContain("partial canonical graph is impossible");
    expect(decision).toContain(
      "Retrieval does not make provider data canonical",
    );
    expect(decision).toMatch(
      /This ADR does not add\s+that schema or endpoint/iu,
    );
  });
});
