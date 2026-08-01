import {
  refreshDiscordChannels,
  saveDiscordChannelRouting,
  testDiscordChannelDelivery,
  toggleDiscordChannel,
} from "@/app/discord/channel-actions";
import { discordRoutingCategories } from "@/domain/discord-channel-routing";
import { discordMessageFormats } from "@/domain/discord-settings";
import { DiscordSettingsFeedback } from "@/components/discord/discord-settings-feedback";

type Channel = Readonly<{
  id: string;
  displayName: string;
  enabled: boolean;
  lastVerifiedAt: Date | null;
}>;

const errorCopy: Readonly<Record<string, string>> = {
  validation: "Review the selected routing values and try again.",
  conflict: "Settings changed in another session. Reload and save again.",
  permissions:
    "Discord no longer grants the permissions required for that channel.",
  "rate-limited": "Too many administration requests. Wait and try again.",
  provider:
    "Discord is temporarily unavailable. Existing routing is unchanged.",
  inactive: "Reconnect this Discord server before changing channel routing.",
  unavailable: "That Discord channel or server is unavailable.",
};

const noticeCopy: Readonly<Record<string, string>> = {
  refreshed: "Discord channel permissions refreshed.",
  saved: "Channel routing saved and available to workers immediately.",
  tested: "Test delivery sent successfully.",
  enabled: "Discord channel enabled.",
  disabled: "Discord channel disabled and its routes removed.",
};

