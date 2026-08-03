import { describe, expect, it } from "vitest";

import {
  DEFAULT_APPLICATION_CONFIGURATION,
  applicationConfigurationValuesSchema,
} from "@/domain/application-configuration";
import { loadDiscordInstallationConfiguration } from "@/server/config/discord-installation";

const valid = {
  DISCORD_OAUTH_CLIENT_ID: "123456789012345678",
  DISCORD_OAUTH_CLIENT_SECRET: "c".repeat(40),
  DISCORD_INSTALLATION_BOT_TOKEN: "b".repeat(40),
  DISCORD_OAUTH_STATE_SECRET: "s".repeat(40),
  NEXT_PUBLIC_SITE_URL: "https://app.example.test",
};

function values(overrides: Record<string, unknown> = {}) {
  return applicationConfigurationValuesSchema.parse({
    ...DEFAULT_APPLICATION_CONFIGURATION,
    integrations: {
      ...DEFAULT_APPLICATION_CONFIGURATION.integrations,
      discordInstallationCredentialReference: "discord/bot/production",
      ...overrides,
    },
  });
}

describe("Discord installation configuration", () => {
  it("derives an exact callback and applies bounded defaults", () => {
    expect(loadDiscordInstallationConfiguration(values(), valid)).toMatchObject(
      {
        redirectUri:
          "https://app.example.test/api/admin/discord-installations/callback",
        apiBaseUrl: "https://discord.com/api/v10/",
        timeoutMs: 8_000,
      },
    );
  });

  it("rejects missing secrets, public HTTP, credentials, and bad timeouts", () => {
    expect(() =>
      loadDiscordInstallationConfiguration(values(), {
        ...valid,
        DISCORD_OAUTH_CLIENT_SECRET: undefined,
      }),
    ).toThrow();
    expect(() =>
      loadDiscordInstallationConfiguration(values(), {
        ...valid,
        DISCORD_OAUTH_REDIRECT_URI: "http://app.example.test/callback",
      }),
    ).toThrow();
    expect(() =>
      loadDiscordInstallationConfiguration(
        values({
          discordInstallationApiBaseUrl:
            "https://user:password@discord.example.test/",
        }),
        valid,
      ),
    ).toThrow();
    expect(() =>
      loadDiscordInstallationConfiguration(
        values({ discordInstallationTimeoutMs: 60_000 }),
        valid,
      ),
    ).toThrow();
  });
});
