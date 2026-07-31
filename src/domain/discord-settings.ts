import { z } from "zod";

export const DISCORD_SETTINGS_SCHEMA_VERSION = 1;
export const DISCORD_SETTINGS_MAX_SCOPES = 50;
export const DISCORD_SETTINGS_MAX_DESTINATIONS = 20;

export const discordMessageFormats = [
  "COMPACT",
  "STANDARD",
  "DETAILED",
] as const;
export const discordUpdateTriggers = [
  "GAME_SCHEDULED",
  "GAME_STARTED",
  "SCORE_CHANGED",
  "INNING_ENDED",
  "GAME_COMPLETED",
  "GAME_VERIFIED",
  "GAME_CORRECTED",
  "REPORT_READY",
  "OPERATIONAL_FAILURE",
] as const;
export const discordDestinationPurposes = [
  "LIVE_UPDATES",
  "REPORTS",
  "OPERATIONS",
] as const;

export type DiscordMessageFormat = (typeof discordMessageFormats)[number];
export type DiscordUpdateTrigger = (typeof discordUpdateTriggers)[number];
export type DiscordDestinationPurpose =
  (typeof discordDestinationPurposes)[number];

const id = z.string().trim().min(1).max(128);
const externalId = z.uuid();
const timeZone = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
      return true;
    } catch {
      return false;
    }
  }, "Quiet-hours time zone must be an IANA time zone.");

export const discordTrackedScopeSchema = z
  .object({ teamId: externalId, seasonId: externalId })
  .strict();

export const discordDestinationSelectionSchema = z
  .object({
    destinationId: externalId,
    purposes: z
      .array(z.enum(discordDestinationPurposes))
      .min(1)
      .max(discordDestinationPurposes.length),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.purposes).size !== value.purposes.length) {
      context.addIssue({
        code: "custom",
        path: ["purposes"],
        message: "Discord destination purposes must be unique.",
      });
    }
  });

export const discordSettingsUpdateSchema = z
  .object({
    accountId: id,
    installationId: externalId,
    expectedRevision: z.number().int().min(0),
    reasonCode: z
      .string()
      .trim()
      .regex(/^[A-Z][A-Z0-9_]{2,63}$/u)
      .optional(),
    enabled: z.boolean(),
    trackedScopes: z
      .array(discordTrackedScopeSchema)
      .max(DISCORD_SETTINGS_MAX_SCOPES),
    destinations: z
      .array(discordDestinationSelectionSchema)
      .max(DISCORD_SETTINGS_MAX_DESTINATIONS),
    cadenceSeconds: z.number().int().min(15).max(86_400),
    triggers: z
      .array(z.enum(discordUpdateTriggers))
      .min(1)
      .max(discordUpdateTriggers.length),
    messageFormat: z.enum(discordMessageFormats),
    quietHours: z
      .object({
        enabled: z.boolean(),
        startMinute: z.number().int().min(0).max(1_439),
        endMinute: z.number().int().min(0).max(1_439),
        timeZone,
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    const scopes = value.trackedScopes.map(
      ({ teamId, seasonId }) => `${teamId}:${seasonId}`,
    );
    if (new Set(scopes).size !== scopes.length) {
      context.addIssue({
        code: "custom",
        path: ["trackedScopes"],
        message: "Discord tracked scopes must be unique.",
      });
    }
    const destinations = value.destinations.map(
      ({ destinationId }) => destinationId,
    );
    if (new Set(destinations).size !== destinations.length) {
      context.addIssue({
        code: "custom",
        path: ["destinations"],
        message: "Discord destinations must be unique.",
      });
    }
    if (new Set(value.triggers).size !== value.triggers.length) {
      context.addIssue({
        code: "custom",
        path: ["triggers"],
        message: "Discord update triggers must be unique.",
      });
    }
    if (value.quietHours.startMinute === value.quietHours.endMinute) {
      context.addIssue({
        code: "custom",
        path: ["quietHours"],
        message: "Discord quiet hours must have different start and end times.",
      });
    }
    if (
      value.enabled &&
      (!value.trackedScopes.length || !value.destinations.length)
    ) {
      context.addIssue({
        code: "custom",
        path: ["enabled"],
        message:
          "Enabled Discord settings require a tracked team-season and destination.",
      });
    }
  });

export const discordSettingsResetSchema = z
  .object({
    accountId: id,
    installationId: externalId,
    expectedRevision: z.number().int().min(0),
    reasonCode: z
      .string()
      .trim()
      .regex(/^[A-Z][A-Z0-9_]{2,63}$/u),
  })
  .strict();

export type DiscordSettingsUpdateInput = z.infer<
  typeof discordSettingsUpdateSchema
>;
export type DiscordSettingsResetInput = z.infer<
  typeof discordSettingsResetSchema
>;

export const discordSettingsDefaults = Object.freeze({
  schemaVersion: DISCORD_SETTINGS_SCHEMA_VERSION,
  revision: 0,
  enabled: false,
  trackedScopes: [] as const,
  destinations: [] as const,
  cadenceSeconds: 300,
  triggers: [
    "GAME_COMPLETED",
    "GAME_VERIFIED",
    "GAME_CORRECTED",
  ] as const satisfies readonly DiscordUpdateTrigger[],
  messageFormat: "STANDARD" as const,
  quietHours: Object.freeze({
    enabled: false,
    startMinute: 1_320,
    endMinute: 420,
    timeZone: "UTC",
  }),
});
