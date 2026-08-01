import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DiscordChannelRoutingPanel } from "@/components/discord/discord-channel-routing-panel";

const accountId = "00000000-0000-4000-8000-000000000101";
const installationId = "00000000-0000-4000-8000-000000000102";
const destinationId = "00000000-0000-4000-8000-000000000103";

function panel(
  overrides: Partial<Parameters<typeof DiscordChannelRoutingPanel>[0]> = {},
) {
  return renderToStaticMarkup(
    <DiscordChannelRoutingPanel
      accountId={accountId}
      channels={[
        {
          id: destinationId,
          displayName: "game-day",
          enabled: true,
          lastVerifiedAt: new Date("2026-08-01T04:00:00.000Z"),
        },
      ]}
      destinations={[
        { destinationId, purposes: ["LIVE_UPDATES", "FINAL_SCORES"] },
      ]}
      installationId={installationId}
      lastVerifiedAt={new Date("2026-08-01T04:00:00.000Z")}
      messageFormat="STANDARD"
      missingPermissions={{ viewChannel: 0, sendMessages: 0 }}
      permissionEvidenceStale={false}
      revision={4}
      {...overrides}
    />,
  );
}

describe("Discord channel routing panel", () => {
  it("renders six independent labelled routes plus safe test delivery", () => {
    const html = panel();
    for (const label of [
      "Live updates",
      "Final scores",
      "Corrections",
      "Summaries",
      "Errors",
      "Digests",
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("Save channel routing");
    expect(html).toContain("Send test delivery");
    expect(html).toContain('for="test-channel"');
    expect(html).toContain('for="test-format"');
    expect(html).toContain("min-h-11");
    expect(html).not.toMatch(
      /credentialReference|bot.?token|guildId|channelId/iu,
    );
  });

  it("makes stale and missing permission evidence explicit", () => {
    const html = panel({
      missingPermissions: { viewChannel: 2, sendMessages: 1 },
      permissionEvidenceStale: true,
    });
    expect(html).toContain('role="alert"');
    expect(html).toContain('role="status"');
    expect(html).toContain("2 missing View Channel permission");
    expect(html).toContain("1 missing Send Messages permission");
    expect(html).toContain("every save also revalidates with Discord");
  });

  it("keeps disabled channel identity while excluding it from route options", () => {
    const html = panel({
      channels: [
        {
          id: destinationId,
          displayName: "game-day",
          enabled: false,
          lastVerifiedAt: new Date("2026-08-01T04:00:00.000Z"),
        },
      ],
      destinations: [],
    });
    expect(html).toContain("#game-day");
    expect(html).toContain("Disabled");
    expect(html).toContain("Enable");
    expect(html).toContain("Save channel routing");
    expect(html).toContain('disabled=""');
  });

  it("protects every mutation with server-side exact capability checks", () => {
    const actions = readFileSync("src/app/discord/channel-actions.ts", "utf8");
    const service = readFileSync(
      "src/server/app/discord-channel-routing-service.ts",
      "utf8",
    );
    expect(actions).toContain('"use server"');
    expect(actions).toContain("authorizeProtectedAction");
    expect(service).toContain('"discord.settings.view"');
    expect(service).toContain('"discord.settings.configure"');
    expect(service).toContain('"discord.settings.preview"');
    expect(service).toContain("syncChannels");
  });
});
