import { describe, expect, it } from "vitest";

import { DEFAULT_APPLICATION_CONFIGURATION } from "@/domain/application-configuration";
import { featureEnabledInConfiguration } from "@/server/config/feature-flags";
import { configurationSeedFromEnvironment } from "@/server/config/configuration-seed";

describe("database-backed feature flags", () => {
  it("reads feature ownership from validated Account configuration", () => {
    const values = {
      ...DEFAULT_APPLICATION_CONFIGURATION,
      features: {
        ...DEFAULT_APPLICATION_CONFIGURATION.features,
        calendarFeeds: true,
      },
    };
    expect(
      featureEnabledInConfiguration("FEATURE_ICS_CALENDAR_ENABLED", values),
    ).toBe(true);
    expect(
      featureEnabledInConfiguration(
        "FEATURE_EMAIL_NOTIFICATIONS_ENABLED",
        values,
      ),
    ).toBe(false);
  });

  it.each(["true", "TRUE", "1", "yes", "on"])(
    "imports the enabled legacy value %s only through the seed path",
    (value) => {
      expect(
        configurationSeedFromEnvironment({
          FEATURE_ICS_CALENDAR_ENABLED: value,
        }).features.calendarFeeds,
      ).toBe(true);
    },
  );

  it("rejects ambiguous legacy values", () => {
    expect(() =>
      configurationSeedFromEnvironment({
        FEATURE_DISCORD_NOTIFICATIONS_ENABLED: "enabled",
      }),
    ).toThrow("must be true or false");
  });
});
