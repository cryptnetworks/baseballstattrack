import { describe, expect, it } from "vitest";

import {
  discordSettingsDefaults,
  discordSettingsResetSchema,
  discordSettingsUpdateSchema,
} from "@/domain/discord-settings";

const INSTALLATION = "00000000-0000-4000-8000-000000000601";
const TEAM = "00000000-0000-4000-8000-000000000602";
const SEASON = "00000000-0000-4000-8000-000000000603";
const DESTINATION = "00000000-0000-4000-8000-000000000604";

function update() {
  return {
    accountId: "account-a",
    installationId: INSTALLATION,
    expectedRevision: 0,
    enabled: true,
    trackedScopes: [{ teamId: TEAM, seasonId: SEASON }],
    destinations: [
      { destinationId: DESTINATION, purposes: ["LIVE_UPDATES" as const] },
    ],
    cadenceSeconds: 60,
    triggers: ["SCORE_CHANGED" as const, "GAME_COMPLETED" as const],
    messageFormat: "COMPACT" as const,
    quietHours: {
      enabled: true,
      startMinute: 1_320,
      endMinute: 420,
      timeZone: "America/New_York",
    },
  };
}

describe("Discord settings contract", () => {
  it("defines disabled, empty, versioned safe defaults", () => {
    expect(discordSettingsDefaults).toMatchObject({
      schemaVersion: 1,
      revision: 0,
      enabled: false,
      trackedScopes: [],
      destinations: [],
      cadenceSeconds: 300,
      messageFormat: "STANDARD",
      quietHours: { enabled: false, timeZone: "UTC" },
    });
  });

  it("accepts a bounded complete replacement document", () => {
    expect(discordSettingsUpdateSchema.parse(update())).toEqual(update());
  });

  it("rejects enablement without scope or destination", () => {
    expect(() =>
      discordSettingsUpdateSchema.parse({
        ...update(),
        trackedScopes: [],
        destinations: [],
      }),
    ).toThrow("require a tracked team-season and destination");
  });

  it("rejects duplicate routes, triggers, scopes, and invalid quiet hours", () => {
    expect(() =>
      discordSettingsUpdateSchema.parse({
        ...update(),
        trackedScopes: [update().trackedScopes[0], update().trackedScopes[0]],
      }),
    ).toThrow("tracked scopes must be unique");
    expect(() =>
      discordSettingsUpdateSchema.parse({
        ...update(),
        triggers: ["GAME_COMPLETED", "GAME_COMPLETED"],
      }),
    ).toThrow("update triggers must be unique");
    expect(() =>
      discordSettingsUpdateSchema.parse({
        ...update(),
        destinations: [update().destinations[0], update().destinations[0]],
      }),
    ).toThrow("destinations must be unique");
    expect(() =>
      discordSettingsUpdateSchema.parse({
        ...update(),
        quietHours: {
          enabled: true,
          startMinute: 600,
          endMinute: 600,
          timeZone: "not/a-time-zone",
        },
      }),
    ).toThrow();
  });

  it("requires an explicit safe reset reason and revision", () => {
    expect(
      discordSettingsResetSchema.parse({
        accountId: "account-a",
        installationId: INSTALLATION,
        expectedRevision: 4,
        reasonCode: "OPERATOR_RESET",
      }),
    ).toMatchObject({ expectedRevision: 4, reasonCode: "OPERATOR_RESET" });
  });
});
