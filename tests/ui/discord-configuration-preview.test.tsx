import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DiscordConfigurationPreviewPanel } from "@/components/discord/discord-configuration-preview-panel";

describe("Discord configuration preview workspace", () => {
  it("renders readiness, four marked previews, and only a saved test route", () => {
    const html = renderToStaticMarkup(
      <DiscordConfigurationPreviewPanel
        accountId="account-a"
        enabled
        installationId="00000000-0000-4000-8000-000000000701"
        messageFormat="STANDARD"
        notice="tested"
        previews={[
          {
            id: "LIVE",
            label: "Live update",
            operation: "EDIT",
            content: "[PREVIEW — SYNTHETIC DATA — NOT A LIVE UPDATE]\nLive",
          },
          {
            id: "FINAL",
            label: "Final score",
            operation: "EDIT",
            content: "[PREVIEW — SYNTHETIC DATA — NOT A LIVE UPDATE]\nFinal",
          },
          {
            id: "CORRECTION",
            label: "Correction",
            operation: "EDIT",
            content:
              "[PREVIEW — SYNTHETIC DATA — NOT A LIVE UPDATE]\nCorrected",
          },
          {
            id: "ERROR",
            label: "Operational error",
            operation: "CREATE",
            content: "[PREVIEW — SYNTHETIC DATA — NOT A LIVE UPDATE]\nError",
          },
        ]}
        settingsRevision={8}
        testDestinations={[
          {
            id: "00000000-0000-4000-8000-000000000702",
            displayName: "game-day",
            purposes: ["LIVE_UPDATES", "FINAL_SCORES"],
          },
        ]}
        validation={{
          ready: true,
          errorCount: 0,
          warningCount: 0,
          checks: [
            {
              id: "CHANNELS",
              label: "Channels and bot permissions",
              section: "channels",
              status: "PASS",
              messages: ["Permissions verified."],
            },
            {
              id: "TEAMS",
              label: "Tracked teams",
              section: "teams",
              status: "PASS",
              messages: ["Team selected."],
            },
            {
              id: "SCHEDULE",
              label: "Schedule",
              section: "updates",
              status: "PASS",
              messages: ["Schedule supported."],
            },
            {
              id: "TRIGGERS",
              label: "Triggers and routing",
              section: "updates",
              status: "PASS",
              messages: ["Routes complete."],
            },
            {
              id: "FORMAT",
              label: "Message format",
              section: "updates",
              status: "PASS",
              messages: ["Format bounded."],
            },
          ],
        }}
      />,
    );
    for (const copy of [
      "Configuration is ready",
      "Channels and bot permissions",
      "Tracked teams",
      "Schedule",
      "Triggers and routing",
      "Message format",
      "Live update",
      "Final score",
      "Correction",
      "Operational error",
      "TEST ONLY — SYNTHETIC — NOT A LIVE UPDATE",
      "saved, permission-verified route",
      "Send marked synthetic test",
      "Clearly marked synthetic test delivery sent successfully",
    ]) {
      expect(html).toContain(copy);
    }
    expect(html.match(/PREVIEW — SYNTHETIC DATA/g)).toHaveLength(4);
    expect(html).toContain('name="returnSection" value="preview"');
    expect(html).not.toMatch(
      /guildId|channelId|botToken|credentialReference/iu,
    );
  });

  it("announces blocked validation and disables arbitrary test targeting", () => {
    const html = renderToStaticMarkup(
      <DiscordConfigurationPreviewPanel
        accountId="account-a"
        enabled={false}
        installationId="00000000-0000-4000-8000-000000000701"
        messageFormat="COMPACT"
        previews={[]}
        settingsRevision={1}
        testDestinations={[]}
        validation={{
          ready: false,
          errorCount: 1,
          warningCount: 0,
          checks: [
            {
              id: "CHANNELS",
              label: "Channels and bot permissions",
              section: "channels",
              status: "ERROR",
              messages: ["Choose a managed destination."],
            },
          ],
        }}
      />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("Configuration needs attention");
    expect(html).toContain(
      "Configure a permission-verified channel route before sending a test",
    );
    expect(html).not.toContain('name="destinationId"');
  });
});
