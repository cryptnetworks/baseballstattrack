import { describe, expect, it, vi } from "vitest";

import {
  createWebhookSecretDeriver,
  verifyWebhookSignature,
} from "@/domain/webhooks";
import {
  WebhookAdministrationService,
  WebhookDeliveryService,
  type WebhookTransport,
} from "@/server/app/webhook-service";
import { createTrustedActorContext } from "@/server/auth/types";

const ACCOUNT = "account-a";
const ACCOUNT_EXTERNAL = "00000000-0000-4000-8000-000000000010";
const ENDPOINT_EXTERNAL = "00000000-0000-4000-8000-000000000011";
const EVENT_EXTERNAL = "00000000-0000-4000-8000-000000000012";
const DELIVERY_EXTERNAL = "00000000-0000-4000-8000-000000000013";
const GAME = "00000000-0000-4000-8000-000000000014";
const SEASON = "00000000-0000-4000-8000-000000000015";
const TEAM = "00000000-0000-4000-8000-000000000016";
const secrets = createWebhookSecretDeriver(
  Buffer.alloc(32, 5).toString("base64url"),
);

function actor(accountId = ACCOUNT) {
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
    authorizedAt: "2026-07-31T19:00:00.000Z",
  });
}

function endpoint(status = "ACTIVE", secretVersion = 2) {
  return {
    id: "endpoint-internal",
    externalId: ENDPOINT_EXTERNAL,
    accountId: ACCOUNT,
    url: "https://hooks.example.com/baseball",
    status,
    subscribedEvents: ["GAME_VERIFIED"],
    secretVersion,
    verifiedAt: new Date(),
    revokedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function claimed(secretVersion = 1) {
  return {
    id: "delivery-internal",
    externalId: DELIVERY_EXTERNAL,
    accountId: ACCOUNT,
    endpointId: "endpoint-internal",
    eventId: "event-internal",
    replayNumber: 0,
    secretVersion,
    status: "PROCESSING",
    attemptCount: 0,
    nextAttemptAt: new Date(),
    leaseOwner: "worker-one",
    leaseExpiresAt: new Date(Date.now() + 60_000),
    lastFailureCode: null,
    deliveredAt: null,
    deadLetteredAt: null,
    cancelledAt: null,
    replayRequestedAt: null,
    replayRequestedById: null,
    retentionUntil: new Date(Date.now() + 86_400_000),
    createdAt: new Date(),
    updatedAt: new Date(),
    endpoint: endpoint("ACTIVE", 2),
    account: { externalId: ACCOUNT_EXTERNAL },
    event: {
      id: "event-internal",
      externalId: EVENT_EXTERNAL,
      accountId: ACCOUNT,
      sequence: 9n,
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
      occurredAt: new Date("2026-07-31T19:00:00.000Z"),
      retentionUntil: new Date("2026-10-31T19:00:00.000Z"),
      createdAt: new Date(),
    },
  };
}

function rateLimits() {
  return {
    enforce: vi.fn().mockResolvedValue({ allowed: true }),
  };
}

describe("webhook administration", () => {
  it("verifies a signed challenge before activating an endpoint", async () => {
    const repository = {
      resolveEndpoint: vi
        .fn()
        .mockResolvedValue(endpoint("PENDING_VERIFICATION", 1)),
      activateEndpoint: vi.fn().mockResolvedValue(endpoint("ACTIVE", 1)),
    };
    const transport: WebhookTransport = {
      post: vi.fn(async ({ body }) => ({
        status: 204,
        headers: {
          "x-webhook-challenge": String(JSON.parse(body).challenge),
        },
      })),
    };
    const service = new WebhookAdministrationService(
      repository as never,
      secrets,
      transport,
      rateLimits() as never,
    );

    await expect(
      service.verify(
        { accountId: ACCOUNT, endpointId: ENDPOINT_EXTERNAL },
        actor(),
      ),
    ).resolves.toEqual({ endpointId: ENDPOINT_EXTERNAL, status: "ACTIVE" });
    expect(repository.activateEndpoint).toHaveBeenCalledOnce();
  });

  it("does not activate an endpoint that fails challenge verification", async () => {
    const repository = {
      resolveEndpoint: vi
        .fn()
        .mockResolvedValue(endpoint("PENDING_VERIFICATION", 1)),
      activateEndpoint: vi.fn(),
    };
    const service = new WebhookAdministrationService(
      repository as never,
      secrets,
      { post: vi.fn().mockResolvedValue({ status: 204, headers: {} }) },
      rateLimits() as never,
    );
    await expect(
      service.verify(
        { accountId: ACCOUNT, endpointId: ENDPOINT_EXTERNAL },
        actor(),
      ),
    ).rejects.toMatchObject({ code: "VERIFICATION_FAILED" });
    expect(repository.activateEndpoint).not.toHaveBeenCalled();
  });

  it("rejects cross-Account replay before repository access", async () => {
    const repository = { resolveEndpoint: vi.fn() };
    const service = new WebhookAdministrationService(
      repository as never,
      secrets,
      { post: vi.fn() },
      rateLimits() as never,
    );
    await expect(
      service.replay(
        {
          accountId: "account-b",
          endpointId: ENDPOINT_EXTERNAL,
          eventId: EVENT_EXTERNAL,
        },
        actor(ACCOUNT),
      ),
    ).rejects.toThrow();
    expect(repository.resolveEndpoint).not.toHaveBeenCalled();
  });
});

describe("webhook delivery", () => {
  it("signs queued deliveries with their pinned pre-rotation secret", async () => {
    let request: Parameters<WebhookTransport["post"]>[0] | undefined;
    const repository = {
      claimDue: vi.fn().mockResolvedValue([claimed(1)]),
      endpointIsActive: vi.fn().mockResolvedValue(true),
      completeAttempt: vi.fn().mockResolvedValue({ status: "SUCCEEDED" }),
    };
    const service = new WebhookDeliveryService(
      repository as never,
      secrets,
      {
        post: vi.fn(async (input) => {
          request = input;
          return { status: 204, headers: {} };
        }),
      },
      { emit: vi.fn() },
    );
    await service.deliverBatch("worker-one");

    expect(request).toBeDefined();
    const timestamp = Number(request!.headers["Webhook-Timestamp"]);
    expect(
      verifyWebhookSignature({
        secret: secrets.derive("endpoint-internal", 1),
        timestamp,
        body: request!.body,
        signature: request!.headers["Webhook-Signature"]!,
        nowSeconds: timestamp,
      }),
    ).toBe(true);
    expect(
      verifyWebhookSignature({
        secret: secrets.derive("endpoint-internal", 2),
        timestamp,
        body: request!.body,
        signature: request!.headers["Webhook-Signature"]!,
        nowSeconds: timestamp,
      }),
    ).toBe(false);
    expect(JSON.parse(request!.body)).toMatchObject({
      id: EVENT_EXTERNAL,
      deliveryId: DELIVERY_EXTERNAL,
      accountId: ACCOUNT_EXTERNAL,
      sequence: "9",
      type: "game.verified",
      data: { gameId: GAME, verificationState: "VERIFIED" },
    });
  });

  it("records timeout failures for retry without throwing into producers", async () => {
    const repository = {
      claimDue: vi.fn().mockResolvedValue([claimed()]),
      endpointIsActive: vi.fn().mockResolvedValue(true),
      completeAttempt: vi.fn().mockResolvedValue({ status: "PENDING" }),
    };
    const service = new WebhookDeliveryService(
      repository as never,
      secrets,
      { post: vi.fn().mockRejectedValue(new Error("ENDPOINT_TIMEOUT")) },
      { emit: vi.fn() },
    );
    await expect(service.deliverBatch("worker-one")).resolves.toEqual([
      { deliveryId: DELIVERY_EXTERNAL, outcome: "retry" },
    ]);
    expect(repository.completeAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        succeeded: false,
        terminal: false,
        failureCode: "ENDPOINT_TIMEOUT",
      }),
    );
  });

  it("keeps event and delivery identities stable across duplicate attempts", async () => {
    const bodies: string[] = [];
    const repository = {
      claimDue: vi.fn().mockResolvedValue([claimed()]),
      endpointIsActive: vi.fn().mockResolvedValue(true),
      completeAttempt: vi.fn().mockResolvedValue({ status: "PENDING" }),
    };
    const service = new WebhookDeliveryService(
      repository as never,
      secrets,
      {
        post: vi.fn(async ({ body }) => {
          bodies.push(body);
          return { status: 503, headers: {} };
        }),
      },
      { emit: vi.fn() },
    );
    await service.deliverBatch("worker-one");
    await service.deliverBatch("worker-one");
    expect(bodies).toHaveLength(2);
    expect(JSON.parse(bodies[0]!)).toMatchObject({
      id: EVENT_EXTERNAL,
      deliveryId: DELIVERY_EXTERNAL,
    });
    expect(JSON.parse(bodies[1]!)).toMatchObject({
      id: EVENT_EXTERNAL,
      deliveryId: DELIVERY_EXTERNAL,
    });
  });

  it("surfaces repeated failure as a dead letter", async () => {
    const repository = {
      claimDue: vi.fn().mockResolvedValue([{ ...claimed(), attemptCount: 7 }]),
      endpointIsActive: vi.fn().mockResolvedValue(true),
      completeAttempt: vi.fn().mockResolvedValue({ status: "DEAD_LETTER" }),
    };
    const service = new WebhookDeliveryService(
      repository as never,
      secrets,
      { post: vi.fn().mockResolvedValue({ status: 503, headers: {} }) },
      { emit: vi.fn() },
    );
    await expect(service.deliverBatch("worker-one")).resolves.toEqual([
      { deliveryId: DELIVERY_EXTERNAL, outcome: "dead_letter" },
    ]);
  });

  it("rechecks revocation and performs no endpoint request", async () => {
    const transport = { post: vi.fn() };
    const repository = {
      claimDue: vi.fn().mockResolvedValue([claimed()]),
      endpointIsActive: vi.fn().mockResolvedValue(false),
    };
    const service = new WebhookDeliveryService(
      repository as never,
      secrets,
      transport,
      { emit: vi.fn() },
    );
    await expect(service.deliverBatch("worker-one")).resolves.toEqual([
      { deliveryId: DELIVERY_EXTERNAL, outcome: "cancelled" },
    ]);
    expect(transport.post).not.toHaveBeenCalled();
  });
});
