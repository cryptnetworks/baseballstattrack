import { describe, expect, it, vi } from "vitest";

import {
  createPortableDataDocument,
  encodePortableDocument,
  type PortableData,
} from "@/domain/portable-data";
import { PortableDataService } from "@/server/app/portable-data-service";
import {
  createTrustedActorContext,
  type Capability,
} from "@/server/auth/types";

function actor(capability: Capability, accountId = "target-account") {
  return createTrustedActorContext({
    accountId,
    appUserId: "user-1",
    membershipId: "membership-1",
    actorKind: "USER",
    actorId: "user-1",
    actorUserId: "user-1",
    capability,
    authorityReferenceIds: ["assignment-1"],
    target: {
      kind: "ACCOUNT",
      accountId,
      teamIds: [],
      seasonId: null,
      gameId: null,
    },
    authorizedAt: "2026-07-30T20:00:00.000Z",
  });
}

function emptyDocument() {
  const data: PortableData = {
    teams: [],
    seasons: [],
    teamSeasons: [],
    players: [],
    rosters: [],
    rulesets: [],
    games: [],
  };
  return encodePortableDocument(
    createPortableDataDocument({
      exportedAt: "2026-07-30T20:00:00.000Z",
      data,
    }),
  );
}

describe("portable data application boundary", () => {
  it("requires separate exact Account capabilities for export and import", async () => {
    const repository = {
      loadCatalog: vi.fn(),
      findExistingLogicalIds: vi.fn(),
      audit: vi.fn(),
    };
    const service = new PortableDataService(
      repository,
      { loadAcceptedHistories: vi.fn() },
      { loadPresentationSource: vi.fn() },
    );
    await expect(
      service.exportAccount("target-account", actor("account.manage")),
    ).rejects.toThrow();
    await expect(
      service.validateImport(
        "target-account",
        emptyDocument(),
        actor("report.export"),
      ),
    ).rejects.toThrow();
    expect(repository.loadCatalog).not.toHaveBeenCalled();
    expect(repository.findExistingLogicalIds).not.toHaveBeenCalled();
  });

  it("exports a bounded deterministic artifact and requires its audit", async () => {
    const repository = {
      loadCatalog: vi.fn().mockResolvedValue({
        teams: [],
        seasons: [],
        teamSeasons: [],
        players: [],
        rosters: [],
        rulesets: [],
        games: [],
      }),
      findExistingLogicalIds: vi.fn(),
      audit: vi.fn(),
    };
    const service = new PortableDataService(
      repository,
      { loadAcceptedHistories: vi.fn() },
      { loadPresentationSource: vi.fn() },
    );
    const artifact = await service.exportAccount(
      "target-account",
      actor("report.export"),
    );
    expect(artifact.fileName).toMatch(
      /^baseballstattrack-export-\d{14}\.json$/u,
    );
    expect(artifact.checksum).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(new TextDecoder().decode(artifact.bytes)).not.toContain(
      "target-account",
    );
    expect(repository.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "data.export.download",
        outcome: "SUCCEEDED",
        metadata: expect.objectContaining({ ephemeral: true }),
      }),
    );
  });

  it("produces an exact, mutation-free, audited dry run and exact retry", async () => {
    const audits: unknown[] = [];
    const repository = {
      loadCatalog: vi.fn(),
      findExistingLogicalIds: vi.fn().mockResolvedValue(new Set()),
      audit: vi.fn(async (value) => {
        audits.push(value);
      }),
    };
    const service = new PortableDataService(
      repository,
      { loadAcceptedHistories: vi.fn() },
      { loadPresentationSource: vi.fn() },
    );
    const bytes = emptyDocument();
    const first = await service.validateImport(
      "target-account",
      bytes,
      actor("account.manage"),
    );
    const retry = await service.validateImport(
      "target-account",
      bytes,
      actor("account.manage"),
    );
    expect(first).toEqual(retry);
    expect(first.mutationCount).toBe(0);
    expect(repository.findExistingLogicalIds).toHaveBeenCalledTimes(2);
    expect(audits).toHaveLength(2);
    expect(audits[0]).toMatchObject({
      action: "data.import.validate",
      outcome: "SUCCEEDED",
    });
  });

  it("records a safe failure audit without a partial mutation", async () => {
    const audit = vi.fn();
    const repository = {
      loadCatalog: vi.fn(),
      findExistingLogicalIds: vi.fn(),
      audit,
    };
    const service = new PortableDataService(
      repository,
      { loadAcceptedHistories: vi.fn() },
      { loadPresentationSource: vi.fn() },
    );
    await expect(
      service.validateImport(
        "target-account",
        new TextEncoder().encode("{"),
        actor("account.manage"),
      ),
    ).rejects.toMatchObject({
      code: "MALFORMED_DOCUMENT",
    });
    expect(repository.findExistingLogicalIds).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "data.import.validate",
        outcome: "FAILED",
        reasonCode: "MALFORMED_DOCUMENT",
        metadata: expect.objectContaining({ mutationCount: 0 }),
      }),
    );
  });
});
