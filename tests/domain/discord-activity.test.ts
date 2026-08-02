import { describe, expect, it } from "vitest";

import { buildDiscordActivity } from "@/domain/discord-activity";

const installedAt = new Date("2026-08-01T10:00:00.000Z");

function delivery(
  overrides: Partial<
    Parameters<typeof buildDiscordActivity>[0]["deliveries"][number]
  > = {},
) {
  return {
    correlationId: "00000000-0000-4000-8000-000000001140",
    operation: "CREATE" as const,
    status: "SUCCEEDED" as const,
    attemptCount: 1,
    failureCode: null,
    scheduledAt: new Date("2026-08-01T10:05:00.000Z"),
    deliveredAt: new Date("2026-08-01T10:05:02.000Z"),
    updatedAt: new Date("2026-08-01T10:05:02.000Z"),
    ...overrides,
  };
}

function input(
  overrides: Partial<Parameters<typeof buildDiscordActivity>[0]> = {},
): Parameters<typeof buildDiscordActivity>[0] {
  return {
    installation: {
      id: "00000000-0000-4000-8000-000000001141",
      status: "ACTIVE",
      installedAt,
    },
    installationUpdatedAt: installedAt,
    settings: {
      enabled: true,
      nextScheduledEvaluationAt: new Date("2026-08-01T10:10:00.000Z"),
      trackedScopeCount: 1,
      destinationCount: 1,
    },
    lastHeartbeatAt: new Date("2026-08-01T10:05:02.000Z"),
    lastApiReadAt: new Date("2026-08-01T10:05:01.000Z"),
    lastDeliveryAt: new Date("2026-08-01T10:05:02.000Z"),
    failures: [],
    deliveries: [delivery()],
    ...overrides,
  };
}

describe("Discord activity health", () => {
  it("derives operational timestamps from durable worker records", () => {
    expect(buildDiscordActivity(input())).toMatchObject({
      deliveryEnabled: true,
      lastHeartbeatAt: new Date("2026-08-01T10:05:02.000Z"),
      lastApiReadAt: new Date("2026-08-01T10:05:01.000Z"),
      lastDeliveryAt: new Date("2026-08-01T10:05:02.000Z"),
      nextScheduledUpdateAt: new Date("2026-08-01T10:10:00.000Z"),
      errors: [],
    });
  });

  it("distinguishes configuration, authorization, stale statistics, and Discord failures", () => {
    const activity = buildDiscordActivity(
      input({
        failures: [
          {
            code: "STATISTICS_STALE",
            updatedAt: new Date("2026-08-01T10:08:00.000Z"),
          },
          {
            code: "AUTHENTICATION_FAILED",
            updatedAt: new Date("2026-08-01T10:09:00.000Z"),
          },
          {
            code: "RATE_LIMITED",
            updatedAt: new Date("2026-08-01T10:10:00.000Z"),
          },
          {
            code: "SETTINGS_OR_DESTINATION_CHANGED",
            updatedAt: new Date("2026-08-01T10:11:00.000Z"),
          },
        ],
        deliveries: [
          delivery({
            correlationId: "00000000-0000-4000-8000-000000001142",
            status: "DEAD_LETTER",
            failureCode: "AUTHENTICATION_FAILED",
            deliveredAt: null,
            updatedAt: new Date("2026-08-01T10:09:00.000Z"),
          }),
          delivery({
            correlationId: "00000000-0000-4000-8000-000000001143",
            status: "PENDING",
            failureCode: "RATE_LIMITED",
            deliveredAt: null,
            updatedAt: new Date("2026-08-01T10:10:00.000Z"),
          }),
          delivery({
            correlationId: "00000000-0000-4000-8000-000000001144",
            status: "PENDING",
            failureCode: "SETTINGS_OR_DESTINATION_CHANGED",
            deliveredAt: null,
            updatedAt: new Date("2026-08-01T10:11:00.000Z"),
          }),
        ],
      }),
    );
    expect(activity.errors.map(({ category }) => category).sort()).toEqual([
      "AUTHORIZATION",
      "CONFIGURATION",
      "DISCORD",
      "STALE_STATISTICS",
    ]);
  });

  it("ignores resolved failures, reports incomplete configuration, and bounds history", () => {
    const deliveries = Array.from({ length: 30 }, (_, index) =>
      delivery({
        correlationId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        status: "SUCCEEDED",
        failureCode: index === 0 ? "RATE_LIMITED" : null,
      }),
    );
    const activity = buildDiscordActivity(
      input({
        settings: {
          enabled: true,
          nextScheduledEvaluationAt: null,
          trackedScopeCount: 0,
          destinationCount: 1,
        },
        deliveries,
      }),
    );
    expect(activity.errors).toEqual([
      expect.objectContaining({
        category: "CONFIGURATION",
        code: "CONFIGURATION_INCOMPLETE",
      }),
    ]);
    expect(activity.deliveries).toHaveLength(25);
  });

  it("redacts unrecognized failure text", () => {
    const activity = buildDiscordActivity(
      input({
        failures: [
          {
            code: "secret-provider-body",
            updatedAt: new Date("2026-08-01T10:12:00.000Z"),
          },
        ],
      }),
    );
    expect(activity.errors).toEqual([
      expect.objectContaining({
        category: "DISCORD",
        code: "UNKNOWN_FAILURE",
      }),
    ]);
    expect(JSON.stringify(activity.errors)).not.toContain(
      "secret-provider-body",
    );
  });
});
