import { describe, expect, it } from "vitest";

import {
  representativeDiscordConfigurationPreviews,
  validateDiscordConfiguration,
} from "@/domain/discord-configuration-preview";
import { DISCORD_MESSAGE_HARD_LIMIT } from "@/domain/discord-update-content";

function input() {
  return {
    installationStatus: "ACTIVE",
    permissionEvidenceStale: false,
    missingPermissions: { viewChannel: 0, sendMessages: 0 },
    settings: {
      enabled: true,
      trackedScopes: [{}],
      destinations: [
        {
          available: true,
          purposes: ["LIVE_UPDATES", "FINAL_SCORES", "CORRECTIONS", "ERRORS"],
        },
      ],
      cadenceMode: "EVENT_DRIVEN",
      gameDayWindow: { enabled: false, startMinute: 480, endMinute: 1_380 },
      digest: { enabled: false },
      triggers: [
        "SCORING_PLAY",
        "GAME_COMPLETED",
        "GAME_CORRECTED",
        "OPERATIONAL_FAILURE",
      ],
      messageStrategy: "EDIT_LIVE_MESSAGE",
      messageFormat: "STANDARD",
      quietHours: { enabled: false, startMinute: 1_320, endMinute: 420 },
    },
  };
}

describe("Discord configuration preview", () => {
  it("validates channels, teams, schedule, triggers, routing, and format", () => {
    expect(validateDiscordConfiguration(input())).toMatchObject({
      ready: true,
      errorCount: 0,
      checks: [
        { id: "CHANNELS", status: "PASS" },
        { id: "TEAMS", status: "PASS" },
        { id: "SCHEDULE", status: "PASS" },
        { id: "TRIGGERS", status: "PASS" },
        { id: "FORMAT", status: "PASS" },
      ],
    });
  });

  it("identifies missing permissions, unsupported settings, and missing routes", () => {
    const candidate = input();
    const result = validateDiscordConfiguration({
      ...candidate,
      permissionEvidenceStale: true,
      missingPermissions: { viewChannel: 2, sendMessages: 1 },
      settings: {
        ...candidate.settings,
        destinations: [{ available: false, purposes: ["LIVE_UPDATES"] }],
        trackedScopes: [],
        cadenceMode: "UNSUPPORTED",
        messageFormat: "RICH_EMBED",
      },
    });
    expect(result.ready).toBe(false);
    expect(JSON.stringify(result.checks)).toMatch(
      /missing View Channel|missing Send Messages/u,
    );
    expect(JSON.stringify(result.checks)).toContain("unsupported");
    expect(JSON.stringify(result.checks)).toContain(
      "No permission-verified route",
    );
  });

  it("marks bounded live, final, correction, and error previews as synthetic", () => {
    const previews = representativeDiscordConfigurationPreviews({
      messageFormat: "DETAILED",
      messageStrategy: "APPEND_EVENTS",
      triggers: [
        "SCORING_PLAY",
        "GAME_COMPLETED",
        "GAME_CORRECTED",
        "OPERATIONAL_FAILURE",
      ],
    });
    expect(previews.map(({ id }) => id)).toEqual([
      "LIVE",
      "FINAL",
      "CORRECTION",
      "ERROR",
    ]);
    for (const preview of previews) {
      expect(preview.content).toMatch(/^\[PREVIEW — SYNTHETIC DATA/u);
      expect(preview.content.length).toBeLessThanOrEqual(
        DISCORD_MESSAGE_HARD_LIMIT,
      );
    }
  });
});
