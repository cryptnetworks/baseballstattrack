import { z } from "zod";

import {
  parseWebhookPayload,
  webhookEventNames,
  type WebhookEventName,
} from "@/domain/webhooks";

export const notificationChannels = ["EMAIL", "DISCORD"] as const;
export type NotificationChannel = (typeof notificationChannels)[number];
export const notificationDigestModes = ["IMMEDIATE", "DAILY_DIGEST"] as const;
export type NotificationDigestMode = (typeof notificationDigestModes)[number];

export const NOTIFICATION_MESSAGE_VERSION = 1;
export const NOTIFICATION_DELIVERY_RETENTION_DAYS = 30;
export const NOTIFICATION_DEAD_LETTER_RETENTION_DAYS = 90;
export const NOTIFICATION_LEASE_SECONDS = 60;
export const NOTIFICATION_MAX_ATTEMPTS = 8;
export const NOTIFICATION_RETRY_DELAYS_SECONDS = [
  0, 30, 120, 600, 3_600, 21_600, 86_400, 86_400,
] as const;

const id = z.string().trim().min(1).max(128);
const destinationReference = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/u);

function validTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export const notificationPreferenceInputSchema = z
  .object({
    accountId: id,
    membershipId: id,
    teamId: id.nullable().default(null),
    fantasyLeagueId: id.nullable().default(null),
    channel: z.enum(notificationChannels),
    destinationReference,
    subscribedEvents: z
      .array(z.enum(webhookEventNames))
      .min(1)
      .max(webhookEventNames.length),
    sensitiveContent: z.boolean().default(false),
    recipientEnabled: z.boolean().default(true),
    digestMode: z.enum(notificationDigestModes).default("IMMEDIATE"),
    digestMinute: z.int().min(0).max(1_439).default(540),
    timeZone: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .refine(validTimeZone)
      .default("UTC"),
    quietHoursEnabled: z.boolean().default(false),
    quietStartMinute: z.int().min(0).max(1_439).default(1_320),
    quietEndMinute: z.int().min(0).max(1_439).default(420),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      new Set(input.subscribedEvents).size !== input.subscribedEvents.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["subscribedEvents"],
        message: "Notification event subscriptions must be unique.",
      });
    }
    if (input.sensitiveContent) {
      context.addIssue({
        code: "custom",
        path: ["sensitiveContent"],
        message: "Sensitive notification content is not supported.",
      });
    }
    if (input.teamId !== null && input.fantasyLeagueId !== null) {
      context.addIssue({
        code: "custom",
        path: ["fantasyLeagueId"],
        message: "Notification scope must select one resource kind.",
      });
    }
    if (input.quietStartMinute === input.quietEndMinute) {
      context.addIssue({
        code: "custom",
        path: ["quietEndMinute"],
        message: "Quiet-hours start and end must differ.",
      });
    }
  });

export type NotificationMessage = Readonly<{
  version: 1;
  subject: string;
  text: string;
}>;

export function renderNotificationMessage(
  eventName: WebhookEventName,
  payloadInput: unknown,
): NotificationMessage {
  const payload = parseWebhookPayload(eventName, payloadInput);
  switch (eventName) {
    case "GAME_COMPLETED":
      return {
        version: NOTIFICATION_MESSAGE_VERSION,
        subject: "Game completed",
        text: `Game ${String(payload.gameId)} completed at source revision ${String(payload.sourceRevision)}. Verification may still be pending.`,
      };
    case "GAME_VERIFIED":
      return {
        version: NOTIFICATION_MESSAGE_VERSION,
        subject: "Game verified",
        text: `Game ${String(payload.gameId)} was verified at source revision ${String(payload.sourceRevision)}.`,
      };
    case "GAME_CORRECTED":
      return {
        version: NOTIFICATION_MESSAGE_VERSION,
        subject: "Game correction recorded",
        text: `Game ${String(payload.gameId)} was corrected at source revision ${String(payload.sourceRevision)} and requires verification.`,
      };
    case "REPORT_READY":
      return {
        version: NOTIFICATION_MESSAGE_VERSION,
        subject: "Verified report ready",
        text: `${String(payload.scope).toLowerCase()} report ${String(payload.targetId)} is current at source revision ${String(payload.sourceRevision)}. Open Baseball Stat Track to view authorized report content.`,
      };
    case "SEASON_REPORT_UPDATED":
      return {
        version: NOTIFICATION_MESSAGE_VERSION,
        subject: "Season report updated",
        text: `Season report ${String(payload.seasonId)} was updated from a verified or corrected game. Open Baseball Stat Track to view authorized content.`,
      };
    case "FANTASY_TRANSACTION_UPDATED":
      return {
        version: NOTIFICATION_MESSAGE_VERSION,
        subject: "Fantasy transaction update",
        text: `Your ${String(payload.action).replaceAll("_", " ").toLowerCase()} is ${String(payload.status).toLowerCase()} at league revision ${String(payload.revision)}. Open Baseball Stat Track for the authorized roster view.`,
      };
    case "FANTASY_SCORING_UPDATED":
      return {
        version: NOTIFICATION_MESSAGE_VERSION,
        subject: "Fantasy scoring update",
        text: `Fantasy period ${String(payload.periodSequence)} scoring is ${String(payload.status).replaceAll("_", " ").toLowerCase()} at result revision ${String(payload.resultRevision)}. Uncertainty remains visible in Baseball Stat Track.`,
      };
    case "FANTASY_MATCHUP_FINAL":
      return {
        version: NOTIFICATION_MESSAGE_VERSION,
        subject: "Fantasy matchup final",
        text: `Fantasy period ${String(payload.periodSequence)} is final with outcome ${String(payload.outcome).replaceAll("_", " ").toLowerCase()} at result revision ${String(payload.resultRevision)}. Open Baseball Stat Track for the authorized matchup details.`,
      };
    case "OPERATIONAL_FAILURE":
      return {
        version: NOTIFICATION_MESSAGE_VERSION,
        subject: "Baseball Stat Track operational warning",
        text: `${String(payload.service)} reported ${String(payload.failureCode)}. Correlation: ${String(payload.correlationId)}.`,
      };
  }
}

