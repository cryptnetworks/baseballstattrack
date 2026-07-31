import { describe, expect, it, vi } from "vitest";

import { CalendarProviderError } from "@/domain/calendar-sync";
import {
  CalendarAdministrationService,
  CalendarSynchronizationService,
} from "@/server/app/calendar-sync-service";
import { createTrustedActorContext } from "@/server/auth/types";

const CONNECTION = "00000000-0000-4000-8000-000000000201";
const GAME = "00000000-0000-4000-8000-000000000202";

function connection(status = "ACTIVE") {
  return {
    id: "connection-internal",
    externalId: CONNECTION,
    accountId: "account-a",
    provider: "GOOGLE",
    providerCalendarId: "primary",
    credentialReference: "calendar/prod-primary",
    timeZone: "America/New_York",
    detailLevel: "PRIVATE",
    status,
    syncLeaseOwner: "worker-one",
    syncLeaseExpiresAt: new Date(Date.now() + 60_000),
    lastSyncAt: null,
    lastFailureAt: null,
    lastFailureCode: null,
    disconnectedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function game() {
  return {
    id: "game-internal",
    externalId: GAME,
    status: "READY",
    revision: 0,
    setupRevision: 1,
    teamSeasonId: "managed-team-season",
    scheduledAt: new Date("2026-09-01T22:00:00.000Z"),
    location: "Field 1",
    archivedAt: null,
    readySetupSnapshot: {
      teamSnapshots: [
        {
          teamSeasonId: "managed-team-season",
          displayName: "Tigers",
          isAccountTeam: true,
        },
        {
          teamSeasonId: null,
          displayName: "Falcons",
          isAccountTeam: false,
        },
      ],
    },
  };
}

function link(status = "PENDING") {
  return {
    id: "link-internal",
    accountId: "account-a",
    connectionId: "connection-internal",
    gameId: "game-internal",
    providerEventId: "bst12345",
    providerVersion: null,
    sourceFingerprint: null,
    status,
    attemptCount: 0,
    lastFailureCode: null,
    lastAttemptAt: null,
    lastSyncedAt: null,
    cancelledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function actor(accountId = "account-a") {
  return createTrustedActorContext({
    accountId,
    appUserId: "user-a",
    membershipId: "membership-a",
    actorKind: "USER",
    actorId: "user-a",
    actorUserId: "user-a",
    capability: "account.manage",
    authorityReferenceIds: ["role-a"],
    target: {
      kind: "ACCOUNT",
      accountId,
      teamIds: [],
      seasonId: null,
      gameId: null,
    },
    authorizedAt: "2026-07-31T20:00:00.000Z",
  });
}

describe("calendar administration", () => {
  it("rejects cross-Account disconnect before repository access", async () => {
    const repository = { beginDisconnect: vi.fn() };
    const service = new CalendarAdministrationService(repository as never);
    await expect(
      service.disconnect(
        { accountId: "account-b", connectionId: CONNECTION },
        actor(),
      ),
    ).rejects.toThrow();
    expect(repository.beginDisconnect).not.toHaveBeenCalled();
  });
});

describe("calendar worker", () => {
  it("upserts a deterministic event and records the provider version", async () => {
    const repository = {
      claimConnection: vi.fn().mockResolvedValue(connection()),
      renewLease: vi.fn().mockResolvedValue(true),
      loadGamesAndLinks: vi
        .fn()
        .mockResolvedValue({ games: [game()], links: [] }),
      ensureLink: vi.fn().mockResolvedValue(link()),
      reactivateCancelledLink: vi.fn(),
      recordSynced: vi.fn(),
      recordCancelled: vi.fn(),
      recordFailure: vi.fn(),
      finishConnection: vi.fn().mockResolvedValue(true),
      releaseFailedClaim: vi.fn(),
    };
    const provider = {
      upsert: vi.fn().mockResolvedValue({ version: '"etag-1"' }),
      cancel: vi.fn(),
    };
    const service = new CalendarSynchronizationService(
      repository as never,
      () => provider,
      { emit: vi.fn() },
    );

    await expect(
      service.run({ workerId: "worker-one" }),
    ).resolves.toMatchObject({
      outcome: "succeeded",
      createdOrUpdated: 1,
      failed: 0,
    });
    expect(provider.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarId: "primary",
        eventId: "bst12345",
        expectedVersion: null,
        event: expect.objectContaining({
          summary: "Baseball game",
          visibility: "private",
        }),
      }),
    );
    expect(repository.ensureLink).toHaveBeenCalledWith(
      expect.objectContaining({
        providerEventId: expect.stringMatching(/^bst[a-f0-9]{64}$/u),
      }),
    );
    expect(repository.recordSynced).toHaveBeenCalledWith(
      expect.objectContaining({ providerVersion: '"etag-1"' }),
    );
  });

  it("surfaces external edit conflicts without changing baseball state", async () => {
    const existing = { ...link("SYNCED"), providerVersion: '"etag-old"' };
    const repository = {
      claimConnection: vi.fn().mockResolvedValue(connection()),
      renewLease: vi.fn().mockResolvedValue(true),
      loadGamesAndLinks: vi
        .fn()
        .mockResolvedValue({ games: [game()], links: [existing] }),
      ensureLink: vi.fn(),
      reactivateCancelledLink: vi.fn(),
      recordSynced: vi.fn(),
      recordCancelled: vi.fn(),
      recordFailure: vi.fn(),
      finishConnection: vi.fn().mockResolvedValue(true),
      releaseFailedClaim: vi.fn(),
    };
    const service = new CalendarSynchronizationService(
      repository as never,
      () => ({
        upsert: vi
          .fn()
          .mockRejectedValue(new CalendarProviderError("CONFLICT", false)),
        cancel: vi.fn(),
      }),
      { emit: vi.fn() },
    );

    await expect(
      service.run({ workerId: "worker-one" }),
    ).resolves.toMatchObject({
      outcome: "degraded",
      failed: 1,
    });
    expect(repository.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({ code: "CONFLICT", conflict: true }),
    );
    expect(repository.recordSynced).not.toHaveBeenCalled();
  });

  it("removes provider events before completing disconnect", async () => {
    const repository = {
      claimConnection: vi.fn().mockResolvedValue(connection("DISCONNECTING")),
      renewLease: vi.fn().mockResolvedValue(true),
      loadGamesAndLinks: vi
        .fn()
        .mockResolvedValue({ games: [game()], links: [link("SYNCED")] }),
      ensureLink: vi.fn(),
      reactivateCancelledLink: vi.fn(),
      recordSynced: vi.fn(),
      recordCancelled: vi.fn(),
      recordFailure: vi.fn(),
      finishConnection: vi.fn().mockResolvedValue(true),
      releaseFailedClaim: vi.fn(),
    };
    const provider = {
      upsert: vi.fn(),
      cancel: vi.fn().mockResolvedValue(undefined),
    };
    const service = new CalendarSynchronizationService(
      repository as never,
      () => provider,
      { emit: vi.fn() },
    );

    await expect(
      service.run({ workerId: "worker-one" }),
    ).resolves.toMatchObject({
      outcome: "succeeded",
      disconnected: true,
      cancelled: 1,
    });
    expect(provider.cancel).toHaveBeenCalledOnce();
    expect(repository.finishConnection).toHaveBeenCalledWith(
      expect.objectContaining({ disconnected: true }),
    );
  });

  it("keeps disconnect incomplete while a provider conflict is unresolved", async () => {
    const repository = {
      claimConnection: vi.fn().mockResolvedValue(connection("DISCONNECTING")),
      renewLease: vi.fn().mockResolvedValue(true),
      loadGamesAndLinks: vi
        .fn()
        .mockResolvedValue({ games: [game()], links: [link("CONFLICT")] }),
      ensureLink: vi.fn(),
      reactivateCancelledLink: vi.fn(),
      recordSynced: vi.fn(),
      recordCancelled: vi.fn(),
      recordFailure: vi.fn(),
      finishConnection: vi.fn().mockResolvedValue(true),
      releaseFailedClaim: vi.fn(),
    };
    const provider = { upsert: vi.fn(), cancel: vi.fn() };
    const service = new CalendarSynchronizationService(
      repository as never,
      () => provider,
      { emit: vi.fn() },
    );

    await expect(
      service.run({ workerId: "worker-one" }),
    ).resolves.toMatchObject({
      outcome: "degraded",
      disconnected: false,
      failed: 1,
    });
    expect(provider.cancel).not.toHaveBeenCalled();
    expect(repository.finishConnection).toHaveBeenCalledWith(
      expect.objectContaining({ failureCode: "CONFLICT", disconnected: false }),
    );
  });
});
