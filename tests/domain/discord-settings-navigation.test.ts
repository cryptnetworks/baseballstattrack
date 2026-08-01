import { describe, expect, it } from "vitest";

import {
  discordSettingsHref,
  discordSettingsSections,
  discordSettingsSectionSchema,
} from "@/domain/discord-settings-navigation";

describe("Discord settings navigation", () => {
  it("defines the accepted workspaces in stable order", () => {
    expect(discordSettingsSections).toEqual([
      { id: "overview", label: "Overview" },
      { id: "channels", label: "Channels" },
      { id: "teams", label: "Teams" },
      { id: "updates", label: "Updates" },
      { id: "permissions", label: "Permissions" },
      { id: "preview", label: "Preview" },
      { id: "activity", label: "Activity" },
    ]);
    expect(discordSettingsSectionSchema.safeParse("scoring").success).toBe(
      false,
    );
  });

  it("preserves only an encoded managed installation identifier", () => {
    expect(
      discordSettingsHref("channels", "00000000-0000-4000-8000-000000000111"),
    ).toBe("/discord/channels?server=00000000-0000-4000-8000-000000000111");
    expect(discordSettingsHref("overview", null)).toBe("/discord/overview");
  });
});
