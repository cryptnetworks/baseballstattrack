import { describe, expect, it, vi } from "vitest";

import {
  ConfiguredDiscordStatisticsProvider,
  ConfiguredDiscordUpdateTransport,
} from "@/server/providers/discord-updates";

const message = { id: "123456789012345678" };

describe("configured Discord statistics provider", () => {
  it("loads only the versioned read API and preserves freshness", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            version: {
              sourceRevision: 7,
              correctionCount: 1,
              verificationState: "UNVERIFIED",
              projectionFreshness: "CURRENT",
            },
            scoreKind: "CURRENT",
            gameState: { inning: 7, half: "TOP" },
            score: { AWAY: 2, HOME: 1 },
            teams: {
              AWAY: { displayName: "Away" },
              HOME: { displayName: "Home" },
            },
            innings: [{ inning: 7, side: "AWAY", runs: 2 }],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const provider = new ConfiguredDiscordStatisticsProvider(
      "https://stats.example.test/",
      "s".repeat(32),
      fetcher,
    );
    await expect(
      provider.loadGame({
        accountId: "account-a",
        gameId: "game-a",
        settingsRevision: 3,
      }),
    ).resolves.toMatchObject({
      sourceRevision: 7,
      freshness: "CURRENT",
      half: "TOP",
      correctionSummary: "current state includes 1 accepted correction",
    });
    expect(String(fetcher.mock.calls[0]![0])).toBe(
      "https://stats.example.test/api/v1/accounts/account-a/games/game-a/box-score",
    );
    expect(fetcher.mock.calls[0]![1].headers).toMatchObject({
      Authorization: `Bearer ${"s".repeat(32)}`,
      "X-Discord-Settings-Revision": "3",
    });
  });

  it("classifies stale-provider rate limits as retryable", async () => {
    const provider = new ConfiguredDiscordStatisticsProvider(
      "https://stats.example.test/",
      "s".repeat(32),
      vi
        .fn()
        .mockResolvedValue(
          new Response(null, { status: 429, headers: { "Retry-After": "75" } }),
        ),
    );
    await expect(
      provider.loadGame({ accountId: "a", gameId: "g", settingsRevision: 1 }),
    ).rejects.toMatchObject({
      code: "STATISTICS_UNAVAILABLE",
      retryable: true,
      responseStatus: 429,
      retryAfterSeconds: 75,
    });
  });

  it("retries a read API source-change response as stale statistics", async () => {
    const provider = new ConfiguredDiscordStatisticsProvider(
      "https://stats.example.test/",
      "s".repeat(32),
      vi.fn().mockResolvedValue(new Response(null, { status: 409 })),
    );
    await expect(
      provider.loadGame({ accountId: "a", gameId: "g", settingsRevision: 1 }),
    ).rejects.toMatchObject({
      code: "STATISTICS_STALE",
      retryable: true,
      responseStatus: 409,
    });
  });
});

describe("configured Discord update transport", () => {
  it("uses Discord nonce enforcement for idempotent create and append", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(message), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const transport = new ConfiguredDiscordUpdateTransport(
      "https://discord.example.test/api/v10/",
      "b".repeat(16),
      fetcher,
    );
    await expect(
      transport.send({
        operation: "CREATE",
        channelId: "223456789012345678",
        targetMessageId: null,
        idempotencyKey: "00000000-0000-4000-8000-000000000119",
        content: "Safe game update",
        format: "COMPACT",
        timeoutMs: 10_000,
      }),
    ).resolves.toEqual({ status: 200, messageId: message.id });
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ method: "POST" });
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toMatchObject({
      nonce: "00000000-0000-4000-8000-000000000119",
      enforce_nonce: true,
      allowed_mentions: { parse: [] },
    });
  });

  it("patches the pinned message for deterministic edits", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(message), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const transport = new ConfiguredDiscordUpdateTransport(
      "https://discord.example.test/api/v10/",
      "b".repeat(16),
      fetcher,
    );
    await transport.send({
      operation: "EDIT",
      channelId: "223456789012345678",
      targetMessageId: message.id,
      idempotencyKey: "00000000-0000-4000-8000-000000000119",
      content: "Corrected game update",
      format: "COMPACT",
      timeoutMs: 10_000,
    });
    expect(String(fetcher.mock.calls[0]![0])).toContain(
      `/messages/${message.id}`,
    );
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ method: "PATCH" });
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).not.toHaveProperty(
      "nonce",
    );
  });

  it("classifies revoked permissions as terminal without leaking response data", async () => {
    const transport = new ConfiguredDiscordUpdateTransport(
      "https://discord.example.test/api/v10/",
      "b".repeat(16),
      vi
        .fn()
        .mockResolvedValue(
          new Response("private provider detail", { status: 403 }),
        ),
    );
    await expect(
      transport.send({
        operation: "CREATE",
        channelId: "223456789012345678",
        targetMessageId: null,
        idempotencyKey: "00000000-0000-4000-8000-000000000119",
        content: "Safe game update",
        format: "COMPACT",
        timeoutMs: 10_000,
      }),
    ).rejects.toMatchObject({
      code: "PERMISSION_REQUIRED",
      retryable: false,
      responseStatus: 403,
      message: "PERMISSION_REQUIRED",
    });
  });
});