export function DiscordChannelRoutingPanel({
  accountId,
  installationId,
  channels,
  missingPermissions,
  lastVerifiedAt,
  permissionEvidenceStale,
  revision,
  destinations,
  messageFormat,
  notice,
  error,
}: {
  accountId: string;
  installationId: string;
  channels: readonly Channel[];
  missingPermissions: Readonly<{
    viewChannel: number;
    sendMessages: number;
  }>;
  lastVerifiedAt: Date | null;
  permissionEvidenceStale: boolean;
  revision: number;
  destinations: readonly Readonly<{
    destinationId: string;
    purposes: readonly string[];
  }>[];
  messageFormat: (typeof discordMessageFormats)[number];
  notice?: string;
  error?: string;
}) {
  const enabledChannels = channels.filter(({ enabled }) => enabled);
  const selectedByPurpose = new Map<string, string>();
  for (const destination of destinations) {
    for (const purpose of destination.purposes) {
      selectedByPurpose.set(purpose, destination.destinationId);
    }
  }
  return (
    <div className="mt-6 space-y-6">
      {error ? (
        <DiscordSettingsFeedback
          errors={[{ message: errorCopy[error] ?? errorCopy.unavailable! }]}
          state="failure"
        />
      ) : null}
      {notice ? (
        <p
          aria-live="polite"
          className="rounded-lg border border-green-300 bg-green-50 p-4 text-sm font-medium text-green-900"
          role="status"
        >
          {noticeCopy[notice] ?? "Discord settings updated."}
        </p>
      ) : null}

      <section aria-labelledby="discord-channel-access-heading">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3
              className="text-lg font-semibold"
              id="discord-channel-access-heading"
            >
              Available channels
            </h3>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Only text channels with current View Channel and Send Messages
              permission can receive routing.
            </p>
          </div>
          <form action={refreshDiscordChannels}>
            <input name="accountId" type="hidden" value={accountId} />
            <input name="installationId" type="hidden" value={installationId} />
            <button
              className="min-h-11 rounded-lg border border-[var(--line)] px-4 text-sm font-semibold"
              type="submit"
            >
              Refresh permissions
            </button>
          </form>
        </div>
        <p className="mt-2 text-xs text-[var(--muted)]">
          {lastVerifiedAt
            ? `Last verified ${lastVerifiedAt.toISOString()}`
            : "Permissions have not been verified yet."}
        </p>
        {permissionEvidenceStale ? (
          <p
            className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
            role="status"
          >
            Permission evidence is missing or older than five minutes. Refresh
            before saving; every save also revalidates with Discord.
          </p>
        ) : null}
        {missingPermissions.viewChannel || missingPermissions.sendMessages ? (
          <div
            className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
            role="alert"
          >
            <p className="font-semibold">Some channels cannot be routed</p>
            <ul className="mt-1 list-disc pl-5">
              {missingPermissions.viewChannel ? (
                <li>
                  {missingPermissions.viewChannel} missing View Channel
                  permission
                </li>
              ) : null}
              {missingPermissions.sendMessages ? (
                <li>
                  {missingPermissions.sendMessages} missing Send Messages
                  permission
                </li>
              ) : null}
            </ul>
          </div>
        ) : null}
        {channels.length ? (
          <ul className="mt-4 divide-y divide-[var(--line)] rounded-lg border border-[var(--line)]">
            {channels.map((channel) => (
              <li
                className="flex flex-wrap items-center justify-between gap-3 p-3"
                key={channel.id}
              >
                <div>
                  <p className="font-medium">#{channel.displayName}</p>
                  <p className="text-xs text-[var(--muted)]">
                    {channel.enabled ? "Enabled" : "Disabled"}
                  </p>
                </div>
                <form action={toggleDiscordChannel}>
                  <input name="accountId" type="hidden" value={accountId} />
                  <input
                    name="installationId"
                    type="hidden"
                    value={installationId}
                  />
                  <input
                    name="destinationId"
                    type="hidden"
                    value={channel.id}
                  />
                  <input
                    name="enabled"
                    type="hidden"
                    value={channel.enabled ? "false" : "true"}
                  />
                  <button
                    className="min-h-11 rounded-lg border border-[var(--line)] px-4 text-sm font-semibold"
                    type="submit"
                  >
                    {channel.enabled ? "Disable" : "Enable"}
                    <span className="sr-only"> #{channel.displayName}</span>
                  </button>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 rounded-lg border border-dashed border-[var(--line)] p-4 text-sm text-[var(--muted)]">
            No accessible text channels are cached. Refresh permissions after
            granting the bot View Channel and Send Messages.
          </p>
        )}
      </section>

      <form action={saveDiscordChannelRouting}>
        <input name="accountId" type="hidden" value={accountId} />
        <input name="installationId" type="hidden" value={installationId} />
        <input name="expectedRevision" type="hidden" value={revision} />
        <fieldset className="space-y-4">
          <legend className="text-lg font-semibold">Report destinations</legend>
          <p className="text-sm text-[var(--muted)]">
            Choose one channel per output category, or disable that category.
          </p>
          {discordRoutingCategories.map((category) => (
            <div
              className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(14rem,1fr)] sm:items-center"
              key={category.id}
            >
              <label htmlFor={`route-${category.id}`}>
                <span className="block font-medium">{category.label}</span>
                <span className="block text-xs text-[var(--muted)]">
                  {category.description}
                </span>
              </label>
              <select
                className="min-h-11 rounded-lg border border-[var(--line)] bg-white px-3"
                defaultValue={selectedByPurpose.get(category.id) ?? ""}
                id={`route-${category.id}`}
                name={`route-${category.id}`}
              >
                <option value="">Disabled</option>
                {enabledChannels.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    #{channel.displayName}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </fieldset>
        <button
          className="mt-5 min-h-11 rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-white disabled:bg-slate-400"
          disabled={enabledChannels.length === 0}
          type="submit"
        >
          Save channel routing
        </button>
      </form>

      <form
        action={testDiscordChannelDelivery}
        className="rounded-lg border border-[var(--line)] p-4"
      >
        <input name="accountId" type="hidden" value={accountId} />
        <input name="installationId" type="hidden" value={installationId} />
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="col-span-full text-lg font-semibold">
            Test delivery
          </legend>
          <div>
            <label className="block text-sm font-medium" htmlFor="test-channel">
              Discord channel
            </label>
            <select
              className="mt-2 min-h-11 w-full rounded-lg border border-[var(--line)] bg-white px-3"
              disabled={enabledChannels.length === 0}
              id="test-channel"
              name="destinationId"
              required
            >
              {enabledChannels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  #{channel.displayName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium" htmlFor="test-format">
              Message format
            </label>
            <select
              className="mt-2 min-h-11 w-full rounded-lg border border-[var(--line)] bg-white px-3"
              defaultValue={messageFormat}
              id="test-format"
              name="messageFormat"
            >
              {discordMessageFormats.map((format) => (
                <option key={format} value={format}>
                  {format.charAt(0) + format.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
          </div>
        </fieldset>
        <button
          className="mt-4 min-h-11 rounded-lg border border-[var(--line)] px-4 text-sm font-semibold disabled:text-slate-400"
          disabled={enabledChannels.length === 0}
          type="submit"
        >
          Send test delivery
        </button>
      </form>
    </div>
  );
}
