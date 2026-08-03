import { createHash } from "node:crypto";

import { z } from "zod";

import { canonicalJson } from "@/domain/events/event-log";
import {
  DEFAULT_RATE_LIMIT_POLICIES,
  rateLimitClasses,
} from "@/domain/rate-limits";

export const APPLICATION_CONFIGURATION_SCHEMA_VERSION = 1 as const;

export const applicationConfigurationCategories = [
  "FEATURES",
  "CALENDAR",
  "NOTIFICATIONS",
  "INTEGRATIONS",
  "RATE_LIMITS",
] as const;

export type ApplicationConfigurationCategory =
  (typeof applicationConfigurationCategories)[number];

const httpsUrl = z.url().refine((value) => {
  const url = new URL(value);
  return (
    url.protocol === "https:" && !url.username && !url.password && !url.hash
  );
}, "Use an HTTPS URL without credentials or a fragment.");

const nullableHttpsUrl = z.union([httpsUrl, z.null()]);
const destinationReference = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/u);

export const notificationDestinationSchema = z.discriminatedUnion("channel", [
  z.object({ channel: z.literal("EMAIL"), destination: z.email() }).strict(),
  z
    .object({
      channel: z.literal("DISCORD"),
      destination: z.string().regex(/^\d{2,32}$/u),
    })
    .strict(),
]);

const rateLimitPolicySchema = z
  .object({
    actorLimit: z.int().positive().max(1_000_000),
    accountLimit: z.int().positive().max(10_000_000),
    windowSeconds: z.int().positive().max(86_400),
  })
  .strict()
  .refine((value) => value.accountLimit >= value.actorLimit, {
    message: "The Account limit must not be lower than the actor limit.",
  });

export const applicationConfigurationValuesSchema = z
  .object({
    features: z
      .object({
        calendarFeeds: z.boolean(),
        emailNotifications: z.boolean(),
        discordNotifications: z.boolean(),
        discordUpdates: z.boolean(),
      })
      .strict(),
    calendar: z
      .object({ detailLevel: z.enum(["private", "opponent", "full"]) })
      .strict(),
    notifications: z
      .object({
        destinations: z.record(
          destinationReference,
          notificationDestinationSchema,
        ),
        smtpHost: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/u)
          .nullable(),
        smtpPort: z.int().min(1).max(65_535),
        smtpSecure: z.boolean(),
        smtpFrom: z.email().nullable(),
        discordApiBaseUrl: httpsUrl,
      })
      .strict()
      .superRefine((value, context) => {
        if (value.smtpSecure && value.smtpPort === 25) {
          context.addIssue({
            code: "custom",
            path: ["smtpPort"],
            message: "Secure SMTP cannot use the plaintext SMTP port.",
          });
        }
      }),
    integrations: z
      .object({
        externalDataProviderBaseUrl: nullableHttpsUrl,
        discordInstallationCredentialReference: destinationReference,
        discordInstallationApiBaseUrl: httpsUrl,
        discordInstallationTimeoutMs: z.int().min(1_000).max(30_000),
        discordStatisticsApiBaseUrl: nullableHttpsUrl,
        discordUpdateApiBaseUrl: httpsUrl,
      })
      .strict(),
    rateLimits: z.record(z.enum(rateLimitClasses), rateLimitPolicySchema),
  })
  .strict()
  .superRefine((value, context) => {
    const missing = rateLimitClasses.filter(
      (endpointClass) => value.rateLimits[endpointClass] === undefined,
    );
    if (missing.length) {
      context.addIssue({
        code: "custom",
        path: ["rateLimits"],
        message: `Every rate-limit class is required: ${missing.join(", ")}.`,
      });
    }
  });

export type ApplicationConfigurationValues = z.infer<
  typeof applicationConfigurationValuesSchema
>;

export const DEFAULT_APPLICATION_CONFIGURATION: ApplicationConfigurationValues =
  Object.freeze({
    features: Object.freeze({
      calendarFeeds: false,
      emailNotifications: false,
      discordNotifications: false,
      discordUpdates: false,
    }),
    calendar: Object.freeze({ detailLevel: "private" as const }),
    notifications: Object.freeze({
      destinations: Object.freeze({}),
      smtpHost: null,
      smtpPort: 587,
      smtpSecure: false,
      smtpFrom: null,
      discordApiBaseUrl: "https://discord.com/api/v10/",
    }),
    integrations: Object.freeze({
      externalDataProviderBaseUrl: null,
      discordInstallationCredentialReference: "discord/bot/default",
      discordInstallationApiBaseUrl: "https://discord.com/api/v10/",
      discordInstallationTimeoutMs: 8_000,
      discordStatisticsApiBaseUrl: null,
      discordUpdateApiBaseUrl: "https://discord.com/api/v10/",
    }),
    rateLimits: DEFAULT_RATE_LIMIT_POLICIES,
  });

export const configurationWriteSchema = z
  .object({
    accountId: z.string().trim().min(1).max(128),
    expectedRevision: z.int().nonnegative(),
    reason: z.string().trim().min(8).max(240),
    values: applicationConfigurationValuesSchema,
  })
  .strict();

export function applicationConfigurationDigest(
  values: ApplicationConfigurationValues,
): string {
  const parsed = applicationConfigurationValuesSchema.parse(values);
  return `sha256:v1:${createHash("sha256")
    .update(canonicalJson(parsed), "utf8")
    .digest("hex")}`;
}

export function applicationConfigurationChangedCategories(
  before: ApplicationConfigurationValues,
  after: ApplicationConfigurationValues,
): ApplicationConfigurationCategory[] {
  const pairs: ReadonlyArray<
    readonly [
      ApplicationConfigurationCategory,
      keyof ApplicationConfigurationValues,
    ]
  > = [
    ["FEATURES", "features"],
    ["CALENDAR", "calendar"],
    ["NOTIFICATIONS", "notifications"],
    ["INTEGRATIONS", "integrations"],
    ["RATE_LIMITS", "rateLimits"],
  ];
  return pairs.flatMap(([category, key]) =>
    canonicalJson(before[key]) === canonicalJson(after[key]) ? [] : [category],
  );
}

export function parseEnvironmentBoolean(
  value: string | undefined,
  name: string,
): boolean {
  if (!value?.trim()) return false;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`${name} must be true or false.`);
}
