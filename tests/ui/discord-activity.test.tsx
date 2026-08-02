import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DiscordActivityPanel } from "@/components/discord/discord-activity-panel";

describe("Discord activity dashboard", () => {
  it("shows health, classified errors, and bounded safe delivery evidence", () => {
    const markup = renderToStaticMarkup(
      <DiscordActivityPanel
        activity={{
          installation: {
            id: "00000000-0000-4000-8000-000000001146",
            status: "ACTIVE",
            installedAt: new Date("2026-08-01T10:00:00.000Z"),
          },
          deliveryEnabled: true,
          lastHeartbeatAt: new Date("2026-08-01T10:05:02.000Z"),
          lastApiReadAt: new Date("2026-08-01T10:05:01.000Z"),
          lastDeliveryAt: null,
          nextScheduledUpdateAt: new Date("2026-08-01T10:10:00.000Z"),
          errors: [
            {
              category: "AUTHORIZATION",
              code: "PERMISSION_REQUIRED",
              occurredAt: new Date("2026-08-01T10:05:02.000Z"),
            },
          ],
          deliveries: [
            {
              correlationId: "00000000-0000-4000-8000-000000001147",
              operation: "CREATE",
              status: "DEAD_LETTER",
              attemptCount: 8,
              failureCode: "PERMISSION_REQUIRED",
              scheduledAt: new Date("2026-08-01T10:05:00.000Z"),
              deliveredAt: null,
              updatedAt: new Date("2026-08-01T10:05:02.000Z"),
            },
          ],
        }}
      />,
    );
    for (const copy of [
      "Installation",
      "Last heartbeat",
      "Last statistics API read",
      "Last delivery",
      "Next scheduled update",
      "Current errors",
      "Authorization",
      "Recent delivery history",
      "Correlation ID",
    ]) {
      expect(markup).toContain(copy);
    }
    expect(markup).toContain("00000000-0000-4000-8000-000000001147");
    expect(markup).not.toMatch(
      /providerMessageId|channelId|guildId|credentialReference|bot token/iu,
    );
  });
});
