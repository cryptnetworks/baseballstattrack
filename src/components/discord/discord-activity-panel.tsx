import type {
  DiscordActivityError,
  DiscordActivityWorkspace,
  DiscordDeliveryActivity,
} from "@/domain/discord-activity";

function timestamp(value: Date | null, empty: string) {
  return value ? (
    <time dateTime={value.toISOString()}>
      {value.toISOString().replace("T", " ").replace(".000Z", " UTC")}
    </time>
  ) : (
    empty
  );
}

function lifecycle(status: DiscordActivityWorkspace["installation"]["status"]) {
  return status === "ACTIVE"
    ? "Connected"
    : status === "PENDING"
      ? "Setup incomplete"
      : status === "DISCONNECTED"
        ? "Disconnected"
        : "Revoked";
}

const categoryCopy: Record<DiscordActivityError["category"], string> = {
  CONFIGURATION: "Configuration",
  AUTHORIZATION: "Authorization",
  STALE_STATISTICS: "Stale statistics",
  DISCORD: "Discord delivery",
};

const failureCopy: Readonly<Record<string, string>> = {
  INSTALLATION_INACTIVE:
    "Reconnect the Discord server before delivery can resume.",
  SETTINGS_NOT_CONFIGURED:
    "Complete Discord update settings before enabling delivery.",
  CONFIGURATION_INCOMPLETE:
    "Add a tracked team and routable channel before enabling delivery.",
  SETTINGS_OR_SCOPE_CHANGED:
    "An evaluation was cancelled after its settings or team scope changed.",
  SETTINGS_OR_DESTINATION_CHANGED:
    "A delivery was cancelled after its settings or destination changed.",
  SUPERSEDED_BY_LATEST_STATE:
    "Older pending work was replaced by newer game state.",
  AUTHENTICATION_FAILED: "Discord or statistics API authentication failed.",
  PERMISSION_REQUIRED: "Discord no longer permits the configured delivery.",
  STATISTICS_STALE:
    "The statistics API returned data older than the requested game revision.",
  STATISTICS_UNAVAILABLE:
    "The statistics API could not provide the requested game state.",
  DESTINATION_UNAVAILABLE: "The configured Discord destination is unavailable.",
  RATE_LIMITED:
    "Discord rate-limited the delivery; the worker will use its retry schedule.",
  PROVIDER_UNAVAILABLE: "Discord was unavailable during the delivery attempt.",
  UNKNOWN_FAILURE:
    "An unclassified failure was recorded. Use the correlation ID with safe operational events.",
};

