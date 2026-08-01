import { describe, expect, it } from "vitest";

import {
  issueDiscordOAuthState,
  verifyDiscordOAuthState,
} from "@/server/auth/discord-oauth-state";

const secret = "state-secret-that-is-longer-than-thirty-two-characters";
const now = new Date("2026-07-31T20:00:00.000Z");

describe("Discord OAuth state", () => {
  it("binds a short-lived nonce to one Account and AppUser", () => {
    const issued = issueDiscordOAuthState({
      accountId: "account-a",
      actorUserId: "user-a",
      secret,
      now,
    });
    expect(
      verifyDiscordOAuthState({
        cookieValue: issued.cookieValue,
        returnedState: issued.nonce,
        secret,
        now: new Date(now.getTime() + 9 * 60_000),
      }),
    ).toMatchObject({ accountId: "account-a", actorUserId: "user-a" });
  });

  it("fails closed for missing, changed, expired, or future state", () => {
    const issued = issueDiscordOAuthState({
      accountId: "account-a",
      actorUserId: "user-a",
      secret,
      now,
    });
    const attempts = [
      { cookieValue: null, returnedState: issued.nonce, now },
      {
        cookieValue: `${issued.cookieValue.slice(0, -1)}x`,
        returnedState: issued.nonce,
        now,
      },
      { cookieValue: issued.cookieValue, returnedState: "x".repeat(43), now },
      {
        cookieValue: issued.cookieValue,
        returnedState: issued.nonce,
        now: new Date(now.getTime() + 10 * 60_000 + 1_000),
      },
    ];
    for (const attempt of attempts) {
      expect(() => verifyDiscordOAuthState({ ...attempt, secret })).toThrow(
        "Discord OAuth state is unavailable.",
      );
    }

    const future = issueDiscordOAuthState({
      accountId: "account-a",
      actorUserId: "user-a",
      secret,
      now: new Date(now.getTime() + 60_000),
    });
    expect(() =>
      verifyDiscordOAuthState({
        cookieValue: future.cookieValue,
        returnedState: future.nonce,
        secret,
        now,
      }),
    ).toThrow();
  });
});
