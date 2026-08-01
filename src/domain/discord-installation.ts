import { z } from "zod";

export const discordSnowflakeSchema = z
  .string()
  .trim()
  .regex(/^\d{2,32}$/u, "A Discord snowflake is required.");

export const DISCORD_INSTALLATION_SCOPES = [
  "identify",
  "guilds",
  "bot",
  "applications.commands",
] as const;

export const DISCORD_INSTALLATION_PERMISSION_FLAGS = Object.freeze({
  viewChannel: 1n << 10n,
  sendMessages: 1n << 11n,
  useApplicationCommands: 1n << 31n,
});

export const DISCORD_INSTALLATION_PERMISSIONS = Object.values(
  DISCORD_INSTALLATION_PERMISSION_FLAGS,
).reduce((permissions, flag) => permissions | flag, 0n);

export const DISCORD_INSTALLATION_PERMISSION_LABELS = [
  "View channels",
  "Send messages",
  "Use application commands",
] as const;

export const discordInstallationStartSchema = z
  .object({
    action: z.literal("start"),
    accountId: z.string().trim().min(1).max(128),
  })
  .strict();

export const discordInstallationDisconnectSchema = z
  .object({
    action: z.literal("disconnect"),
    accountId: z.string().trim().min(1).max(128),
    installationId: z.uuid(),
  })
  .strict();

export const discordInstallationCommandSchema = z.discriminatedUnion("action", [
  discordInstallationStartSchema,
  discordInstallationDisconnectSchema,
]);

export const discordInstallationCallbackSchema = z
  .object({
    code: z.string().trim().min(8).max(2_048),
    state: z.string().trim().min(32).max(128),
    guildId: discordSnowflakeSchema,
    permissions: z.string().regex(/^\d{1,32}$/u),
  })
  .strict();

export type DiscordInstallationCallback = z.infer<
  typeof discordInstallationCallbackSchema
>;