function statusLabel(status: DiscordDeliveryActivity["status"]) {
  return status
    .toLowerCase()
    .split("_")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

export function DiscordActivityPanel({
  activity,
}: {
  activity: DiscordActivityWorkspace;
}) {
  return (
    <div className="mt-6 space-y-6">
      <section aria-labelledby="discord-health-heading">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-semibold" id="discord-health-heading">
            Integration health
          </h3>
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${activity.errors.length ? "bg-amber-100 text-amber-950" : "bg-green-100 text-green-900"}`}
          >
            {activity.errors.length
              ? `${activity.errors.length} current issue${activity.errors.length === 1 ? "" : "s"}`
              : "No current issues"}
          </span>
        </div>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <div className="rounded-lg border border-[var(--line)] bg-slate-50 p-4">
            <dt className="text-sm font-medium text-[var(--muted)]">
              Installation
            </dt>
            <dd className="mt-1 font-semibold">
              {lifecycle(activity.installation.status)}
            </dd>
          </div>
          <div className="rounded-lg border border-[var(--line)] bg-slate-50 p-4">
            <dt className="text-sm font-medium text-[var(--muted)]">
              Delivery
            </dt>
            <dd className="mt-1 font-semibold">
              {activity.deliveryEnabled
                ? "Enabled"
                : "Paused or not configured"}
            </dd>
          </div>
          <div className="rounded-lg border border-[var(--line)] bg-slate-50 p-4">
            <dt className="text-sm font-medium text-[var(--muted)]">
              Last heartbeat
            </dt>
            <dd className="mt-1 font-semibold">
              {timestamp(
                activity.lastHeartbeatAt,
                "No worker activity recorded",
              )}
            </dd>
          </div>
          <div className="rounded-lg border border-[var(--line)] bg-slate-50 p-4">
            <dt className="text-sm font-medium text-[var(--muted)]">
              Last statistics API read
            </dt>
            <dd className="mt-1 font-semibold">
              {timestamp(activity.lastApiReadAt, "No API read recorded")}
            </dd>
          </div>
          <div className="rounded-lg border border-[var(--line)] bg-slate-50 p-4">
            <dt className="text-sm font-medium text-[var(--muted)]">
              Last delivery
            </dt>
            <dd className="mt-1 font-semibold">
              {timestamp(activity.lastDeliveryAt, "No successful delivery")}
            </dd>
          </div>
          <div className="rounded-lg border border-[var(--line)] bg-slate-50 p-4">
            <dt className="text-sm font-medium text-[var(--muted)]">
              Next scheduled update
            </dt>
            <dd className="mt-1 font-semibold">
              {timestamp(
                activity.nextScheduledUpdateAt,
                activity.deliveryEnabled
                  ? "Waiting for an event"
                  : "None scheduled",
              )}
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="discord-current-errors-heading">
        <h3
          className="text-lg font-semibold"
          id="discord-current-errors-heading"
        >
          Current errors
        </h3>
        {activity.errors.length ? (
          <ul className="mt-3 space-y-3">
            {activity.errors.map((error) => (
              <li
                className="rounded-lg border border-amber-300 bg-amber-50 p-4"
                key={`${error.category}:${error.code}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">
                    {categoryCopy[error.category]}
                  </p>
                  <code className="text-xs">{error.code}</code>
                </div>
                <p className="mt-1 text-sm text-amber-950">
                  {failureCopy[error.code] ??
                    "Review the correlated delivery and operational event before retrying."}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p
            className="mt-3 rounded-lg border border-green-300 bg-green-50 p-4 text-sm text-green-900"
            role="status"
          >
            No unresolved configuration, authorization, statistics, or Discord
            delivery errors.
          </p>
        )}
      </section>

      <section aria-labelledby="discord-delivery-history-heading">
        <h3
          className="text-lg font-semibold"
          id="discord-delivery-history-heading"
        >
          Recent delivery history
        </h3>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Newest 25 deliveries. Correlation IDs can be matched to safe
          operational events; message content and provider identifiers are
          excluded.
        </p>
        {activity.deliveries.length ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[44rem] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--line)]">
                  <th className="px-2 py-3 font-semibold" scope="col">
                    Scheduled
                  </th>
                  <th className="px-2 py-3 font-semibold" scope="col">
                    Operation
                  </th>
                  <th className="px-2 py-3 font-semibold" scope="col">
                    Status
                  </th>
                  <th className="px-2 py-3 font-semibold" scope="col">
                    Attempts
                  </th>
                  <th className="px-2 py-3 font-semibold" scope="col">
                    Correlation ID
                  </th>
                </tr>
              </thead>
              <tbody>
                {activity.deliveries.map((delivery) => (
                  <tr
                    className="border-b border-[var(--line)] align-top"
                    key={delivery.correlationId}
                  >
                    <td className="px-2 py-3">
                      {timestamp(delivery.scheduledAt, "Unknown")}
                    </td>
                    <td className="px-2 py-3">{delivery.operation}</td>
                    <td className="px-2 py-3">
                      {statusLabel(delivery.status)}
                      {delivery.failureCode ? (
                        <>
                          <br />
                          <code className="text-xs">
                            {delivery.failureCode}
                          </code>
                        </>
                      ) : null}
                    </td>
                    <td className="px-2 py-3">{delivery.attemptCount}</td>
                    <td className="px-2 py-3 font-mono text-xs">
                      {delivery.correlationId}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-3 rounded-lg border border-dashed border-[var(--line)] p-4 text-sm text-[var(--muted)]">
            No Discord deliveries have been scheduled for this server.
          </p>
        )}
      </section>
    </div>
  );
}
