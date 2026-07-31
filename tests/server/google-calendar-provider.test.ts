import { describe, expect, it, vi } from "vitest";

import type { CalendarProviderEvent } from "@/domain/calendar-sync";
import {
  GoogleCalendarAdapter,
  configuredCalendarCredentialResolver,
} from "@/server/providers/google-calendar";

const event: CalendarProviderEvent = {
  summary: "Baseball game",
  description: "Managed projection",
  start: { dateTime: "2026-09-01T22:00:00.000Z", timeZone: "UTC" },
  end: { dateTime: "2026-09-02T01:00:00.000Z", timeZone: "UTC" },
  transparency: "opaque",
  visibility: "private",
  extendedProperties: {
    private: { source: "baseball-stat-track", gameId: "game-public" },
  },
};

describe("Google calendar provider", () => {
  it("creates with a caller-supplied deterministic id", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(
        new Response("{}", { status: 200, headers: { etag: '"etag-1"' } }),
      );
    const adapter = new GoogleCalendarAdapter(
      "secret-access-token-123",
      request,
    );
    await expect(
      adapter.upsert({
        calendarId: "team@example.com",
        eventId: "bst12345",
        event,
        expectedVersion: null,
      }),
    ).resolves.toEqual({ version: '"etag-1"' });
    expect(request).toHaveBeenCalledWith(
      expect.stringContaining("team%40example.com/events?sendUpdates=none"),
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"id":"bst12345"'),
      }),
    );
  });

  it("recovers an ambiguous create and enforces ETags on updates", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 409 }))
      .mockResolvedValueOnce(
        new Response("{}", { status: 200, headers: { etag: '"etag-2"' } }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 412 }));
    const adapter = new GoogleCalendarAdapter(
      "secret-access-token-123",
      request,
    );
    await expect(
      adapter.upsert({
        calendarId: "primary",
        eventId: "bst12345",
        event,
        expectedVersion: null,
      }),
    ).resolves.toEqual({ version: '"etag-2"' });
    expect(request.mock.calls[1]![1]).toMatchObject({ method: "PUT" });

    await expect(
      adapter.upsert({
        calendarId: "primary",
        eventId: "bst12345",
        event,
        expectedVersion: '"etag-old"',
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", retryable: false });
    expect(request.mock.calls[2]![1]?.headers).toMatchObject({
      "If-Match": '"etag-old"',
    });
  });

  it("resolves only explicitly configured credential references", () => {
    const resolve = configuredCalendarCredentialResolver(
      JSON.stringify({ "calendar/primary": "secret-access-token-123" }),
    );
    expect(resolve("calendar/primary")).toBeInstanceOf(GoogleCalendarAdapter);
    expect(() => resolve("calendar/missing")).toThrow(
      "Calendar credential reference is unavailable.",
    );
    expect(() => configuredCalendarCredentialResolver("not-json")).toThrow(
      "CALENDAR_PROVIDER_TOKENS_JSON is invalid.",
    );
  });
});
