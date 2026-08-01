import { describe, expect, it } from "vitest";

import { featureEnabled } from "@/server/config/feature-flags";

describe("feature flags", () => {
  it.each(["true", "TRUE", "1", "yes", "on"])(
    "accepts the enabled value %s",
    (value) => {
      expect(
        featureEnabled("FEATURE_ICS_CALENDAR_ENABLED", {
          FEATURE_ICS_CALENDAR_ENABLED: value,
        }),
      ).toBe(true);
    },
  );

  it.each([undefined, "false", "0", "no", "off"])(
    "defaults or parses %s as disabled",
    (value) => {
      expect(
        featureEnabled("FEATURE_EMAIL_NOTIFICATIONS_ENABLED", {
          FEATURE_EMAIL_NOTIFICATIONS_ENABLED: value,
        }),
      ).toBe(false);
    },
  );

  it("rejects ambiguous values", () => {
    expect(() =>
      featureEnabled("FEATURE_DISCORD_NOTIFICATIONS_ENABLED", {
        FEATURE_DISCORD_NOTIFICATIONS_ENABLED: "enabled",
      }),
    ).toThrow("must be true or false");
  });
});
