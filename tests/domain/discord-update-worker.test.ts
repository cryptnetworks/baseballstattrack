import { describe, expect, it } from "vitest";

import {
  DISCORD_UPDATE_MAX_ATTEMPTS,
  discordDestinationPurposeForTrigger,
  discordUpdateRetryAt,
  discordUpdateSignalSchema,
} from "@/domain/discord-update-worker";

describe("Discord update worker policy", () => {
  it("maps triggers to independently authorized destination purposes", () => {
    expect(discordDestinationPurposeForTrigger("SCORE_CHANGED")).toBe(
      "LIVE_UPDATES",
    );
    expect(discordDestinationPurposeForTrigger("GAME_COMPLETED")).toBe(
      "FINAL_SCORES",
    );
    expect(discordDestinationPurposeForTrigger("GAME_CORRECTED")).toBe(
      "CORRECTIONS",
    );
    expect(discordDestinationPurposeForTrigger("REPORT_READY")).toBe(
      "SUMMARIES",
    );
    expect(discordDestinationPurposeForTrigger("OPERATIONAL_FAILURE")).toBe(
      "ERRORS",
    );
  });

  it("backs off deterministically, honors longer rate limits, and stops", () => {
    const completedAt = new Date("2026-08-01T07:00:00.000Z");
    expect(discordUpdateRetryAt(1, completedAt)?.toISOString()).toBe(
      "2026-08-01T07:00:30.000Z",
    );
    expect(discordUpdateRetryAt(2, completedAt, 600)?.toISOString()).toBe(
      "2026-08-01T07:10:00.000Z",
    );
    expect(discordUpdateRetryAt(7, completedAt, 999_999)?.toISOString()).toBe(
      "2026-08-02T07:00:00.000Z",
    );
    expect(
      discordUpdateRetryAt(DISCORD_UPDATE_MAX_ATTEMPTS, completedAt),
    ).toBeNull();
  });

  it("requires a bounded versioned game signal", () => {
    expect(
      discordUpdateSignalSchema.parse({
        accountId: "account-a",
        gameId: "00000000-0000-4000-8000-000000000119",
        trigger: "SCORE_CHANGED",
        sourceRevision: 7,
      }),
    ).toMatchObject({ sourceRevision: 7 });
    expect(() =>
      discordUpdateSignalSchema.parse({
        accountId: "account-a",
        gameId: "not-a-game",
        trigger: "SCORE_CHANGED",
        sourceRevision: -1,
      }),
    ).toThrow();
  });
});
