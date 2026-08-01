import { describe, expect, it, vi } from "vitest";

import {
  ConfiguredNotificationDestinationResolver,
  ConfiguredNotificationTransport,
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

const smtp = {
  host: "smtp.example.test",
  port: 587,
  secure: false,
  username: "smtp-user",
  password: "smtp-password",
  from: "notifications@example.test",
};

describe("outbound notification providers", () => {
  it("resolves only managed destinations for enabled channels", () => {
    const resolver = new ConfiguredNotificationDestinationResolver(
      configuration,
      ["EMAIL"],
    );
    expect(resolver.resolve("notifications/email/coach", "EMAIL")).toEqual({
      channel: "EMAIL",
      destination: "coach@example.test",
    });
    expect(() =>
      resolver.resolve("notifications/discord/team", "DISCORD"),
    ).toThrow("DESTINATION_UNAVAILABLE");
    expect(() =>
      resolver.resolve("notifications/email/missing", "EMAIL"),
    ).toThrow("DESTINATION_UNAVAILABLE");
  });

  it("sends email directly through configured SMTP credentials", async () => {
    const sendMail = vi.fn().mockResolvedValue({ response: "250 accepted" });
    const transport = new ConfiguredNotificationTransport(
      { smtp, discord: null },
      fetch,
      { sendMail } as never,
    );
    await transport.send({
      channel: "EMAIL",
      destination: "coach@example.test",
      idempotencyKey: "delivery-email",
      message: {
        version: 1,
        subject: "Game verified",
        text: "A safe lifecycle message.",
      },
      timeoutMs: 1_000,
    });
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "notifications@example.test",
        to: "coach@example.test",
        messageId: "<delivery-email@baseballstattrack.local>",
      }),
    );
  });

  it("uses Discord delivery idempotency without mentions", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 202 }));
    const transport = new ConfiguredNotificationTransport(
      {
        smtp: null,
        discord: {
          apiBase: "https://discord.com/api/v10/",
          token: "discord-provider-token-1234567890",
        },
      },
      request,
    );
    await transport.send({
      channel: "DISCORD",
      destination: "123456789012345678",
      idempotencyKey: "delivery-discord",
      message: {
        version: 1,
        subject: "Game verified",
        text: "A safe lifecycle message.",
      },
      timeoutMs: 1_000,
    });
    expect(JSON.parse(String(request.mock.calls[0]![1]?.body))).toMatchObject({
      nonce: "delivery-discord",
      enforce_nonce: true,
      allowed_mentions: { parse: [] },
    });
    expect(request.mock.calls[0]![1]?.headers).toMatchObject({
      Authorization: "Bot discord-provider-token-1234567890",
    });
  });

  it("classifies transient SMTP failures for retry", async () => {
    const sendMail = vi.fn().mockRejectedValue({ responseCode: 451 });
    const transport = new ConfiguredNotificationTransport(
      { smtp, discord: null },
      fetch,
      { sendMail } as never,
    );
    await expect(
      transport.send({
        channel: "EMAIL",
        destination: "coach@example.test",
        idempotencyKey: "delivery-email",
        message: { version: 1, subject: "Game verified", text: "Safe" },
        timeoutMs: 1_000,
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE", retryable: true });
  });
});
