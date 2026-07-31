import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

import { z } from "zod";

export const webhookEventNames = [
  "GAME_COMPLETED",
  "GAME_VERIFIED",
  "GAME_CORRECTED",
  "REPORT_READY",
  "SEASON_REPORT_UPDATED",
  "OPERATIONAL_FAILURE",
] as const;
export type WebhookEventName = (typeof webhookEventNames)[number];

export const webhookPublicEventNames = {
  GAME_COMPLETED: "game.completed",
  GAME_VERIFIED: "game.verified",
  GAME_CORRECTED: "game.corrected",
  REPORT_READY: "report.ready",
  SEASON_REPORT_UPDATED: "season.report.updated",
  OPERATIONAL_FAILURE: "operational.failure",
} as const satisfies Record<WebhookEventName, string>;

export const WEBHOOK_PAYLOAD_VERSION = 1;
export const WEBHOOK_SIGNATURE_VERSION = "v1";
export const WEBHOOK_SIGNATURE_TOLERANCE_SECONDS = 300;
export const WEBHOOK_EVENT_RETENTION_DAYS = 90;
export const WEBHOOK_DELIVERY_RETENTION_DAYS = 30;
export const WEBHOOK_DEAD_LETTER_RETENTION_DAYS = 90;
export const WEBHOOK_MAX_ATTEMPTS = 8;
export const WEBHOOK_LEASE_SECONDS = 60;
export const WEBHOOK_RETRY_DELAYS_SECONDS = [
  0, 30, 120, 600, 3_600, 21_600, 86_400, 86_400,
] as const;

const externalId = z.uuid();
const baseGamePayload = z
  .object({
    gameId: externalId,
    seasonId: externalId,
    teamId: externalId,
    sourceRevision: z.int().nonnegative(),
  })
  .strict();

export const webhookPayloadSchemas = {
  GAME_COMPLETED: baseGamePayload
    .extend({ completionState: z.literal("COMPLETED") })
    .strict(),
  GAME_VERIFIED: baseGamePayload
    .extend({ verificationState: z.literal("VERIFIED") })
    .strict(),
  GAME_CORRECTED: baseGamePayload
    .extend({
      verificationState: z.literal("UNVERIFIED"),
      correctionState: z.literal("CORRECTED"),
    })
    .strict(),
  REPORT_READY: z
    .object({
      scope: z.enum(["GAME", "SEASON"]),
      targetId: externalId,
      sourceRevision: z.int().nonnegative(),
      derivationVersion: z.int().positive(),
      privacyOverlayRevision: z.int().nonnegative(),
      freshness: z.literal("CURRENT"),
    })
    .strict(),
  SEASON_REPORT_UPDATED: z
    .object({
      seasonId: externalId,
      teamId: externalId,
      sourceGameId: externalId,
      sourceRevision: z.int().nonnegative(),
      reason: z.enum(["GAME_VERIFIED", "GAME_CORRECTED"]),
    })
    .strict(),
  OPERATIONAL_FAILURE: z
    .object({
      service: z
        .string()
        .trim()
        .regex(/^[a-z][a-z0-9._-]{2,63}$/u),
      failureCode: z
        .string()
        .trim()
        .regex(/^[A-Z][A-Z0-9_]{2,63}$/u),
      correlationId: z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u),
      severity: z.enum(["WARNING", "CRITICAL"]),
      teamId: externalId.optional(),
    })
    .strict(),
} as const;

export function parseWebhookPayload(
  eventName: WebhookEventName,
  payload: unknown,
): Record<string, unknown> {
  return webhookPayloadSchemas[eventName].parse(payload) as Record<
    string,
    unknown
  >;
}

export type WebhookEnvelope = Readonly<{
  id: string;
  deliveryId: string;
  accountId: string;
  sequence: string;
  type: string;
  version: 1;
  occurredAt: string;
  replay: boolean;
  data: Readonly<Record<string, unknown>>;
}>;

export function serializeWebhookEnvelope(envelope: WebhookEnvelope): string {
  return JSON.stringify(envelope);
}

export interface WebhookSecretDeriver {
  derive(endpointId: string, secretVersion: number): string;
}

export function createWebhookSecretDeriver(
  encodedMasterKey: string,
): WebhookSecretDeriver {
  const masterKey = Buffer.from(encodedMasterKey, "base64url");
  if (masterKey.length < 32) {
    throw new Error(
      "WEBHOOK_SIGNING_MASTER_KEY must be at least 32 base64url-encoded bytes.",
    );
  }
  return Object.freeze({
    derive(endpointId: string, secretVersion: number): string {
      if (!Number.isSafeInteger(secretVersion) || secretVersion < 1) {
        throw new Error("Webhook secret version is invalid.");
      }
      const key = createHmac("sha256", masterKey)
        .update(`endpoint:${endpointId}:secret:${secretVersion}`, "utf8")
        .digest("base64url");
      return `whsec_${key}`;
    },
  });
}

export function generateWebhookChallenge(): string {
  return randomBytes(32).toString("base64url");
}

export function webhookSignature(
  secret: string,
  timestamp: number,
  body: string,
): string {
  const digest = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`, "utf8")
    .digest("hex");
  return `${WEBHOOK_SIGNATURE_VERSION}=${digest}`;
}

export function verifyWebhookSignature(input: {
  secret: string;
  timestamp: number;
  body: string;
  signature: string;
  nowSeconds?: number;
}): boolean {
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1_000);
  if (
    !Number.isSafeInteger(input.timestamp) ||
    Math.abs(now - input.timestamp) > WEBHOOK_SIGNATURE_TOLERANCE_SECONDS
  ) {
    return false;
  }
  const expected = webhookSignature(input.secret, input.timestamp, input.body);
  const actualBytes = Buffer.from(input.signature);
  const expectedBytes = Buffer.from(expected);
  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

export function parseWebhookEndpointUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Webhook endpoint URL is invalid.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.port && url.port !== "443") ||
    url.hostname === "localhost" ||
    isIP(url.hostname) !== 0
  ) {
    throw new Error("Webhook endpoint must be a public HTTPS URL.");
  }
  return url.toString();
}

export function webhookRetryAt(
  attemptNumber: number,
  completedAt: Date,
): Date | null {
  if (attemptNumber >= WEBHOOK_MAX_ATTEMPTS) return null;
  const seconds = WEBHOOK_RETRY_DELAYS_SECONDS[attemptNumber] ?? 86_400;
  return new Date(completedAt.getTime() + seconds * 1_000);
}
