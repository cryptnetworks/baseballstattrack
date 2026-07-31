import { describe, expect, it } from "vitest";

import {
  createWebhookSecretDeriver,
  parseWebhookEndpointUrl,
  parseWebhookPayload,
  verifyWebhookSignature,
  webhookRetryAt,
  webhookSignature,
} from "@/domain/webhooks";

const masterKey = Buffer.alloc(32, 7).toString("base64url");

describe("webhook contract", () => {
  it("signs exact timestamp/body bytes and rejects tampering or stale requests", () => {
    const secret = createWebhookSecretDeriver(masterKey).derive(
      "endpoint-a",
      1,
    );
    const body = JSON.stringify({ type: "game.verified", version: 1 });
    const signature = webhookSignature(secret, 1_800_000_000, body);

    expect(
      verifyWebhookSignature({
        secret,
        timestamp: 1_800_000_000,
        body,
        signature,
        nowSeconds: 1_800_000_100,
      }),
    ).toBe(true);
    expect(
      verifyWebhookSignature({
        secret,
        timestamp: 1_800_000_000,
        body: `${body} `,
        signature,
        nowSeconds: 1_800_000_100,
      }),
    ).toBe(false);
    expect(
      verifyWebhookSignature({
        secret,
        timestamp: 1_800_000_000,
        body,
        signature,
        nowSeconds: 1_800_000_301,
      }),
    ).toBe(false);
  });

  it("keeps rotated endpoint versions distinct while retaining old derivation", () => {
    const secrets = createWebhookSecretDeriver(masterKey);
    expect(secrets.derive("endpoint-a", 1)).not.toBe(
      secrets.derive("endpoint-a", 2),
    );
    expect(secrets.derive("endpoint-a", 1)).toBe(
      createWebhookSecretDeriver(masterKey).derive("endpoint-a", 1),
    );
  });

  it("accepts only public-hostname HTTPS endpoint URLs", () => {
    expect(parseWebhookEndpointUrl("https://hooks.example.com/baseball")).toBe(
      "https://hooks.example.com/baseball",
    );
    for (const url of [
      "http://hooks.example.com",
      "https://localhost/hook",
      "https://127.0.0.1/hook",
      "https://hooks.example.com:8443/hook",
      "https://user:secret@hooks.example.com/hook",
      "https://hooks.example.com/hook?token=secret",
    ]) {
      expect(() => parseWebhookEndpointUrl(url)).toThrow();
    }
  });

  it("strictly excludes sensitive or unversioned payload fields", () => {
    const safe = {
      gameId: "00000000-0000-4000-8000-000000000001",
      seasonId: "00000000-0000-4000-8000-000000000002",
      teamId: "00000000-0000-4000-8000-000000000003",
      sourceRevision: 9,
      verificationState: "VERIFIED",
    };
    expect(parseWebhookPayload("GAME_VERIFIED", safe)).toEqual(safe);
    expect(() =>
      parseWebhookPayload("GAME_VERIFIED", {
        ...safe,
        playerName: "Private Player",
      }),
    ).toThrow();
  });

  it("uses a bounded retry schedule and terminal eighth failure", () => {
    const completed = new Date("2026-07-31T20:00:00.000Z");
    expect(webhookRetryAt(1, completed)?.toISOString()).toBe(
      "2026-07-31T20:00:30.000Z",
    );
    expect(webhookRetryAt(7, completed)?.toISOString()).toBe(
      "2026-08-01T20:00:00.000Z",
    );
    expect(webhookRetryAt(8, completed)).toBeNull();
  });
});
