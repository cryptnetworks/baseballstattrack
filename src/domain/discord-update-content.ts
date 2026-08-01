import { z } from "zod";

import {
  discordContentPolicyErrors,
  discordMessageFormats,
  discordMessageStrategies,
  discordUpdateTriggers,
  type DiscordMessageFormat,
  type DiscordMessageStrategy,
  type DiscordUpdateTrigger,
} from "@/domain/discord-settings";

export const DISCORD_MESSAGE_HARD_LIMIT = 2_000;
export const discordMessageBudgets = Object.freeze({
  COMPACT: 280,
  STANDARD: 1_000,
  DETAILED: 1_800,
} satisfies Readonly<Record<DiscordMessageFormat, number>>);

export const discordUpdateTriggerDefinitions = [
  {
    id: "GAME_SCHEDULED",
    label: "Game scheduled",
    description: "Schedule or start-time changes.",
  },
  {
    id: "GAME_STARTED",
    label: "Game started",
    description: "The first accepted live-game state.",
  },
  {
    id: "SCORE_CHANGED",
    label: "Score changed",
    description: "Any accepted change to the score.",
  },
  {
    id: "LEAD_CHANGED",
    label: "Lead changed",
    description: "The leader changes or the game becomes tied.",
  },
  {
    id: "SCORING_PLAY",
    label: "Scoring play",
    description: "A play produces one or more accepted runs.",
  },
  {
    id: "INNING_ENDED",
    label: "Inning changed",
    description: "A half-inning ends and the game advances.",
  },
  {
    id: "PITCHING_CHANGED",
    label: "Pitching change",
    description: "A new pitcher enters the accepted lineup state.",
  },
  {
    id: "GAME_COMPLETED",
    label: "Game final",
    description: "The game reaches a completed state.",
  },
  {
    id: "GAME_VERIFIED",
    label: "Game verified",
    description: "An authorized scorekeeper verifies the final result.",
  },
  {
    id: "GAME_CORRECTED",
    label: "Correction accepted",
    description:
      "Required safety update after append-only correction replay changes published state.",
    required: true,
  },
  {
    id: "REPORT_READY",
    label: "Report ready",
    description: "A current report becomes available through the read API.",
  },
  {
    id: "OPERATIONAL_FAILURE",
    label: "Operational failure",
    description: "A safe operator-facing delivery or freshness failure.",
  },
] as const satisfies readonly Readonly<{
  id: DiscordUpdateTrigger;
  label: string;
  description: string;
  required?: boolean;
}>[];

export const discordMessageStrategyDefinitions = [
  {
    id: "EDIT_LIVE_MESSAGE",
    label: "Edit one live message",
    description:
      "Create one game message, then edit its current presentation as accepted state changes.",
  },
  {
    id: "APPEND_EVENTS",
    label: "Append events",
    description:
      "Publish a bounded new entry for each selected trigger and annotate corrections.",
  },
  {
    id: "PERIODIC_SUMMARY",
    label: "Periodic summary",
    description:
      "Mark current state for the next eligible scheduled summary instead of sending every event.",
  },
  {
    id: "FINAL_ONLY",
    label: "Final only",
    description:
      "Hold live changes and publish only final, verified, report-ready, or necessary correction state.",
  },
] as const satisfies readonly Readonly<{
  id: DiscordMessageStrategy;
  label: string;
  description: string;
}>[];

const id = z.string().trim().min(1).max(128);

export const discordUpdateContentSchema = z
  .object({
    accountId: id,
    installationId: z.uuid(),
    expectedRevision: z.number().int().min(0),
    triggers: z
      .array(z.enum(discordUpdateTriggers))
      .min(1)
      .max(discordUpdateTriggers.length),
    messageStrategy: z.enum(discordMessageStrategies),
    messageFormat: z.enum(discordMessageFormats),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.triggers).size !== value.triggers.length) {
      context.addIssue({
        code: "custom",
        path: ["triggers"],
        message: "Discord update triggers must be unique.",
      });
    }
    for (const issue of discordContentPolicyErrors(value)) {
      context.addIssue({
        code: "custom",
        path: issue.path,
        message: issue.message,
      });
    }
  });

