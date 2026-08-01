import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DiscordCadencePanel } from "@/components/discord/discord-cadence-panel";

describe("Discord cadence workspace", () => {
  it("renders explicit schedule, pause, digest, and operational states", () => {
    const markup = renderToStaticMarkup(
      <DiscordCadencePanel
        accountId="account-a"
        installationId="00000000-0000-4000-8000-000000001901"
        notice="coalesced"
        settings={{
          revision: 8,
          enabled: true,
          cadenceMode: "FIXED_INTERVAL",
          cadenceSeconds: 300,
          gameDayWindow: {
            enabled: true,
            startMinute: 480,
            endMinute: 1_380,
          },
          digest: { enabled: true, minute: 540 },
          catchUpPolicy: "LATEST_ONLY",
          quietHours: {
            enabled: true,
            startMinute: 1_320,
            endMinute: 420,
            timeZone: "America/New_York",
          },
          pausedAt: null,
          manualRefreshRequestedAt: new Date("2026-08-01T05:00:00.000Z"),
          nextScheduledEvaluationAt: new Date("2026-08-01T11:00:00.000Z"),
          lastSuccessfulUpdateAt: new Date("2026-08-01T04:55:00.000Z"),
        }}
      />,
    );
    for (const copy of [
      "Next scheduled evaluation",
      "Last successful update",
      "Event-driven",
      "Manual only",
      "Game-day window",
      "Quiet hours",
      "Scheduled digest",
      "Evaluate latest state once",
      "Pause delivery",
      "Request manual evaluation",
      "no duplicate was created",
    ]) {
      expect(markup).toContain(copy);
    }
    expect(markup).not.toContain("guildId");
  });
});
