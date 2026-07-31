import { describe, expect, it, vi } from "vitest";

import {
  ConfiguredNotificationDestinationResolver,
  HttpNotificationTransport,
} from "@/server/providers/outbound-notifications";

const configuration = JSON.stringify({
  "notifications/email/coach": {
    channel: "EMAIL",
    destination: "coach@example.test",
  },
  "notifications/discord/team": {
    channel: "DISCORD",
    destination: "123456789012345678",
  },
});

describe("outbound notification providers", () => {
  it("resolves only managed destinations for the expected channel", () => {
    const resolver = new ConfiguredNotificationDestinationResolver(
      configuration,
    );
    expect(resolver.resolve("notifications/email/coach", "EMAIL")).toEqual({
      channel: "EMAIL",
      destination: "coach@example.test",
    });
    expect(() =>
      resolver.resolve("notifications/email/coach", "DISCORD"),
    ).toThrow("DESTINATION_UNAVAILABLE");
    expect(() =>
      resolver.resolve("notifications/email/missing", "EMAIL"),
    ).toThrow("DESTINATION_UNAVAILABLE");
  });

  it("uses provider authentication and delivery idempotency without mentions", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 202 }));
    const transport = new HttpNotificationTransport(
      "https://email-provider.example.test/v1/messages",
      "email-provider-token-1234567890",
      "https://discord.com/api/v10/",
      "discord-provider-token-1234567890",
      request,
    );
    const message = {
      version: 1 as const,
      subject: "Game verified",
      text: "A safe lifecycle message.",
    };
    await transport.send({
      channel: "EMAIL",
      destination: "coach@example.test",
      idempotencyKey: "delivery-email",
      message,
      timeoutMs: 1_000,
    });
    await transport.send({
      channel: "DISCORD",
      destination: "123456789012345678",
      idempotencyKey: "delivery-discord",
      message,
      timeoutMs: 1_000,
    });

    expect(request.mock.calls[0]![1]).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({
        Authorization: "Bearer email-provider-token-1234567890",
        "Idempotency-Key": "delivery-email",
      }),
    });
    expect(JSON.parse(String(request.mock.calls[1]![1]?.body))).toMatchObject({
      nonce: "delivery-discord",
      enforce_nonce: true,
      allowed_mentions: { parse: [] },
    });
    expect(request.mock.calls[1]![1]?.headers).toMatchObject({
      Authorization: "Bot discord-provider-token-1234567890",
    });
  });

  it("classifies rate limits for retry and invalid destinations as terminal", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    const transport = new HttpNotificationTransport(
      "https://email-provider.example.test/v1/messages",
      "email-provider-token-1234567890",
      "https://discord.com/api/v10/",
      "discord-provider-token-1234567890",
      request,
    );
    const input = {
      channel: "EMAIL" as const,
      destination: "coach@example.test",
      idempotencyKey: "delivery-email",
      message: {
        version: 1 as const,
        subject: "Game verified",
        text: "Safe",
      },
      timeoutMs: 1_000,
    };
    await expect(transport.send(input)).rejects.toMatchObject({
      code: "RATE_LIMITED",
      retryable: true,
    });
    await expect(transport.send(input)).rejects.toMatchObject({
      code: "DESTINATION_UNAVAILABLE",
      retryable: false,
    });
  });
});
