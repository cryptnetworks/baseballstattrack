export const DISCORD_ACTIVITY_HISTORY_LIMIT = 25;

export type DiscordActivityErrorCategory =
  "CONFIGURATION" | "AUTHORIZATION" | "STALE_STATISTICS" | "DISCORD";

export type DiscordActivityWorkStatus =
  "PENDING" | "PROCESSING" | "SUCCEEDED" | "DEAD_LETTER" | "CANCELLED";

export type DiscordActivityError = Readonly<{
  category: DiscordActivityErrorCategory;
  code: string;
  occurredAt: Date;
}>;

export type DiscordDeliveryActivity = Readonly<{
  correlationId: string;
  operation: "CREATE" | "EDIT" | "APPEND";
  status: DiscordActivityWorkStatus;
  attemptCount: number;
  failureCode: string | null;
  scheduledAt: Date;
  deliveredAt: Date | null;
  updatedAt: Date;
}>;

export type DiscordActivityWorkspace = Readonly<{
  installation: Readonly<{
    id: string;
    status: "PENDING" | "ACTIVE" | "DISCONNECTED" | "REVOKED";
    installedAt: Date | null;
  }>;
  deliveryEnabled: boolean;
  lastHeartbeatAt: Date | null;
  lastApiReadAt: Date | null;
  lastDeliveryAt: Date | null;
  nextScheduledUpdateAt: Date | null;
  errors: readonly DiscordActivityError[];
  deliveries: readonly DiscordDeliveryActivity[];
}>;

type WorkFailure = Readonly<{
  code: string;
  updatedAt: Date;
}>;

type ActivityInput = Readonly<{
  installation: DiscordActivityWorkspace["installation"];
  installationUpdatedAt: Date;
  settings: Readonly<{
    enabled: boolean;
    nextScheduledEvaluationAt: Date | null;
    trackedScopeCount: number;
    destinationCount: number;
  }> | null;
  lastHeartbeatAt: Date | null;
  lastApiReadAt: Date | null;
  lastDeliveryAt: Date | null;
  failures: readonly WorkFailure[];
  deliveries: readonly DiscordDeliveryActivity[];
}>;

const authorizationFailures = new Set([
  "AUTHENTICATION_FAILED",
  "PERMISSION_REQUIRED",
]);
const staleStatisticsFailures = new Set([
  "STATISTICS_STALE",
  "STATISTICS_UNAVAILABLE",
]);
const configurationFailures = new Set([
  "SETTINGS_OR_SCOPE_CHANGED",
  "SETTINGS_OR_DESTINATION_CHANGED",
  "SUPERSEDED_BY_LATEST_STATE",
]);
const discordFailures = new Set([
  "DESTINATION_UNAVAILABLE",
  "RATE_LIMITED",
  "PROVIDER_UNAVAILABLE",
]);

export function safeDiscordActivityFailureCode(code: string): string {
  return authorizationFailures.has(code) ||
    staleStatisticsFailures.has(code) ||
    configurationFailures.has(code) ||
    discordFailures.has(code)
    ? code
    : "UNKNOWN_FAILURE";
}

function failureCategory(code: string): DiscordActivityErrorCategory {
  if (authorizationFailures.has(code)) return "AUTHORIZATION";
  if (staleStatisticsFailures.has(code)) return "STALE_STATISTICS";
  if (configurationFailures.has(code)) return "CONFIGURATION";
  return "DISCORD";
}

export function buildDiscordActivity(
  input: ActivityInput,
): DiscordActivityWorkspace {
  const configurationErrors: DiscordActivityError[] = [];
  if (input.installation.status !== "ACTIVE") {
    configurationErrors.push({
      category: "CONFIGURATION",
      code: "INSTALLATION_INACTIVE",
      occurredAt: input.installationUpdatedAt,
    });
  } else if (!input.settings) {
    configurationErrors.push({
      category: "CONFIGURATION",
      code: "SETTINGS_NOT_CONFIGURED",
      occurredAt: input.installationUpdatedAt,
    });
  } else if (
    input.settings.enabled &&
    (input.settings.trackedScopeCount === 0 ||
      input.settings.destinationCount === 0)
  ) {
    configurationErrors.push({
      category: "CONFIGURATION",
      code: "CONFIGURATION_INCOMPLETE",
      occurredAt: input.installationUpdatedAt,
    });
  }

  const workErrors = input.failures.map((failure) => {
    const code = safeDiscordActivityFailureCode(failure.code);
    return {
      category: failureCategory(code),
      code,
      occurredAt: failure.updatedAt,
    };
  });
  const errors = [...configurationErrors, ...workErrors]
    .sort(
      (left, right) => right.occurredAt.getTime() - left.occurredAt.getTime(),
    )
    .filter(
      (error, index, all) =>
        all.findIndex(
          (candidate) =>
            candidate.category === error.category &&
            candidate.code === error.code,
        ) === index,
    );

  return {
    installation: input.installation,
    deliveryEnabled: input.settings?.enabled ?? false,
    lastHeartbeatAt: input.lastHeartbeatAt,
    lastApiReadAt: input.lastApiReadAt,
    lastDeliveryAt: input.lastDeliveryAt,
    nextScheduledUpdateAt: input.settings?.nextScheduledEvaluationAt ?? null,
    errors,
    deliveries: input.deliveries.slice(0, DISCORD_ACTIVITY_HISTORY_LIMIT),
  };
}
