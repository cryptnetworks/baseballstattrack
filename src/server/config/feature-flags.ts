import type { ApplicationConfigurationValues } from "@/domain/application-configuration";
import { getApplicationConfigurationService } from "@/server/app/application-configuration-service";

export const featureFlagNames = [
  "FEATURE_ICS_CALENDAR_ENABLED",
  "FEATURE_EMAIL_NOTIFICATIONS_ENABLED",
  "FEATURE_DISCORD_NOTIFICATIONS_ENABLED",
  "FEATURE_DISCORD_UPDATES_ENABLED",
] as const;

export type FeatureFlagName = (typeof featureFlagNames)[number];

const keys: Readonly<
  Record<FeatureFlagName, keyof ApplicationConfigurationValues["features"]>
> = {
  FEATURE_ICS_CALENDAR_ENABLED: "calendarFeeds",
  FEATURE_EMAIL_NOTIFICATIONS_ENABLED: "emailNotifications",
  FEATURE_DISCORD_NOTIFICATIONS_ENABLED: "discordNotifications",
  FEATURE_DISCORD_UPDATES_ENABLED: "discordUpdates",
};

export function featureEnabledInConfiguration(
  name: FeatureFlagName,
  values: ApplicationConfigurationValues,
): boolean {
  return values.features[keys[name]];
}

export async function featureEnabled(
  name: FeatureFlagName,
  accountId: string,
): Promise<boolean> {
  const configuration =
    await getApplicationConfigurationService().runtime(accountId);
  return featureEnabledInConfiguration(name, configuration.values);
}
