import { createHash } from "node:crypto";

import { z } from "zod";

export const CALENDAR_EVENT_DURATION_MS = 3 * 60 * 60 * 1_000;
export const CALENDAR_SYNC_LEASE_SECONDS = 120;

export const calendarConnectionInputSchema = z
  .object({
    accountId: z.string().trim().min(1).max(128),
    provider: z.literal("GOOGLE"),
    providerCalendarId: z.string().trim().min(1).max(512),
    credentialReference: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/u),
    timeZone: z.string().trim().min(1).max(128),
    detailLevel: z.enum(["PRIVATE", "OPPONENT", "FULL"]).default("PRIVATE"),
  })
  .strict()
  .superRefine(({ timeZone }, context) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date(0));
    } catch {
      context.addIssue({
        code: "custom",
        path: ["timeZone"],
        message: "Time zone must be a supported IANA time-zone identifier.",
      });
    }
  });

export type CalendarDetailLevel = "PRIVATE" | "OPPONENT" | "FULL";

export type CalendarGameSource = Readonly<{
  gameId: string;
  gameExternalId: string;
  status: string;
  revision: number;
  setupRevision: number;
  scheduledAt: Date | null;
  location: string | null;
  opponent: string | null;
  archivedAt: Date | null;
}>;

export type CalendarProviderEvent = Readonly<{
  summary: string;
  description: string;
  location?: string;
  start: Readonly<{ dateTime: string; timeZone: string }>;
  end: Readonly<{ dateTime: string; timeZone: string }>;
  transparency: "opaque";
  visibility: "private";
  extendedProperties: Readonly<{
    private: Readonly<{
      source: "baseball-stat-track";
      gameId: string;
    }>;
  }>;
}>;

export function calendarProviderEventId(
  connectionExternalId: string,
  gameExternalId: string,
  generation = 0,
): string {
  return `bst${createHash("sha256")
    .update(`${connectionExternalId}:${gameExternalId}:${generation}`, "utf8")
    .digest("hex")}`;
}

export function calendarGameIsCancelled(
  game: Pick<CalendarGameSource, "scheduledAt" | "archivedAt" | "status">,
): boolean {
  return (
    game.scheduledAt === null ||
    game.archivedAt !== null ||
    game.status === "CANCELLED" ||
    game.status === "ABANDONED"
  );
}

export function calendarProviderEvent(
  game: CalendarGameSource,
  detailLevel: CalendarDetailLevel,
  timeZone: string,
): CalendarProviderEvent {
  if (calendarGameIsCancelled(game) || game.scheduledAt === null) {
    throw new Error("Cancelled games do not have provider event content.");
  }
  const opponent = detailLevel === "PRIVATE" ? null : game.opponent;
  const start = game.scheduledAt;
  const end = new Date(start.getTime() + CALENDAR_EVENT_DURATION_MS);
  return {
    summary: opponent ? `Baseball vs ${opponent}` : "Baseball game",
    description:
      "Managed by Baseball Stat Track. Calendar edits do not update the scorekeeping record.",
    ...(detailLevel === "FULL" && game.location
      ? { location: game.location }
      : {}),
    start: { dateTime: start.toISOString(), timeZone },
    end: { dateTime: end.toISOString(), timeZone },
    transparency: "opaque",
    visibility: "private",
    extendedProperties: {
      private: { source: "baseball-stat-track", gameId: game.gameExternalId },
    },
  };
}

export function calendarSourceFingerprint(input: {
  event: CalendarProviderEvent;
  status: string;
  revision: number;
  setupRevision: number;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        input.event,
        input.status,
        input.revision,
        input.setupRevision,
      ]),
      "utf8",
    )
    .digest("hex");
}

export interface CalendarProviderAdapter {
  upsert(input: {
    calendarId: string;
    eventId: string;
    event: CalendarProviderEvent;
    expectedVersion: string | null;
  }): Promise<Readonly<{ version: string }>>;
  cancel(input: {
    calendarId: string;
    eventId: string;
    expectedVersion: string | null;
  }): Promise<void>;
}

export class CalendarProviderError extends Error {
  constructor(
    readonly code:
      | "AUTHENTICATION_FAILED"
      | "CONFLICT"
      | "NOT_FOUND"
      | "RATE_LIMITED"
      | "PROVIDER_UNAVAILABLE",
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = "CalendarProviderError";
  }
}
