import { describe, expect, it } from "vitest";

import {
  calendarConnectionInputSchema,
  calendarGameIsCancelled,
  calendarProviderEvent,
  calendarProviderEventId,
  calendarSourceFingerprint,
} from "@/domain/calendar-sync";

const game = {
  gameId: "game-internal",
  gameExternalId: "00000000-0000-4000-8000-000000000101",
  status: "READY",
  revision: 0,
  setupRevision: 2,
  scheduledAt: new Date("2026-11-01T05:30:00.000Z"),
  location: "Youth Field 4",
  opponent: "Falcons 12U",
  archivedAt: null,
};

describe("calendar synchronization contract", () => {
  it("uses a stable provider id and canonical source fingerprint", () => {
    const event = calendarProviderEvent(game, "FULL", "America/New_York");
    expect(
      calendarProviderEventId("connection-a", game.gameExternalId),
    ).toMatch(/^bst[a-f0-9]{64}$/u);
    expect(calendarProviderEventId("connection-a", game.gameExternalId)).toBe(
      calendarProviderEventId("connection-a", game.gameExternalId),
    );
    expect(
      calendarSourceFingerprint({
        event,
        status: game.status,
        revision: game.revision,
        setupRevision: game.setupRevision,
      }),
    ).toMatch(/^[a-f0-9]{64}$/u);
    expect(event.start).toEqual({
      dateTime: "2026-11-01T05:30:00.000Z",
      timeZone: "America/New_York",
    });
  });

  it("defaults to private content and requires explicit location disclosure", () => {
    const privateEvent = calendarProviderEvent(
      game,
      "PRIVATE",
      "America/New_York",
    );
    expect(privateEvent.summary).toBe("Baseball game");
    expect(privateEvent).not.toHaveProperty("location");

    const opponentEvent = calendarProviderEvent(
      game,
      "OPPONENT",
      "America/New_York",
    );
    expect(opponentEvent.summary).toBe("Baseball vs Falcons 12U");
    expect(opponentEvent).not.toHaveProperty("location");

    expect(
      calendarProviderEvent(game, "FULL", "America/New_York"),
    ).toMatchObject({
      summary: "Baseball vs Falcons 12U",
      location: "Youth Field 4",
      visibility: "private",
    });
  });

  it("treats removed schedules and terminal cancellations as deletions", () => {
    expect(calendarGameIsCancelled({ ...game, scheduledAt: null })).toBe(true);
    expect(calendarGameIsCancelled({ ...game, status: "CANCELLED" })).toBe(
      true,
    );
    expect(calendarGameIsCancelled({ ...game, status: "ABANDONED" })).toBe(
      true,
    );
    expect(calendarGameIsCancelled(game)).toBe(false);
  });

  it("rejects invalid time zones and credential references", () => {
    const base = {
      accountId: "account-a",
      provider: "GOOGLE" as const,
      providerCalendarId: "calendar@example.com",
      credentialReference: "calendar/prod-primary",
      timeZone: "America/New_York",
    };
    expect(calendarConnectionInputSchema.parse(base).detailLevel).toBe(
      "PRIVATE",
    );
    expect(() =>
      calendarConnectionInputSchema.parse({
        ...base,
        timeZone: "Mars/Olympus",
      }),
    ).toThrow();
    expect(() =>
      calendarConnectionInputSchema.parse({
        ...base,
        credentialReference: "secret token",
      }),
    ).toThrow();
  });
});
