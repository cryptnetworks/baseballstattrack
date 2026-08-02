import {
  discordConfigurationCompatibilityErrors,
  discordContentPolicyErrors,
  discordDestinationPurposeForTrigger,
  discordMessageFormats,
  discordMessageStrategies,
  discordUpdateTriggers,
  type DiscordDestinationPurpose,
  type DiscordMessageFormat,
  type DiscordMessageStrategy,
  type DiscordUpdateTrigger,
} from "@/domain/discord-settings";
import {
  DISCORD_MESSAGE_HARD_LIMIT,
  planDiscordGameUpdate,
  type DiscordGameUpdateSnapshot,
} from "@/domain/discord-update-content";
import { discordCadenceModes } from "@/domain/discord-update-schedule";

export type DiscordConfigurationCheck = Readonly<{
  id: "CHANNELS" | "TEAMS" | "SCHEDULE" | "TRIGGERS" | "FORMAT";
  label: string;
  section: "channels" | "teams" | "updates";
  status: "PASS" | "WARNING" | "ERROR";
  messages: readonly string[];
}>;

export type DiscordConfigurationPreviewInput = Readonly<{
  installationStatus: string;
  permissionEvidenceStale: boolean;
  missingPermissions: Readonly<{
    viewChannel: number;
    sendMessages: number;
  }>;
  settings: Readonly<{
    enabled: boolean;
    trackedScopes: readonly unknown[];
    destinations: readonly Readonly<{
      available: boolean;
      purposes: readonly string[];
    }>[];
    cadenceMode: string;
    gameDayWindow: Readonly<{
      enabled: boolean;
      startMinute: number;
      endMinute: number;
    }>;
    digest: Readonly<{ enabled: boolean }>;
    triggers: readonly string[];
    messageStrategy: string;
    messageFormat: string;
    quietHours: Readonly<{
      enabled: boolean;
      startMinute: number;
      endMinute: number;
    }>;
  }>;
}>;