export const discordGameUpdateSnapshotSchema = z
  .object({
    awayTeam: z.string().trim().min(1).max(80),
    homeTeam: z.string().trim().min(1).max(80),
    awayScore: z.number().int().min(0).max(999),
    homeScore: z.number().int().min(0).max(999),
    inning: z.number().int().min(1).max(99),
    half: z.enum(["TOP", "BOTTOM", "MIDDLE", "FINAL"]),
    latestEvent: z.string().trim().min(1).max(300),
    correctionSummary: z.string().trim().min(1).max(160).nullable(),
    reportReady: z.boolean(),
    verified: z.boolean(),
  })
  .strict();

export type DiscordGameUpdateSnapshot = z.infer<
  typeof discordGameUpdateSnapshotSchema
>;

export type DiscordContentOperation =
  "IGNORE" | "CREATE" | "EDIT" | "APPEND" | "QUEUE_SUMMARY" | "WAIT_FOR_FINAL";

export type DiscordContentPlan = Readonly<{
  operation: DiscordContentOperation;
  content: string | null;
  reason:
    | "TRIGGER_NOT_SELECTED"
    | "MATCHED_TRIGGER"
    | "PERIODIC_SUMMARY"
    | "FINAL_NOT_REACHED";
  correctionPresentation: "NONE" | "REPLACE_CURRENT" | "ANNOTATE_PRIOR";
}>;

const terminalTriggers = new Set<DiscordUpdateTrigger>([
  "GAME_COMPLETED",
  "GAME_VERIFIED",
  "REPORT_READY",
]);

function halfLabel(snapshot: DiscordGameUpdateSnapshot) {
  if (snapshot.half === "FINAL") return "Final";
  const half =
    snapshot.half === "TOP"
      ? "Top"
      : snapshot.half === "BOTTOM"
        ? "Bottom"
        : "Middle";
  return `${half} ${snapshot.inning}`;
}

