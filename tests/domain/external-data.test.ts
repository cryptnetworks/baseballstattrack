import { describe, expect, it } from "vitest";

import {
  SyntheticFixtureProvider,
  externalRecordDigest,
  normalizeExternalRecord,
} from "@/domain/external-data";

const team = {
  recordType: "TEAM",
  providerRecordId: "team-147",
  providerVersion: "2026-07-31-1",
  effectiveAt: "2026-07-31T00:00:00.000Z",
  correctionOfVersion: null,
  payload: { name: "Synthetic Club", abbreviation: "SYN" },
} as const;

describe("external provider contract", () => {
  it("normalizes a representative strict fixture deterministically", async () => {
    const provider = new SyntheticFixtureProvider([
      {
        providerVersion: "fixture-v1",
        checkpoint: { sequence: 1 },
        nextCursor: null,
        quotaRemaining: null,
        quotaResetAt: null,
        records: [team],
      },
    ]);
    const page = await provider.fetchPage({
      cursor: null,
      from: new Date(0),
      to: new Date(1),
      checkpoint: null,
    });
    const normalized = provider.normalize(page.records[0]);
    expect(normalized).toEqual(team);
    expect(externalRecordDigest(normalized)).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("rejects arbitrary payload fields, secrets, and malformed identities", () => {
    expect(() =>
      normalizeExternalRecord({
        ...team,
        payload: { ...team.payload, token: "secret" },
      }),
    ).toThrow();
    expect(() =>
      normalizeExternalRecord({ ...team, providerRecordId: "contains space" }),
    ).toThrow();
  });
});
