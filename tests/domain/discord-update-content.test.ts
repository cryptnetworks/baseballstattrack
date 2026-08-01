import { describe, expect, it } from "vitest";

import {
  DISCORD_MESSAGE_HARD_LIMIT,
  discordMessageBudgets,
  discordMessageStrategyDefinitions,
  discordUpdateContentSchema,
  discordUpdateTriggerDefinitions,
  planDiscordGameUpdate,
  renderDiscordGameUpdate,
  representativeDiscordStrategyPreviews,
} from "@/domain/discord-update-content";

const snapshot = {
  awayTeam: "Harbor Hawks",
  homeTeam: "Metro Stars",
  awayScore: 4,
  homeScore: 3,
  inning: 7,
  half: "TOP" as const,
  latestEvent: "R. Rivera doubled to left; two runs scored.",
  correctionSummary: null,
  reportReady: false,
  verified: false,
};

const allTriggers = discordUpdateTriggerDefinitions.map(({ id }) => id);

describe("Discord update content policy", () => {
  it("covers the complete M5 trigger and strategy vocabulary", () => {
    expect(allTriggers).toEqual(
      expect.arrayContaining([
        "GAME_STARTED",
        "INNING_ENDED",
        "SCORE_CHANGED",
        "LEAD_CHANGED",
        "SCORING_PLAY",
        "PITCHING_CHANGED",
        "GAME_CORRECTED",
        "GAME_COMPLETED",
        "REPORT_READY",
      ]),
    );
    expect(discordMessageStrategyDefinitions.map(({ id }) => id)).toEqual([
      "EDIT_LIVE_MESSAGE",
      "APPEND_EVENTS",
      "PERIODIC_SUMMARY",
      "FINAL_ONLY",
    ]);
  });

  it("validates correction-safe content updates", () => {
    expect(
      discordUpdateContentSchema.parse({
        accountId: "account-a",
        installationId: "00000000-0000-4000-8000-000000002001",
        expectedRevision: 4,
        triggers: ["GAME_COMPLETED", "GAME_CORRECTED"],
        messageStrategy: "FINAL_ONLY",
        messageFormat: "STANDARD",
      }),
    ).toMatchObject({ messageStrategy: "FINAL_ONLY" });
    expect(() =>
      discordUpdateContentSchema.parse({
        accountId: "account-a",
        installationId: "00000000-0000-4000-8000-000000002001",
        expectedRevision: 4,
        triggers: ["GAME_COMPLETED"],
        messageStrategy: "FINAL_ONLY",
        messageFormat: "STANDARD",
      }),
    ).toThrow("correction updates are required");
  });

  it("plans edit, append, periodic, final-only, correction, and ignored states", () => {
    const common = {
      format: "STANDARD" as const,
      triggers: allTriggers,
      trigger: "SCORING_PLAY" as const,
      snapshot,
      hasPublishedMessage: true,
    };
    expect(
      planDiscordGameUpdate({ ...common, strategy: "EDIT_LIVE_MESSAGE" }),
    ).toMatchObject({ operation: "EDIT" });
    expect(
      planDiscordGameUpdate({ ...common, strategy: "APPEND_EVENTS" }),
    ).toMatchObject({ operation: "APPEND" });
    expect(
      planDiscordGameUpdate({ ...common, strategy: "PERIODIC_SUMMARY" }),
    ).toMatchObject({ operation: "QUEUE_SUMMARY" });
    expect(
      planDiscordGameUpdate({ ...common, strategy: "FINAL_ONLY" }),
    ).toMatchObject({ operation: "WAIT_FOR_FINAL" });
    expect(
      planDiscordGameUpdate({
        ...common,
        strategy: "APPEND_EVENTS",
        trigger: "GAME_CORRECTED",
        snapshot: {
          ...snapshot,
          correctionSummary: "one run was removed after replay",
        },
      }),
    ).toMatchObject({
      operation: "APPEND",
      correctionPresentation: "ANNOTATE_PRIOR",
    });
    expect(
      planDiscordGameUpdate({
        ...common,
        strategy: "FINAL_ONLY",
        trigger: "GAME_CORRECTED",
        hasPublishedMessage: false,
        snapshot: {
          ...snapshot,
          half: "FINAL",
          correctionSummary: "the final score was corrected",
        },
      }),
    ).toMatchObject({ operation: "CREATE" });
    expect(
      planDiscordGameUpdate({
        ...common,
        strategy: "EDIT_LIVE_MESSAGE",
        triggers: ["GAME_CORRECTED"],
      }),
    ).toMatchObject({ operation: "IGNORE", content: null });
  });

  it("keeps every verbosity and synthetic strategy example below its budget", () => {
    for (const format of ["COMPACT", "STANDARD", "DETAILED"] as const) {
      const content = renderDiscordGameUpdate(
        {
          ...snapshot,
          awayTeam: "A".repeat(80),
          homeTeam: "H".repeat(80),
          latestEvent: "L".repeat(300),
          correctionSummary: "C".repeat(160),
        },
        format,
      );
      expect(content.length).toBeLessThanOrEqual(discordMessageBudgets[format]);
      expect(content.length).toBeLessThan(DISCORD_MESSAGE_HARD_LIMIT);
      expect(content).toContain(
        "Prior delivery and scoring history remain retained",
      );

      const previews = representativeDiscordStrategyPreviews(format);
      expect(previews).toHaveLength(4);
      for (const preview of previews) {
        expect(preview.primary.content!.length).toBeLessThanOrEqual(
          discordMessageBudgets[format],
        );
        expect(preview.correction.content).toContain("CORRECTED:");
      }
    }
  });
});
