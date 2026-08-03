import { afterEach, describe, expect, it, vi } from "vitest";

import {
  calendarFeedToken,
  calendarFeedTokenIsValid,
} from "@/server/app/calendar-feed-service";

const accountId = "00000000-0000-4000-8000-000000000001";
const teamId = "00000000-0000-4000-8000-000000000002";

afterEach(() => vi.unstubAllEnvs());

describe("calendar feed subscriptions", () => {
  it("issues stable scoped tokens and rejects tampering", () => {
    vi.stubEnv("FEATURE_ICS_CALENDAR_ENABLED", "true");
    vi.stubEnv(
      "ICS_FEED_SIGNING_KEY",
      "test-signing-key-with-at-least-32-characters",
    );
    const token = calendarFeedToken(accountId, teamId);
    expect(calendarFeedToken(accountId, teamId)).toBe(token);
    expect(calendarFeedTokenIsValid(accountId, teamId, token)).toBe(true);
    expect(
      calendarFeedTokenIsValid(
        accountId,
        "00000000-0000-4000-8000-000000000003",
        token,
      ),
    ).toBe(false);
    expect(calendarFeedTokenIsValid(accountId, teamId, `${token}x`)).toBe(
      false,
    );
  });

  it("revokes every feed when Account configuration disables the feature", () => {
    vi.stubEnv(
      "ICS_FEED_SIGNING_KEY",
      "test-signing-key-with-at-least-32-characters",
    );
    expect(calendarFeedTokenIsValid(accountId, teamId, "unused", false)).toBe(
      false,
    );
  });
});
