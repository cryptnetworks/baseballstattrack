import { describe, expect, it, vi } from "vitest";

import { SyntheticFixtureProvider } from "@/domain/external-data";
import {
  ExternalIngestionError,
  ExternalIngestionService,
} from "@/server/app/external-ingestion-service";

const source = {
  id: "source-internal",
  externalId: "b0a1a5c9-aabb-4d75-ae46-51d91cbba100",
  accountId: "account-a",
  providerKey: "SYNTHETIC_FIXTURE_V1",
  status: "ACTIVE",
  approvalReference: "APPROVED:FIXTURE-CONTRACT-1",
  termsVersion: "fixture-v1",
  attribution: "Synthetic fixture",
  cadenceSeconds: 60,
  backfillDays: 1,
  checkpoint: null,
  nextAttemptAt: null,
  consecutiveFailures: 0,
};

const valid = {
  recordType: "GAME",
  providerRecordId: "game-1",
  providerVersion: "v1",
  effectiveAt: "2026-07-31T17:00:00.000Z",
  correctionOfVersion: null,
  payload: {
    seasonId: "season-1",
    homeTeamId: "team-home",
    awayTeamId: "team-away",
    scheduledAt: "2026-07-31T17:00:00.000Z",
    status: "SCHEDULED",
    rulesetCode: "mlb-2026",
  },
};

function repository(overrides: Record<string, unknown> = {}) {
  return {
    source: vi.fn().mockResolvedValue(source),
    startRun: vi.fn().mockResolvedValue({
      run: { id: "run-1", status: "RUNNING" },
      idempotent: false,
    }),
    storeRecord: vi
      .fn()
      .mockResolvedValue({ status: "PUBLISHED", duplicate: false }),
    quarantineInvalid: vi.fn(),
    completePage: vi.fn(),
    succeed: vi.fn(),
    fail: vi.fn(),
    listPublished: vi.fn(),
    ...overrides,
  };
}

describe("external ingestion orchestration", () => {
  it("ingests paginated normalized data and advances a checkpoint", async () => {
    const repo = repository();
    const adapter = new SyntheticFixtureProvider([
      {
        providerVersion: "fixture-v1",
        checkpoint: { page: 1 },
        nextCursor: "1",
        quotaRemaining: 9,
        quotaResetAt: "2026-07-31T18:00:00.000Z",
        records: [valid],
      },
      {
        providerVersion: "fixture-v1",
        checkpoint: { page: 2 },
        nextCursor: null,
        quotaRemaining: 8,
        quotaResetAt: "2026-07-31T18:00:00.000Z",
        records: [{ ...valid, providerRecordId: "game-2" }],
      },
    ]);
    const service = new ExternalIngestionService(
      repo as never,
      new Map([[adapter.contract.key, adapter]]),
      { emit: vi.fn() },
    );
    await service.run({
      accountId: "account-a",
      sourceExternalId: source.externalId,
      runKey: "scheduled-20260731",
      mode: "SCHEDULED",
      from: new Date("2026-07-31T00:00:00.000Z"),
      to: new Date("2026-07-31T17:00:00.000Z"),
      now: new Date("2026-07-31T17:30:00.000Z"),
    });
    expect(repo.storeRecord).toHaveBeenCalledTimes(2);
    expect(repo.completePage).toHaveBeenCalledTimes(2);
    expect(repo.succeed).toHaveBeenCalledWith(
      expect.objectContaining({ checkpoint: { page: 2 }, quotaRemaining: 8 }),
    );
  });

  it("fails closed without recorded approval and persists retry state", async () => {
    const unapproved = repository({
      source: vi.fn().mockResolvedValue({ ...source, approvalReference: null }),
    });
    const adapter = new SyntheticFixtureProvider([]);
    const service = new ExternalIngestionService(
      unapproved as never,
      new Map([[adapter.contract.key, adapter]]),
    );
    await expect(
      service.run({
        accountId: "account-a",
        sourceExternalId: source.externalId,
        runKey: "scheduled-20260731",
        mode: "SCHEDULED",
        from: new Date("2026-07-31T00:00:00.000Z"),
        to: new Date("2026-07-31T17:00:00.000Z"),
        now: new Date("2026-07-31T17:30:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(ExternalIngestionError);
  });
});
