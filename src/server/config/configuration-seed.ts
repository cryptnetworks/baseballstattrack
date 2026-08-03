import {
  DEFAULT_APPLICATION_CONFIGURATION,
  applicationConfigurationValuesSchema,
  parseEnvironmentBoolean,
  type ApplicationConfigurationValues,
} from "@/domain/application-configuration";
import { loadRateLimitPolicies } from "@/domain/rate-limits";
import { legacyConfigurationEnvironment } from "@/server/config/runtime-environment";

type Environment = Readonly<Record<string, string | undefined>>;

function nullable(value: string | undefined) {
  return value?.trim() ? value.trim() : null;
}

export function configurationSeedFromEnvironment(
  environment: Environment = legacyConfigurationEnvironment(),
): ApplicationConfigurationValues {
  const destinations = environment.NOTIFICATION_DESTINATIONS_JSON?.trim()
    ? JSON.parse(environment.NOTIFICATION_DESTINATIONS_JSON)
    : {};
  return applicationConfigurationValuesSchema.parse({
    features: {
      calendarFeeds: parseEnvironmentBoolean(
        environment.FEATURE_ICS_CALENDAR_ENABLED,
        "FEATURE_ICS_CALENDAR_ENABLED",
      ),
      emailNotifications: parseEnvironmentBoolean(
        environment.FEATURE_EMAIL_NOTIFICATIONS_ENABLED,
        "FEATURE_EMAIL_NOTIFICATIONS_ENABLED",
      ),
      discordNotifications: parseEnvironmentBoolean(
        environment.FEATURE_DISCORD_NOTIFICATIONS_ENABLED,
        "FEATURE_DISCORD_NOTIFICATIONS_ENABLED",
      ),
      discordUpdates: parseEnvironmentBoolean(
        environment.FEATURE_DISCORD_UPDATES_ENABLED,
        "FEATURE_DISCORD_UPDATES_ENABLED",
      ),
    },
    calendar: {
      detailLevel:
        environment.ICS_FEED_DETAIL_LEVEL?.trim().toLowerCase() ??
        DEFAULT_APPLICATION_CONFIGURATION.calendar.detailLevel,
    },
    notifications: {
      destinations,
      smtpHost: nullable(environment.SMTP_HOST),
      smtpPort: Number(
        environment.SMTP_PORT ??
          DEFAULT_APPLICATION_CONFIGURATION.notifications.smtpPort,
      ),
      smtpSecure: parseEnvironmentBoolean(
        environment.SMTP_SECURE,
        "SMTP_SECURE",
      ),
      smtpFrom: nullable(environment.SMTP_FROM),
      discordApiBaseUrl:
        nullable(environment.NOTIFICATION_DISCORD_API_BASE_URL) ??
        DEFAULT_APPLICATION_CONFIGURATION.notifications.discordApiBaseUrl,
    },
    integrations: {
      externalDataProviderBaseUrl: nullable(
        environment.EXTERNAL_DATA_PROVIDER_BASE_URL,
      ),
      discordInstallationCredentialReference:
        nullable(environment.DISCORD_INSTALLATION_CREDENTIAL_REFERENCE) ??
        DEFAULT_APPLICATION_CONFIGURATION.integrations
          .discordInstallationCredentialReference,
      discordInstallationApiBaseUrl:
        nullable(environment.DISCORD_INSTALLATION_API_BASE_URL) ??
        DEFAULT_APPLICATION_CONFIGURATION.integrations
          .discordInstallationApiBaseUrl,
      discordInstallationTimeoutMs: Number(
        environment.DISCORD_INSTALLATION_TIMEOUT_MS ??
          DEFAULT_APPLICATION_CONFIGURATION.integrations
            .discordInstallationTimeoutMs,
      ),
      discordStatisticsApiBaseUrl: nullable(
        environment.DISCORD_STATISTICS_API_BASE_URL,
      ),
      discordUpdateApiBaseUrl:
        nullable(environment.DISCORD_UPDATE_API_BASE_URL) ??
        DEFAULT_APPLICATION_CONFIGURATION.integrations.discordUpdateApiBaseUrl,
    },
    rateLimits: loadRateLimitPolicies(environment.RATE_LIMIT_POLICIES_JSON),
  });
}