function truncate(value: string, limit: number) {
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function fitMessage(base: string, correction: string, budget: number) {
  if (!correction) return truncate(base, budget);
  const separator = "\n";
  const safeCorrection = truncate(
    correction,
    Math.min(correction.length, budget),
  );
  const baseBudget = Math.max(
    0,
    budget - separator.length - safeCorrection.length,
  );
  return `${truncate(base, baseBudget)}${separator}${safeCorrection}`.slice(
    0,
    budget,
  );
}

export function renderDiscordGameUpdate(
  snapshotInput: DiscordGameUpdateSnapshot,
  format: DiscordMessageFormat,
) {
  const snapshot = discordGameUpdateSnapshotSchema.parse(snapshotInput);
  const score = `${snapshot.awayTeam} ${snapshot.awayScore} — ${snapshot.homeTeam} ${snapshot.homeScore}`;
  const status = [
    halfLabel(snapshot),
    snapshot.verified ? "Verified" : null,
    snapshot.reportReady ? "Report ready" : null,
  ]
    .filter(Boolean)
    .join(" • ");
  const base =
    format === "COMPACT"
      ? `${score} • ${status}`
      : format === "STANDARD"
        ? `⚾ ${score}\n${status}\n${snapshot.latestEvent}`
        : `⚾ Game update\n${score}\nStatus: ${status}\nLatest accepted event: ${snapshot.latestEvent}\nSource: current Baseball Stat Track read model`;
  const correction = snapshot.correctionSummary
    ? `CORRECTED: ${snapshot.correctionSummary}. Prior delivery and scoring history remain retained.`
    : "";
  const content = fitMessage(base, correction, discordMessageBudgets[format]);
  if (content.length > DISCORD_MESSAGE_HARD_LIMIT) {
    throw new Error("Discord message exceeded the hard payload limit.");
  }
  return content;
}

export function planDiscordGameUpdate(input: {
  strategy: DiscordMessageStrategy;
  format: DiscordMessageFormat;
  triggers: readonly DiscordUpdateTrigger[];
  trigger: DiscordUpdateTrigger;
  snapshot: DiscordGameUpdateSnapshot;
  hasPublishedMessage: boolean;
}): DiscordContentPlan {
  if (!input.triggers.includes(input.trigger)) {
    return {
      operation: "IGNORE",
      content: null,
      reason: "TRIGGER_NOT_SELECTED",
      correctionPresentation: "NONE",
    };
  }
  const correction = input.trigger === "GAME_CORRECTED";
  const content = renderDiscordGameUpdate(input.snapshot, input.format);
  const snapshotIsTerminal =
    input.snapshot.half === "FINAL" ||
    input.snapshot.verified ||
    input.snapshot.reportReady;
  if (
    input.strategy === "FINAL_ONLY" &&
    !terminalTriggers.has(input.trigger) &&
    !(correction && (input.hasPublishedMessage || snapshotIsTerminal))
  ) {
    return {
      operation: "WAIT_FOR_FINAL",
      content,
      reason: "FINAL_NOT_REACHED",
      correctionPresentation: correction ? "ANNOTATE_PRIOR" : "NONE",
    };
  }
  if (input.strategy === "PERIODIC_SUMMARY") {
    return {
      operation: "QUEUE_SUMMARY",
      content,
      reason: "PERIODIC_SUMMARY",
      correctionPresentation: correction ? "ANNOTATE_PRIOR" : "NONE",
    };
  }
  if (correction) {
    return {
      operation:
        input.strategy === "EDIT_LIVE_MESSAGE" && input.hasPublishedMessage
          ? "EDIT"
          : input.hasPublishedMessage
            ? "APPEND"
            : "CREATE",
      content,
      reason: "MATCHED_TRIGGER",
      correctionPresentation:
        input.strategy === "EDIT_LIVE_MESSAGE" && input.hasPublishedMessage
          ? "REPLACE_CURRENT"
          : "ANNOTATE_PRIOR",
    };
  }
  return {
    operation:
      input.strategy === "EDIT_LIVE_MESSAGE" && input.hasPublishedMessage
        ? "EDIT"
        : input.strategy === "APPEND_EVENTS" && input.hasPublishedMessage
          ? "APPEND"
          : input.strategy === "FINAL_ONLY" && input.hasPublishedMessage
            ? "EDIT"
            : "CREATE",
    content,
    reason: "MATCHED_TRIGGER",
    correctionPresentation: "NONE",
  };
}

const previewLive = Object.freeze({
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
});

const previewCorrection = Object.freeze({
  ...previewLive,
  awayScore: 3,
  correctionSummary: "the prior scoring play was corrected to one run",
});

const previewFinal = Object.freeze({
  ...previewLive,
  awayScore: 5,
  homeScore: 4,
  half: "FINAL" as const,
  latestEvent: "Final score accepted.",
  reportReady: true,
  verified: true,
});

export function representativeDiscordStrategyPreviews(
  format: DiscordMessageFormat,
) {
  const triggers = discordUpdateTriggers;
  return discordMessageStrategyDefinitions.map((definition) => {
    const strategy = definition.id;
    const primary = planDiscordGameUpdate({
      strategy,
      format,
      triggers,
      trigger: strategy === "FINAL_ONLY" ? "GAME_COMPLETED" : "SCORING_PLAY",
      snapshot: strategy === "FINAL_ONLY" ? previewFinal : previewLive,
      hasPublishedMessage: strategy !== "FINAL_ONLY",
    });
    const correction = planDiscordGameUpdate({
      strategy,
      format,
      triggers,
      trigger: "GAME_CORRECTED",
      snapshot: previewCorrection,
      hasPublishedMessage: true,
    });
    return { ...definition, primary, correction };
  });
}
