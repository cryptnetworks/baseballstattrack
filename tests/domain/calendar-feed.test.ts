import { describe, expect, it } from "vitest";

import { renderCalendarFeed } from "@/domain/calendar-feed";

describe("ICS calendar feeds", () => {
  const game = {
    id: "00000000-0000-4000-8000-000000000001",
    scheduledAt: new Date("2026-08-10T18:30:00.000Z"),
    updatedAt: new Date("2026-08-01T12:00:00.000Z"),
    opponent: "Rivals, Inc.",
    location: "Field 1; North",
  };

  it("renders a pullable RFC 5545 calendar with stable event identity", () => {
    const result = renderCalendarFeed({
      name: "Varsity games",
      detailLevel: "full",
      games: [game],
    });
    expect(result).toContain("BEGIN:VCALENDAR\r\nVERSION:2.0");
    expect(result).toContain(`UID:${game.id}@baseballstattrack`);
    expect(result).toContain("DTSTART:20260810T183000Z");
    expect(result).toContain("DTEND:20260810T213000Z");
    expect(result).toContain("SUMMARY:Baseball game vs Rivals\\, Inc.");
    expect(result).toContain("LOCATION:Field 1\\; North");
    expect(result.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("defaults private feeds to time-only game information", () => {
    const result = renderCalendarFeed({
      name: "Private",
      detailLevel: "private",
      games: [game],
    });
    expect(result).toContain("SUMMARY:Baseball game");
    expect(result).not.toContain("Rivals");
    expect(result).not.toContain("LOCATION:");
  });
});
