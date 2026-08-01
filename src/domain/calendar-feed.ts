export const CALENDAR_EVENT_DURATION_MS = 3 * 60 * 60 * 1_000;

export type CalendarFeedDetailLevel = "private" | "opponent" | "full";

export type CalendarFeedGame = Readonly<{
  id: string;
  scheduledAt: Date;
  updatedAt: Date;
  opponent: string | null;
  location: string | null;
}>;

function escapeText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll(/\r?\n/gu, "\\n")
    .replaceAll(",", "\\,")
    .replaceAll(";", "\\;");
}

function utc(value: Date): string {
  return value
    .toISOString()
    .replaceAll(/[-:]/gu, "")
    .replace(/\.\d{3}Z$/u, "Z");
}

export function renderCalendarFeed(input: {
  name: string;
  detailLevel: CalendarFeedDetailLevel;
  games: readonly CalendarFeedGame[];
}): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Baseball Stat Track//Game Schedule//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(input.name)}`,
    "X-PUBLISHED-TTL:PT15M",
  ];

  for (const game of input.games) {
    const summary =
      input.detailLevel === "private" || !game.opponent
        ? "Baseball game"
        : `Baseball game vs ${game.opponent}`;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${escapeText(game.id)}@baseballstattrack`,
      `DTSTAMP:${utc(game.updatedAt)}`,
      `DTSTART:${utc(game.scheduledAt)}`,
      `DTEND:${utc(new Date(game.scheduledAt.getTime() + CALENDAR_EVENT_DURATION_MS))}`,
      `SUMMARY:${escapeText(summary)}`,
      "DESCRIPTION:Schedule provided by Baseball Stat Track.",
      "TRANSP:OPAQUE",
    );
    if (input.detailLevel === "full" && game.location) {
      lines.push(`LOCATION:${escapeText(game.location)}`);
    }
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR", "");
  return lines.join("\r\n");
}
