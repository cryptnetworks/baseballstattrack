import { z } from "zod";

import {
  parseWebhookPayload,
  webhookEventNames,
  type WebhookEventName,
} from "@/domain/webhooks";

export const notificationChannels = ["EMAIL", "DISCORD"] as const;
export type NotificationChannel = (typeof notificationChannels)[number];

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

export const notificationPreferenceInputSchema = z
  .object({
    accountId: id,
    membershipId: id,
    teamId: id.nullable().default(null),
    channel: z.enum(notificationChannels),
    destinationReference,
    subscribedEvents: z
      .array(z.enum(webhookEventNames))
      .min(1)
      .max(webhookEventNames.length),
    sensitiveContent: z.boolean().default(false),
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
    case "OPERATIONAL_FAILURE":
      return {
        version: NOTIFICATION_MESSAGE_VERSION,
        subject: "Baseball Stat Track operational warning",
        text: `${String(payload.service)} reported ${String(payload.failureCode)}. Correlation: ${String(payload.correlationId)}.`,
      };
  }
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