const liveSnapshot = Object.freeze({
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

const finalSnapshot = Object.freeze({
  ...liveSnapshot,
  awayScore: 5,
  homeScore: 4,
  half: "FINAL" as const,
  latestEvent: "Final score accepted.",
  reportReady: true,
  verified: true,
});

const correctionSnapshot = Object.freeze({
  ...finalSnapshot,
  awayScore: 4,
  correctionSummary: "the accepted final score changed after replay",
});

function check(
  id: DiscordConfigurationCheck["id"],
  label: string,
  section: DiscordConfigurationCheck["section"],
  errors: readonly string[],
  success: string,
  warnings: readonly string[] = [],
): DiscordConfigurationCheck {
  return {
    id,
    label,
    section,
    status: errors.length ? "ERROR" : warnings.length ? "WARNING" : "PASS",
    messages: errors.length ? errors : warnings.length ? warnings : [success],
  };
}

function supported<T extends string>(values: readonly T[], value: string) {
  return values.includes(value as T);
}

export function validateDiscordConfiguration(
  input: DiscordConfigurationPreviewInput,
) {
  const channelErrors: string[] = [];
  const channelWarnings: string[] = [];
  if (input.installationStatus !== "ACTIVE") {
    channelErrors.push("Reconnect this Discord server before delivery.");
  }
  if (!input.settings.destinations.length) {
    channelErrors.push("Choose at least one managed Discord destination.");
  }
  const unavailable = input.settings.destinations.filter(
    ({ available }) => !available,
  ).length;
  if (unavailable) {
    channelErrors.push(
      `${unavailable} selected destination${unavailable === 1 ? " is" : "s are"} missing View Channel or Send Messages permission.`,
    );
  }
  if (input.missingPermissions.viewChannel) {
    channelWarnings.push(
      `${input.missingPermissions.viewChannel} discovered channel${input.missingPermissions.viewChannel === 1 ? " is" : "s are"} missing View Channel permission.`,
    );
  }
  if (input.missingPermissions.sendMessages) {
    channelWarnings.push(
      `${input.missingPermissions.sendMessages} discovered channel${input.missingPermissions.sendMessages === 1 ? " is" : "s are"} missing Send Messages permission.`,
    );
  }
  if (input.permissionEvidenceStale) {
    channelWarnings.push(
      "Bot permission evidence is missing or older than five minutes; refresh channels before saving.",
    );
  }

  const teamErrors = input.settings.trackedScopes.length
    ? []
    : ["Choose at least one available team-season."];

  const scheduleErrors: string[] = [];
  if (!supported(discordCadenceModes, input.settings.cadenceMode)) {
    scheduleErrors.push("The saved cadence mode is unsupported.");
  }
  scheduleErrors.push(
    ...discordConfigurationCompatibilityErrors({
      enabled: false,
      destinations: [],
      triggers: [],
      digest: input.settings.digest,
      cadenceMode: input.settings.cadenceMode,
      messageStrategy: input.settings.messageStrategy,
      gameDayWindow: input.settings.gameDayWindow,
      quietHours: input.settings.quietHours,
    }).map(({ message }) => message),
  );

  const triggerErrors: string[] = [];
  const parsedTriggers = input.settings.triggers.filter((trigger) =>
    supported(discordUpdateTriggers, trigger),
  ) as DiscordUpdateTrigger[];
  if (
    parsedTriggers.length !== input.settings.triggers.length ||
    !parsedTriggers.length
  ) {
    triggerErrors.push("One or more saved update triggers are unsupported.");
  }
  if (!supported(discordMessageStrategies, input.settings.messageStrategy)) {
    triggerErrors.push("The saved message strategy is unsupported.");
  } else {
    triggerErrors.push(
      ...discordContentPolicyErrors({
        messageStrategy: input.settings
          .messageStrategy as DiscordMessageStrategy,
        triggers: parsedTriggers,
      }).map(({ message }) => message),
    );
  }
  const requiredPurposes = new Set<DiscordDestinationPurpose>(
    parsedTriggers.map(discordDestinationPurposeForTrigger),
  );
  if (input.settings.digest.enabled) requiredPurposes.add("DIGESTS");
  const routedPurposes = new Set(
    input.settings.destinations
      .filter(({ available }) => available)
      .flatMap(({ purposes }) => purposes),
  );
  for (const purpose of requiredPurposes) {
    if (!routedPurposes.has(purpose)) {
      triggerErrors.push(
        `No permission-verified route is configured for ${purpose.toLowerCase().replaceAll("_", " ")}.`,
      );
    }
  }

  const formatErrors = supported(
    discordMessageFormats,
    input.settings.messageFormat,
  )
    ? []
    : ["The saved message format is unsupported."];

  const checks = [
    check(
      "CHANNELS",
      "Channels and bot permissions",
      "channels",
      channelErrors,
      "Every selected destination has current View Channel and Send Messages permission.",
      channelWarnings,
    ),
    check(
      "TEAMS",
      "Tracked teams",
      "teams",
      teamErrors,
      "At least one available team-season is selected.",
    ),
    check(
      "SCHEDULE",
      "Schedule",
      "updates",
      scheduleErrors,
      "The cadence and delivery windows have an eligible execution path.",
    ),
    check(
      "TRIGGERS",
      "Triggers and routing",
      "updates",
      triggerErrors,
      "Every selected trigger has a supported strategy and permission-verified route.",
    ),
    check(
      "FORMAT",
      "Message format",
      "updates",
      formatErrors,
      "The selected format is supported and bounded below Discord's hard limit.",
    ),
  ] as const;
  return {
    ready: checks.every(({ status }) => status !== "ERROR"),
    checks,
    errorCount: checks.filter(({ status }) => status === "ERROR").length,
    warningCount: checks.filter(({ status }) => status === "WARNING").length,
  };
}

function previewMessage(content: string) {
  const marked = `[PREVIEW — SYNTHETIC DATA — NOT A LIVE UPDATE]\n${content}`;
  return marked.slice(0, DISCORD_MESSAGE_HARD_LIMIT);
}

export function representativeDiscordConfigurationPreviews(input: {
  messageFormat: DiscordMessageFormat;
  messageStrategy: DiscordMessageStrategy;
  triggers: readonly DiscordUpdateTrigger[];
}) {
  const plans: readonly Readonly<{
    id: "LIVE" | "FINAL" | "CORRECTION";
    label: string;
    trigger: DiscordUpdateTrigger;
    snapshot: DiscordGameUpdateSnapshot;
    hasPublishedMessage: boolean;
  }>[] = [
    {
      id: "LIVE",
      label: "Live update",
      trigger: "SCORING_PLAY",
      snapshot: liveSnapshot,
      hasPublishedMessage: true,
    },
    {
      id: "FINAL",
      label: "Final score",
      trigger: "GAME_COMPLETED",
      snapshot: finalSnapshot,
      hasPublishedMessage: true,
    },
    {
      id: "CORRECTION",
      label: "Correction",
      trigger: "GAME_CORRECTED",
      snapshot: correctionSnapshot,
      hasPublishedMessage: true,
    },
  ];
  const previews = plans.map((preview) => {
    const plan = planDiscordGameUpdate({
      strategy: input.messageStrategy,
      format: input.messageFormat,
      triggers: input.triggers,
      trigger: preview.trigger,
      snapshot: preview.snapshot,
      hasPublishedMessage: preview.hasPublishedMessage,
    });
    return {
      id: preview.id,
      label: preview.label,
      operation: plan.operation,
      content: previewMessage(
        plan.content ??
          "This trigger is not selected; no message would be sent.",
      ),
    };
  });
  return [
    ...previews,
    {
      id: "ERROR" as const,
      label: "Operational error",
      operation: "CREATE" as const,
      content: previewMessage(
        "⚠ Discord delivery needs attention\nA permission-verified route became unavailable. Live game data is not included in operational errors.",
      ),
    },
  ];
}
