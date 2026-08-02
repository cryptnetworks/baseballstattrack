import { describe, expect, it, vi } from "vitest";

import { DISCORD_INSTALLATION_PERMISSION_FLAGS } from "@/domain/discord-installation";
import {
  ConfiguredDiscordChannelProvider,
  DiscordChannelProviderError,
  effectiveDiscordChannelPermissions,
} from "@/server/providers/discord-channels";

const configuration = {
  clientId: "123456789012345678",
  clientSecret: "c".repeat(40),
  botToken: "b".repeat(40),
  credentialReference: "discord/bot/production",
  stateSecret: "s".repeat(40),
  redirectUri: "https://app.example.test/callback",
  apiBaseUrl: "https://discord.example.test/api/v10/",
  timeoutMs: 2_000,
};

describe("Discord channel provider", () => {
  it("applies Discord overwrite order to effective bot permissions", () => {
    const view = DISCORD_INSTALLATION_PERMISSION_FLAGS.viewChannel;
    const send = DISCORD_INSTALLATION_PERMISSION_FLAGS.sendMessages;
    expect(
      effectiveDiscordChannelPermissions({
        guildId: "123456789012345601",
        botUserId: "123456789012345602",
        memberRoleIds: ["123456789012345603"],
        roles: [
          { id: "123456789012345601", permissions: view.toString() },
          { id: "123456789012345603", permissions: send.toString() },
        ],
        overwrites: [
          {
            id: "123456789012345601",
            type: 0,
            allow: "0",
            deny: send.toString(),
          },
          {
            id: "123456789012345603",
            type: 0,
            allow: send.toString(),
            deny: "0",
          },
          {
            id: "123456789012345602",
            type: 1,
            allow: "0",
            deny: view.toString(),
          },
        ],
      }),
    ).toBe(send);
  });

  it("discovers text channels and reports their effective permissions", async () => {
    const view = DISCORD_INSTALLATION_PERMISSION_FLAGS.viewChannel;
    const send = DISCORD_INSTALLATION_PERMISSION_FLAGS.sendMessages;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ id: "123456789012345602" }))
      .mockResolvedValueOnce(Response.json({ roles: [] }))
      .mockResolvedValueOnce(
        Response.json([
          {
            id: "123456789012345601",
            permissions: (view | send).toString(),
          },
        ]),
      )
      .mockResolvedValueOnce(
        Response.json([
          {
            id: "223456789012345601",
            name: "scores",
            type: 0,
            permission_overwrites: [],
          },
          {
            id: "223456789012345602",
            name: "announcements",
            type: 5,
            permission_overwrites: [
              {
                id: "123456789012345601",
                type: 0,
                allow: "0",
                deny: send.toString(),
              },
            ],
          },
          {
            id: "223456789012345603",
            name: "voice",
            type: 2,
            permission_overwrites: [],
          },
        ]),
      );
    const provider = new ConfiguredDiscordChannelProvider(
      configuration,
      fetcher,
    );
    await expect(
      provider.listTextChannels("123456789012345601"),
    ).resolves.toEqual([
      {
        channelId: "223456789012345601",
        displayName: "scores",
        canView: true,
        canSend: true,
      },
      {
        channelId: "223456789012345602",
        displayName: "announcements",
        canView: true,
        canSend: false,
      },
    ]);
    for (const call of fetcher.mock.calls) {
      expect(call[1].headers.Authorization).toBe(
        `Bot ${configuration.botToken}`,
      );
    }
  });

  it("sends a mention-safe formatted test once and maps permission failure", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 403 }));
    const provider = new ConfiguredDiscordChannelProvider(
      configuration,
      fetcher,
    );
    await provider.sendTestDelivery(
      "123456789012345601",
      "223456789012345601",
      "DETAILED",
    );
    const body = JSON.parse(
      (fetcher.mock.calls[0]![1] as RequestInit).body as string,
    );
    expect(body).toMatchObject({ allowed_mentions: { parse: [] } });
    expect(body.content).toMatch(
      /^\[TEST ONLY — SYNTHETIC — NOT A LIVE UPDATE\]/u,
    );
    expect(body.content).toContain("Format: Detailed");
    expect(body.content).not.toMatch(/player name|game result/iu);
    await expect(
      provider.sendTestDelivery(
        "123456789012345601",
        "223456789012345601",
        "COMPACT",
      ),
    ).rejects.toEqual(
      new DiscordChannelProviderError("PERMISSION_REQUIRED", false),
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
