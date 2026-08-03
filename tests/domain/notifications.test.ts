import { describe, expect, it } from "vitest";

import {
  notificationDeliveryAt,
  notificationPreferenceInputSchema,
  notificationRetryAt,
  renderNotificationMessage,
} from "@/domain/notifications";

const GAME = "00000000-0000-4000-8000-000000000301";
const SEASON = "00000000-0000-4000-8000-000000000302";
const TEAM = "00000000-0000-4000-8000-000000000303";

describe("outbound notification contract", () => {
  it("accepts explicit safe recipient rules and rejects sensitive content", () => {
    const rule = {
      accountId: "account-a",
      membershipId: "membership-a",
      teamId: "team-a",
      channel: "EMAIL" as const,
      destinationReference: "notifications/email/coach",
      subscribedEvents: ["GAME_COMPLETED", "REPORT_READY"] as const,
      sensitiveContent: false,
    };
    expect(notificationPreferenceInputSchema.parse(rule)).toMatchObject(rule);
    expect(() =>
      notificationPreferenceInputSchema.parse({
        ...rule,
        sensitiveContent: true,
      }),
    ).toThrow("Sensitive notification content is not supported");
    expect(() =>
      notificationPreferenceInputSchema.parse({
        ...rule,
        subscribedEvents: ["GAME_COMPLETED", "GAME_COMPLETED"],
      }),
    ).toThrow("must be unique");
  });

  it("renders lifecycle messages without report, player, or analytics content", () => {
    const messages = [
      renderNotificationMessage("GAME_COMPLETED", {
        gameId: GAME,
        seasonId: SEASON,
        teamId: TEAM,
        sourceRevision: 8,
        completionState: "COMPLETED",
      }),
      renderNotificationMessage("GAME_CORRECTED", {
        gameId: GAME,
        seasonId: SEASON,
        teamId: TEAM,
        sourceRevision: 9,
        verificationState: "UNVERIFIED",
        correctionState: "CORRECTED",
      }),
      renderNotificationMessage("REPORT_READY", {
        scope: "GAME",
        targetId: GAME,
        sourceRevision: 9,
        derivationVersion: 1,
        privacyOverlayRevision: 2,
        freshness: "CURRENT",
      }),
      renderNotificationMessage("OPERATIONAL_FAILURE", {
        service: "calendar-sync",
        failureCode: "PROVIDER_UNAVAILABLE",
        correlationId: "correlation-1234",
        severity: "WARNING",
        teamId: TEAM,
      }),
    ];
    const serialized = JSON.stringify(messages);
    const normalized = serialized.toLowerCase();
    expect(serialized).toContain(GAME);
    expect(normalized).toContain("verification may still be pending");
    expect(normalized).toContain("requires verification");
    expect(serialized).not.toMatch(
      /player|lineup|matchup|trend|recommendation|batting|pitching|email/iu,
    );
  });

  it("uses bounded deterministic retries and dead-letters after attempt eight", () => {
    const completedAt = new Date("2026-08-01T00:00:00.000Z");
    expect(notificationRetryAt(1, completedAt)?.toISOString()).toBe(
      "2026-08-01T00:00:30.000Z",
    );
    expect(notificationRetryAt(7, completedAt)?.toISOString()).toBe(
      "2026-08-02T00:00:00.000Z",
    );
    expect(notificationRetryAt(8, completedAt)).toBeNull();
  });

  it("renders privacy-minimized fantasy updates and schedules consented delivery", () => {
    const message = renderNotificationMessage("FANTASY_SCORING_UPDATED", {
      fantasyLeagueId: "00000000-0000-4000-8000-000000000127",
      fantasyTeamId: "00000000-0000-4000-8000-000000000128",
      resultId: "00000000-0000-4000-8000-000000000129",
      resultRevision: 2,
      periodSequence: 4,
      status: "AWAITING_FINAL_DATA",
      totalMilliPoints: 12_500,
    });
    expect(message.text.toLowerCase()).toContain("uncertainty remains visible");
    expect(JSON.stringify(message)).not.toMatch(
      /player|email|contact|medical/i,
    );

    const scheduled = notificationDeliveryAt(
      new Date("2026-08-03T12:00:00.000Z"),
      {
        digestMode: "DAILY_DIGEST",
        digestMinute: 540,
        timeZone: "UTC",
        quietHoursEnabled: true,
        quietStartMinute: 1_320,
        quietEndMinute: 420,
      },
    );
    expect(scheduled.toISOString()).toBe("2026-08-04T09:00:00.000Z");
  });
});
