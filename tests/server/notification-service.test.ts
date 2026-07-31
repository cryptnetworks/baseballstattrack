import { describe, expect, it, vi } from "vitest";

import { NotificationProviderError } from "@/domain/notifications";
import {
  NotificationAdministrationService,
  NotificationDeliveryService,
  NotificationEventPublicationService,
  NotificationPreferenceService,
} from "@/server/app/notification-service";
import { createTrustedActorContext } from "@/server/auth/types";

const ACCOUNT = "account-a";
const PREFERENCE = "00000000-0000-4000-8000-000000000401";
const DELIVERY = "00000000-0000-4000-8000-000000000402";
const EVENT = "00000000-0000-4000-8000-000000000403";
const GAME = "00000000-0000-4000-8000-000000000404";
const SEASON = "00000000-0000-4000-8000-000000000405";
const TEAM = "00000000-0000-4000-8000-000000000406";

function actor(
  capability: "account.manage" | "account.view",
  accountId = ACCOUNT,
) {
  return createTrustedActorContext({
    accountId,
    appUserId: "user-a",
    membershipId: "membership-a",
    actorKind: "USER",
    actorId: "user-a",
    actorUserId: "user-a",
    capability,
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

function preference() {
  return {
    id: "preference-internal",
    externalId: PREFERENCE,
    accountId: ACCOUNT,
    membershipId: "membership-a",
    teamId: null,
    scopeKey: "ACCOUNT",
    channel: "EMAIL",
    destinationReference: "notifications/email/coach",
    subscribedEvents: ["GAME_VERIFIED"],
    status: "ACTIVE",
    sensitiveContent: false,
    optedOutAt: null,
    disabledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function claimed() {
  return {
    id: "delivery-internal",
    externalId: DELIVERY,
    accountId: ACCOUNT,
    preferenceId: "preference-internal",
    eventId: "event-internal",
    channel: "EMAIL",
    destinationReference: "notifications/email/coach",
    messageVersion: 1,
    status: "PROCESSING",
    attemptCount: 0,
    nextAttemptAt: new Date(),
    leaseOwner: "worker-one",
    leaseExpiresAt: new Date(Date.now() + 60_000),
    lastFailureCode: null,
    deliveredAt: null,
    deadLetteredAt: null,
    cancelledAt: null,
    retentionUntil: new Date(Date.now() + 86_400_000),
    createdAt: new Date(),
    updatedAt: new Date(),
    preference: preference(),
    event: {
      id: "event-internal",
      externalId: EVENT,
      accountId: ACCOUNT,
      sequence: 4n,
      eventName: "GAME_VERIFIED",
      payloadVersion: 1,
      deduplicationKey: "game.verified:event-a",
      payload: {
        gameId: GAME,
        seasonId: SEASON,
        teamId: TEAM,
        sourceRevision: 7,
        verificationState: "VERIFIED",
      },
      occurredAt: new Date(),
      retentionUntil: new Date(Date.now() + 86_400_000),
      createdAt: new Date(),
    },
  };
}

const destinations = {
  resolve: vi.fn(() => ({
    channel: "EMAIL" as const,
    destination: "coach@example.test",
  })),
};

describe("notification administration", () => {
  it("configures only managed destinations with exact Account authority", async () => {
    const repository = {
      configurePreference: vi
        .fn()
        .mockResolvedValue({ outcome: "configured", preference: preference() }),
    };
    const service = new NotificationAdministrationService(
      repository as never,
      destinations,
    );
    const input = {
      accountId: ACCOUNT,
      membershipId: "membership-a",
      teamId: null,
      channel: "EMAIL",
      destinationReference: "notifications/email/coach",
      subscribedEvents: ["GAME_VERIFIED"],
      sensitiveContent: false,
    };
    await expect(
      service.configure(input, actor("account.manage")),
    ).resolves.toEqual({
      preferenceId: PREFERENCE,
      status: "ACTIVE",
    });
    expect(repository.configurePreference).toHaveBeenCalledWith(
      expect.objectContaining({ sensitiveContent: false }),
    );

    await expect(
      service.configure(
        { ...input, accountId: "account-b" },
        actor("account.manage"),
      ),
    ).rejects.toThrow();
    expect(repository.configurePreference).toHaveBeenCalledTimes(1);
  });

  it("does not let an administrator silently reactivate an opted-out recipient", async () => {
    const service = new NotificationAdministrationService(
      {
        configurePreference: vi.fn().mockResolvedValue({
          outcome: "opted_out",
          preference: { ...preference(), status: "OPTED_OUT" },
        }),
      } as never,
      destinations,
    );
    await expect(
      service.configure(
        {
          accountId: ACCOUNT,
          membershipId: "membership-a",
          channel: "EMAIL",
          destinationReference: "notifications/email/coach",
          subscribedEvents: ["GAME_VERIFIED"],
        },
        actor("account.manage"),
      ),
    ).rejects.toMatchObject({ code: "RECIPIENT_OPTED_OUT", status: 409 });
  });
});

describe("notification preferences", () => {
  it("opts out only the authenticated membership", async () => {
    const repository = { optOut: vi.fn().mockResolvedValue(2) };
    const service = new NotificationPreferenceService(repository as never);
    await expect(
      service.optOut(ACCOUNT, actor("account.view")),
    ).resolves.toEqual({ optedOut: 2 });
    expect(repository.optOut).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: ACCOUNT,
        membershipId: "membership-a",
      }),
    );
  });
});

describe("notification delivery", () => {
  it("renders and delivers safe content with a stable idempotency key", async () => {
    const transport = { send: vi.fn().mockResolvedValue({ status: 202 }) };
    const repository = {
      claimDue: vi.fn().mockResolvedValue([claimed()]),
      preferenceIsActive: vi.fn().mockResolvedValue(true),
      completeAttempt: vi.fn().mockResolvedValue({ status: "SUCCEEDED" }),
    };
    const service = new NotificationDeliveryService(
      repository as never,
      destinations,
      transport,
      { emit: vi.fn() },
    );
    await expect(service.deliverBatch("worker-one")).resolves.toEqual([
      { deliveryId: DELIVERY, outcome: "succeeded" },
    ]);
    expect(transport.send).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: DELIVERY,
        destination: "coach@example.test",
        message: expect.objectContaining({ subject: "Game verified" }),
      }),
    );
    expect(
      JSON.stringify(transport.send.mock.calls[0]![0].message),
    ).not.toMatch(/lineup|analytics|player|email/iu);
  });

  it("retries rate limits and dead-letters invalid destinations", async () => {
    const repository = {
      claimDue: vi.fn().mockResolvedValue([claimed()]),
      preferenceIsActive: vi.fn().mockResolvedValue(true),
      completeAttempt: vi
        .fn()
        .mockResolvedValueOnce({ status: "PENDING" })
        .mockResolvedValueOnce({ status: "DEAD_LETTER" }),
    };
    const transport = {
      send: vi
        .fn()
        .mockRejectedValueOnce(
          new NotificationProviderError("RATE_LIMITED", true, 429),
        )
        .mockRejectedValueOnce(
          new NotificationProviderError("DESTINATION_UNAVAILABLE", false, 404),
        ),
    };
    const service = new NotificationDeliveryService(
      repository as never,
      destinations,
      transport,
      { emit: vi.fn() },
    );
    await expect(service.deliverBatch("worker-one")).resolves.toEqual([
      { deliveryId: DELIVERY, outcome: "retry" },
    ]);
    await expect(service.deliverBatch("worker-one")).resolves.toEqual([
      { deliveryId: DELIVERY, outcome: "dead_letter" },
    ]);
    expect(repository.completeAttempt.mock.calls[0]![0]).toMatchObject({
      failureCode: "RATE_LIMITED",
      terminal: false,
    });
    expect(repository.completeAttempt.mock.calls[1]![0]).toMatchObject({
      failureCode: "DESTINATION_UNAVAILABLE",
      terminal: true,
    });
  });

  it("cancels a stale claimed delivery after membership or opt-out changes", async () => {
    const transport = { send: vi.fn() };
    const repository = {
      claimDue: vi.fn().mockResolvedValue([claimed()]),
      preferenceIsActive: vi.fn().mockResolvedValue(false),
      cancelClaim: vi.fn().mockResolvedValue({ count: 1 }),
    };
    const service = new NotificationDeliveryService(
      repository as never,
      destinations,
      transport,
      { emit: vi.fn() },
    );
    await expect(service.deliverBatch("worker-one")).resolves.toEqual([
      { deliveryId: DELIVERY, outcome: "cancelled" },
    ]);
    expect(transport.send).not.toHaveBeenCalled();
  });
});

describe("operational notification events", () => {
  it("publishes only the minimized versioned failure envelope", async () => {
    const repository = {
      publishOperationalFailure: vi
        .fn()
        .mockResolvedValue({ externalId: EVENT }),
    };
    const service = new NotificationEventPublicationService(
      repository as never,
    );
    await expect(
      service.operationalFailure({
        accountId: ACCOUNT,
        service: "calendar-sync",
        failureCode: "PROVIDER_UNAVAILABLE",
        correlationId: "correlation-1234",
        severity: "WARNING",
      }),
    ).resolves.toEqual({ eventId: EVENT });
    expect(repository.publishOperationalFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: ACCOUNT,
        service: "calendar-sync",
        failureCode: "PROVIDER_UNAVAILABLE",
      }),
    );
  });
});