const localMinuteFormatters = new Map<string, Intl.DateTimeFormat>();

function localMinute(date: Date, timeZone: string): number {
  let formatter = localMinuteFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    localMinuteFormatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(date);
  return (
    Number(parts.find(({ type }) => type === "hour")?.value) * 60 +
    Number(parts.find(({ type }) => type === "minute")?.value)
  );
}

function minuteInWindow(value: number, start: number, end: number): boolean {
  return start < end
    ? value >= start && value < end
    : value >= start || value < end;
}

export function notificationDeliveryAt(
  occurredAt: Date,
  settings: Readonly<{
    digestMode: NotificationDigestMode;
    digestMinute: number;
    timeZone: string;
    quietHoursEnabled: boolean;
    quietStartMinute: number;
    quietEndMinute: number;
  }>,
): Date {
  if (
    !validTimeZone(settings.timeZone) ||
    !Number.isInteger(settings.digestMinute) ||
    settings.digestMinute < 0 ||
    settings.digestMinute > 1_439 ||
    !Number.isInteger(settings.quietStartMinute) ||
    !Number.isInteger(settings.quietEndMinute) ||
    settings.quietStartMinute === settings.quietEndMinute
  ) {
    throw new Error("Notification delivery schedule is invalid.");
  }
  let candidate = new Date(occurredAt);
  const mustMatchDigest = settings.digestMode === "DAILY_DIGEST";
  for (let index = 0; index <= 8 * 24 * 60; index += 1) {
    const minute = localMinute(candidate, settings.timeZone);
    const quiet =
      settings.quietHoursEnabled &&
      minuteInWindow(
        minute,
        settings.quietStartMinute,
        settings.quietEndMinute,
      );
    if ((!mustMatchDigest || minute === settings.digestMinute) && !quiet) {
      return candidate;
    }
    candidate = new Date(
      Math.ceil((candidate.getTime() + 1) / 60_000) * 60_000,
    );
  }
  throw new Error("Notification delivery schedule has no safe time.");
}

export function notificationRetryAt(
  attemptNumber: number,
  completedAt: Date,
): Date | null {
  if (attemptNumber >= NOTIFICATION_MAX_ATTEMPTS) return null;
  const seconds = NOTIFICATION_RETRY_DELAYS_SECONDS[attemptNumber] ?? 86_400;
  return new Date(completedAt.getTime() + seconds * 1_000);
}

export type ResolvedNotificationDestination = Readonly<{
  channel: NotificationChannel;
  destination: string;
}>;

export interface NotificationDestinationResolver {
  resolve(
    reference: string,
    expectedChannel: NotificationChannel,
  ): ResolvedNotificationDestination;
}

export type NotificationTransportResult = Readonly<{
  status: number;
}>;

export interface NotificationTransport {
  send(input: {
    channel: NotificationChannel;
    destination: string;
    idempotencyKey: string;
    message: NotificationMessage;
    timeoutMs: number;
  }): Promise<NotificationTransportResult>;
}

export class NotificationProviderError extends Error {
  constructor(
    readonly code:
      | "AUTHENTICATION_FAILED"
      | "DESTINATION_UNAVAILABLE"
      | "RATE_LIMITED"
      | "PROVIDER_UNAVAILABLE",
    readonly retryable: boolean,
    readonly responseStatus: number | null = null,
  ) {
    super(code);
    this.name = "NotificationProviderError";
  }
}
