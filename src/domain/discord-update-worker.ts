import { z } from "zod";

import {
  discordUpdateTriggers,
  type DiscordDestinationPurpose,
  type DiscordMessageFormat,
  type DiscordUpdateTrigger,
} from "@/domain/discord-settings";
import { discordGameUpdateSnapshotSchema } from "@/domain/discord-update-content";

export const DISCORD_UPDATE_LEASE_SECONDS = 60;
export const DISCORD_UPDATE_MAX_ATTEMPTS = 8;
export const DISCORD_UPDATE_RETENTION_DAYS = 90;
export const DISCORD_UPDATE_RETRY_DELAYS_SECONDS = [
  0, 30, 120, 600, 3_600, 21_600, 86_400, 86_400,
] as const;

const id = z.string().trim().min(1).max(128);

export const discordUpdateSignalSchema = z
  .object({
    accountId: id,
    gameId: z.uuid(),
    trigger: z.enum(discordUpdateTriggers),
    sourceRevision: z.number().int().min(0),
    occurredAt: z.iso.datetime().optional(),
  })
  .strict();

export const discordWorkerIdSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u);

export const discordStatisticsSnapshotSchema = discordGameUpdateSnapshotSchema
  .extend({
    sourceRevision: z.number().int().min(0),
    freshness: z.enum(["CURRENT", "STALE", "INCOMPLETE"]),
  })
  .strict();

export type DiscordStatisticsSnapshot = z.infer<
  typeof discordStatisticsSnapshotSchema
>;

export function discordUpdateRetryAt(
  attemptNumber: number,
  completedAt: Date,
  retryAfterSeconds?: number | null,
) {
  if (attemptNumber >= DISCORD_UPDATE_MAX_ATTEMPTS) return null;
  const configured =
    DISCORD_UPDATE_RETRY_DELAYS_SECONDS[attemptNumber] ?? 86_400;
  const seconds =
    retryAfterSeconds === undefined || retryAfterSeconds === null
      ? configured
      : Math.min(86_400, Math.max(configured, retryAfterSeconds));
  return new Date(completedAt.getTime() + seconds * 1_000);
}

export function discordDestinationPurposeForTrigger(
  trigger: DiscordUpdateTrigger,
): DiscordDestinationPurpose {
  if (trigger === "GAME_COMPLETED" || trigger === "GAME_VERIFIED") {
    return "FINAL_SCORES";
  }
  if (trigger === "GAME_CORRECTED") return "CORRECTIONS";
  if (trigger === "REPORT_READY") return "SUMMARIES";
  if (trigger === "OPERATIONAL_FAILURE") return "ERRORS";
  return "LIVE_UPDATES";
}

export interface DiscordStatisticsProvider {
  loadGame(input: {
    accountId: string;
    gameId: string;
    settingsRevision: number;
  }): Promise<DiscordStatisticsSnapshot>;
}

export type DiscordUpdateTransportInput = Readonly<{
  operation: "CREATE" | "EDIT" | "APPEND";
  channelId: string;
  targetMessageId: string | null;
  idempotencyKey: string;
  content: string;
  format: DiscordMessageFormat;
  timeoutMs: number;
}>;

export interface DiscordUpdateTransport {
  send(input: DiscordUpdateTransportInput): Promise<{
    status: number;
    messageId: string;
  }>;
}

export class DiscordUpdateProviderError extends Error {
  constructor(
    readonly code:
      | "AUTHENTICATION_FAILED"
      | "PERMISSION_REQUIRED"
      | "DESTINATION_UNAVAILABLE"
      | "RATE_LIMITED"
      | "PROVIDER_UNAVAILABLE"
      | "STATISTICS_STALE"
      | "STATISTICS_UNAVAILABLE",
    readonly retryable: boolean,
    readonly responseStatus: number | null = null,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(code);
    this.name = "DiscordUpdateProviderError";
  }
}
