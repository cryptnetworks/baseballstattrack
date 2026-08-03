import { describe, expect, it } from "vitest";

import {
  DEFAULT_APPLICATION_CONFIGURATION,
  applicationConfigurationChangedCategories,
  applicationConfigurationDigest,
  applicationConfigurationValuesSchema,
} from "@/domain/application-configuration";
import { configurationSeedFromEnvironment } from "@/server/config/configuration-seed";

describe("application configuration contract", () => {
  it("validates safe defaults and produces a stable digest", () => {
    const parsed = applicationConfigurationValuesSchema.parse(
      DEFAULT_APPLICATION_CONFIGURATION,
    );
    expect(applicationConfigurationDigest(parsed)).toMatch(
      /^sha256:v1:[a-f0-9]{64}$/u,
    );
    expect(applicationConfigurationDigest(parsed)).toBe(
      applicationConfigurationDigest(
        applicationConfigurationValuesSchema.parse(
          JSON.parse(JSON.stringify(parsed)),
        ),
      ),
    );
  });

  it("rejects secret fields, credential-bearing URLs, and incomplete policies", () => {
    expect(() =>
      applicationConfigurationValuesSchema.parse({
        ...DEFAULT_APPLICATION_CONFIGURATION,
        notifications: {
          ...DEFAULT_APPLICATION_CONFIGURATION.notifications,
          smtpPassword: "must-never-be-stored",
        },
      }),
    ).toThrow();
    expect(() =>
      applicationConfigurationValuesSchema.parse({
        ...DEFAULT_APPLICATION_CONFIGURATION,
        integrations: {
          ...DEFAULT_APPLICATION_CONFIGURATION.integrations,
          externalDataProviderBaseUrl:
            "https://user:password@provider.example.test/",
        },
      }),
    ).toThrow();
    const incomplete = Object.fromEntries(
      Object.entries(DEFAULT_APPLICATION_CONFIGURATION.rateLimits).filter(
        ([key]) => key !== "API_READ",
      ),
    );
    expect(() =>
      applicationConfigurationValuesSchema.parse({
        ...DEFAULT_APPLICATION_CONFIGURATION,
        rateLimits: incomplete,
      }),
    ).toThrow();
  });

  it("reports category-level previews without exposing unchanged values", () => {
    const changed = applicationConfigurationValuesSchema.parse({
      ...DEFAULT_APPLICATION_CONFIGURATION,
      features: {
        ...DEFAULT_APPLICATION_CONFIGURATION.features,
        calendarFeeds: true,
      },
      calendar: { detailLevel: "opponent" },
    });
    expect(
      applicationConfigurationChangedCategories(
        DEFAULT_APPLICATION_CONFIGURATION,
        changed,
      ),
    ).toEqual(["FEATURES", "CALENDAR"]);
  });

  it("imports only allowlisted non-secret legacy environment values", () => {
    const seed = configurationSeedFromEnvironment({
      FEATURE_EMAIL_NOTIFICATIONS_ENABLED: "true",
      SMTP_HOST: "smtp.example.test",
      SMTP_FROM: "alerts@example.test",
      SMTP_PASSWORD: "ignored-secret",
      WEBHOOK_SIGNING_MASTER_KEY: "ignored-secret",
      EXTERNAL_DATA_PROVIDER_API_KEY: "ignored-secret",
    });
    expect(seed.features.emailNotifications).toBe(true);
    expect(seed.notifications.smtpHost).toBe("smtp.example.test");
    expect(JSON.stringify(seed)).not.toContain("ignored-secret");
  });
});
