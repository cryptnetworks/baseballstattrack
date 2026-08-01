export const featureFlagNames = [
  "FEATURE_ICS_CALENDAR_ENABLED",
  "FEATURE_EMAIL_NOTIFICATIONS_ENABLED",
  "FEATURE_DISCORD_NOTIFICATIONS_ENABLED",
  "FEATURE_DISCORD_UPDATES_ENABLED",
] as const;

export type FeatureFlagName = (typeof featureFlagNames)[number];

const enabledValues = new Set(["1", "true", "yes", "on"]);
const disabledValues = new Set(["0", "false", "no", "off"]);

export function featureEnabled(
  name: FeatureFlagName,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const value = environment[name]?.trim().toLowerCase();
  if (!value) return false;
  if (enabledValues.has(value)) return true;
  if (disabledValues.has(value)) return false;
  throw new Error(`${name} must be true or false.`);
}
