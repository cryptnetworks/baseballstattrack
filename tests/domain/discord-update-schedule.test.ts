import { describe, expect, it } from "vitest";

import { minuteOfDay, timeOfDay } from "@/domain/discord-cadence";
import {
  discordSchedulePolicySchema,
  nextDiscordEvaluation,
} from "@/domain/discord-update-schedule";

const policy = {
  cadenceMode: "FIXED_INTERVAL" as const,
  cadenceSeconds: 300,
  gameDayWindow: { enabled: false, startMinute: 480, endMinute: 1_380 },
  digest: { enabled: false, minute: 540 },
  catchUpPolicy: "LATEST_ONLY" as const,
};
const quietHours = {
  enabled: false,
  startMinute: 1_320,
  endMinute: 420,
  timeZone: "UTC",
};

describe("Discord update scheduling", () => {
  it("bounds fixed polling and calculates the next interval", () => {
    expect(discordSchedulePolicySchema.parse(policy)).toEqual(policy);
    expect(() =>
      discordSchedulePolicySchema.parse({ ...policy, cadenceSeconds: 59 }),
    ).toThrow();
    expect(
      nextDiscordEvaluation({
        enabled: true,
        policy,
        quietHours,
        now: new Date("2026-08-01T12:00:00.000Z"),
      })?.toISOString(),
    ).toBe("2026-08-01T12:05:00.000Z");
  });

  it("defers fixed and manual evaluation through quiet hours", () => {
    const result = nextDiscordEvaluation({
      enabled: true,
      policy,
      quietHours: {
        enabled: true,
        startMinute: 720,
        endMinute: 780,
        timeZone: "UTC",
      },
      now: new Date("2026-08-01T11:59:00.000Z"),
      manualRefreshRequestedAt: new Date("2026-08-01T12:00:00.000Z"),
    });
    expect(result?.toISOString()).toBe("2026-08-01T13:00:00.000Z");
  });

  it("supports overnight game windows and daily digest time zones", () => {
    const overnight = nextDiscordEvaluation({
      enabled: true,
      policy: {
        ...policy,
        gameDayWindow: {
          enabled: true,
          startMinute: 1_200,
          endMinute: 120,
        },
      },
      quietHours,
      now: new Date("2026-08-01T12:00:00.000Z"),
    });
    expect(overnight?.toISOString()).toBe("2026-08-01T20:00:00.000Z");

    const digest = nextDiscordEvaluation({
      enabled: true,
      policy: {
        ...policy,
        cadenceMode: "EVENT_DRIVEN",
        digest: { enabled: true, minute: 540 },
      },
      quietHours: { ...quietHours, timeZone: "America/New_York" },
      now: new Date("2026-08-01T12:00:00.000Z"),
    });
    expect(digest?.toISOString()).toBe("2026-08-01T13:00:00.000Z");
  });

  it("leaves event and manual-only modes unscheduled until an explicit signal", () => {
    for (const cadenceMode of ["EVENT_DRIVEN", "MANUAL_ONLY"] as const) {
      expect(
        nextDiscordEvaluation({
          enabled: true,
          policy: { ...policy, cadenceMode },
          quietHours,
          now: new Date("2026-08-01T12:00:00.000Z"),
        }),
      ).toBeNull();
    }
    expect(
      nextDiscordEvaluation({
        enabled: false,
        policy,
        quietHours,
        now: new Date("2026-08-01T12:00:00.000Z"),
        manualRefreshRequestedAt: new Date("2026-08-01T12:00:00.000Z"),
      }),
    ).toBeNull();
  });

  it("round-trips administrator time fields", () => {
    expect(minuteOfDay("23:15")).toBe(1_395);
    expect(timeOfDay(1_395)).toBe("23:15");
    expect(() => minuteOfDay("24:00")).toThrow("out of range");
  });
});
