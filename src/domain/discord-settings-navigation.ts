import { z } from "zod";

export const discordSettingsSections = [
  { id: "overview", label: "Overview" },
  { id: "channels", label: "Channels" },
  { id: "teams", label: "Teams" },
  { id: "updates", label: "Updates" },
  { id: "permissions", label: "Permissions" },
  { id: "preview", label: "Preview" },
  { id: "activity", label: "Activity" },
] as const;

export const discordSettingsSectionSchema = z.enum(
  discordSettingsSections.map(({ id }) => id),
);

export type DiscordSettingsSection = z.infer<
  typeof discordSettingsSectionSchema
>;

export function discordSettingsHref(
  section: DiscordSettingsSection,
  installationId: string | null,
) {
  const path = `/discord/${section}`;
  return installationId
    ? `${path}?server=${encodeURIComponent(installationId)}`
    : path;
}
