import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_APPLICATION_CONFIGURATION,
  applicationConfigurationDigest,
} from "@/domain/application-configuration";
import {
  ApplicationConfigurationError,
  ApplicationConfigurationService,
} from "@/server/app/application-configuration-service";
import { AuthorizationError } from "@/server/auth/errors";
import { trustedActorForTest } from "../fixtures/trusted-actor";

const ACCOUNT_A = "account-a";
const ACCOUNT_B = "account-b";
const NOW = new Date("2026-08-03T14:30:00.000Z");

function actor(
  accountId = ACCOUNT_A,
  capability:
    | "configuration.view"
    | "configuration.manage"
    | "account.view" = "configuration.manage",
) {
  return trustedActorForTest({
    accountId,
    actorId: `${accountId}-admin`,
    actorKind: "USER",
    actorUserId: `${accountId}-admin`,
    membershipId: `${accountId}-membership`,
    capability,
    scope: { kind: "ACCOUNT" },
    authorizedAt: NOW.toISOString(),
  });
}

function current(revision = 1) {
  return {
    id: "configuration-a",
    externalId: "00000000-0000-4000-8000-000000000001",
    accountId: ACCOUNT_A,
    schemaVersion: 1,
    currentRevision: revision,
    values: DEFAULT_APPLICATION_CONFIGURATION,
    digest: applicationConfigurationDigest(DEFAULT_APPLICATION_CONFIGURATION),
    createdById: `${ACCOUNT_A}-admin`,
    updatedById: `${ACCOUNT_A}-admin`,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function repository(overrides: Record<string, unknown> = {}) {
  return {
    current: vi.fn().mockResolvedValue(current()),
    currentForActiveAccounts: vi.fn().mockResolvedValue([current()]),
    history: vi.fn().mockResolvedValue([]),
    seed: vi.fn(),
    save: vi.fn().mockResolvedValue(current(2)),
    rollback: vi.fn().mockResolvedValue(current(2)),
    ...overrides,
  };
}

describe("application configuration service", () => {
  it("denies non-administrators and cross-Account actors", async () => {
    const service = new ApplicationConfigurationService(repository() as never);
    await expect(
      service.view(ACCOUNT_A, actor(ACCOUNT_A, "account.view")),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      service.view(ACCOUNT_A, actor(ACCOUNT_B, "configuration.view")),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("rejects invalid and stale updates before persistence", async () => {
    const store = repository();
    const service = new ApplicationConfigurationService(store as never);
    await expect(
      service.save(
        {
          accountId: ACCOUNT_A,
          expectedRevision: 1,
          reason: "Attempt to store a secret",
          values: {
            ...DEFAULT_APPLICATION_CONFIGURATION,
            notifications: {
              ...DEFAULT_APPLICATION_CONFIGURATION.notifications,
              smtpPassword: "forbidden",
            },
          },
        },
        actor(),
      ),
    ).rejects.toThrow();
    await expect(
      service.preview(
        {
          accountId: ACCOUNT_A,
          expectedRevision: 0,
          reason: "Stale administrative preview",
          values: DEFAULT_APPLICATION_CONFIGURATION,
        },
        actor(),
      ),
    ).rejects.toBeInstanceOf(ApplicationConfigurationError);
    expect(store.save).not.toHaveBeenCalled();
  });

  it("allows an Account administrator to commit a validated revision", async () => {
    const store = repository();
    const service = new ApplicationConfigurationService(store as never);
    const values = {
      ...DEFAULT_APPLICATION_CONFIGURATION,
      features: {
        ...DEFAULT_APPLICATION_CONFIGURATION.features,
        calendarFeeds: true,
      },
    };
    await expect(
      service.save(
        {
          accountId: ACCOUNT_A,
          expectedRevision: 1,
          reason: "Enable reviewed calendar feeds",
          values,
        },
        actor(),
      ),
    ).resolves.toMatchObject({ currentRevision: 2 });
    expect(store.save).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: ACCOUNT_A, values }),
    );
  });

  it("caches reads, invalidates explicitly, and refreshes without restart", async () => {
    const store = repository();
    const service = new ApplicationConfigurationService(
      store as never,
      () => NOW,
    );
    await service.runtime(ACCOUNT_A);
    await service.runtime(ACCOUNT_A);
    expect(store.current).toHaveBeenCalledTimes(1);
    await service.refresh(ACCOUNT_A);
    expect(store.current).toHaveBeenCalledTimes(2);
  });

  it("reloads a persisted revision after restart and bounded scale-out cache expiry", async () => {
    let time = NOW.getTime();
    let persisted = current(1);
    const store = repository({
      current: vi.fn().mockImplementation(async () => persisted),
    });
    const firstInstance = new ApplicationConfigurationService(
      store as never,
      () => new Date(time),
    );
    await expect(firstInstance.runtime(ACCOUNT_A)).resolves.toMatchObject({
      revision: 1,
    });

    persisted = current(2);
    const restartedInstance = new ApplicationConfigurationService(
      store as never,
      () => new Date(time),
    );
    await expect(restartedInstance.runtime(ACCOUNT_A)).resolves.toMatchObject({
      revision: 2,
    });
    await expect(firstInstance.runtime(ACCOUNT_A)).resolves.toMatchObject({
      revision: 1,
    });

    time += 30_001;
    await expect(firstInstance.runtime(ACCOUNT_A)).resolves.toMatchObject({
      revision: 2,
    });
  });

  it("coalesces startup preloads and bounds readiness refreshes", async () => {
    const store = repository();
    const service = new ApplicationConfigurationService(
      store as never,
      () => NOW,
    );
    await Promise.all([service.preload(), service.preload()]);
    await service.preload();
    expect(store.currentForActiveAccounts).toHaveBeenCalledTimes(1);
    await service.runtime(ACCOUNT_A);
    expect(store.current).not.toHaveBeenCalled();
  });

  it("creates a new rollback revision instead of rewriting history", async () => {
    const store = repository();
    const service = new ApplicationConfigurationService(store as never);
    await expect(
      service.rollback(
        {
          accountId: ACCOUNT_A,
          expectedRevision: 2,
          targetRevision: 1,
          reason: "Restore the last reviewed behavior",
        },
        actor(),
      ),
    ).resolves.toMatchObject({ currentRevision: 2 });
    expect(store.rollback).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: ACCOUNT_A,
        expectedRevision: 2,
        targetRevision: 1,
      }),
    );
  });
});
