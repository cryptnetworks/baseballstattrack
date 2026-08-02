import Link from "next/link";

import { testDiscordChannelDelivery } from "@/app/discord/channel-actions";
import { DiscordSettingsFeedback } from "@/components/discord/discord-settings-feedback";
import type { DiscordConfigurationCheck } from "@/domain/discord-configuration-preview";
import type {
  DiscordDestinationPurpose,
  DiscordMessageFormat,
} from "@/domain/discord-settings";

const errorCopy: Readonly<Record<string, string>> = {
  validation: "Review the test destination and try again.",
  permissions:
    "Discord no longer grants View Channel and Send Messages for that destination.",
  "rate-limited": "Too many preview requests. Wait and try again.",
  provider: "Discord is temporarily unavailable. No test message was sent.",
  inactive: "Reconnect this Discord server before sending a test.",
  unavailable: "That managed Discord destination is unavailable.",
};

const operationCopy: Readonly<Record<string, string>> = {
  IGNORE: "No delivery",
  CREATE: "Create message",
  EDIT: "Edit current message",
  APPEND: "Append message",
  QUEUE_SUMMARY: "Queue summary",
  WAIT_FOR_FINAL: "Wait for final state",
};

function purposeLabel(purpose: DiscordDestinationPurpose) {
  return purpose.toLowerCase().replaceAll("_", " ");
}

export function DiscordConfigurationPreviewPanel({
  accountId,
  installationId,
  enabled,
  settingsRevision,
  validation,
  previews,
  testDestinations,
  messageFormat,
  notice,
  error,
}: {
  accountId: string;
  installationId: string;
  enabled: boolean;
  settingsRevision: number;
  validation: Readonly<{
    ready: boolean;
    checks: readonly DiscordConfigurationCheck[];
    errorCount: number;
    warningCount: number;
  }>;
  previews: readonly Readonly<{
    id: "LIVE" | "FINAL" | "CORRECTION" | "ERROR";
    label: string;
    operation: string;
    content: string;
  }>[];
  testDestinations: readonly Readonly<{
    id: string;
    displayName: string;
    purposes: readonly DiscordDestinationPurpose[];
  }>[];
  messageFormat: DiscordMessageFormat;
  notice?: string;
  error?: string;
}) {
  return (
    <div className="mt-6 space-y-8">
      {error ? (
        <DiscordSettingsFeedback
          errors={[{ message: errorCopy[error] ?? errorCopy.unavailable! }]}
          state="failure"
        />
      ) : null}
      {notice === "tested" ? (
        <p
          aria-live="polite"
          className="rounded-lg border border-green-300 bg-green-50 p-4 text-sm font-medium text-green-900"
          role="status"
        >
          Clearly marked synthetic test delivery sent successfully.
        </p>
      ) : null}

      <section aria-labelledby="configuration-readiness-heading">
        <div
          className={`rounded-lg border p-4 ${validation.ready ? "border-green-300 bg-green-50 text-green-950" : "border-red-300 bg-red-50 text-red-950"}`}
          role={validation.ready ? "status" : "alert"}
        >
          <h3
            className="text-lg font-semibold"
            id="configuration-readiness-heading"
          >
            {validation.ready
              ? "Configuration is ready"
              : "Configuration needs attention"}
          </h3>
          <p className="mt-1 text-sm">
            Saved revision {settingsRevision} is{" "}
            {enabled ? "enabled" : "paused"}. {validation.errorCount} blocking
            issue
            {validation.errorCount === 1 ? "" : "s"} and{" "}
            {validation.warningCount} warning
            {validation.warningCount === 1 ? "" : "s"} were found.
          </p>
          <p className="mt-2 text-sm">
            Re-open this preview after each settings change and before enabling
            delivery. Enabled configurations are also rejected server-side if
            required routes or delivery windows are incompatible.
          </p>
        </div>

        <ul className="mt-4 grid gap-3 md:grid-cols-2">
          {validation.checks.map((item) => (
            <li
              className="rounded-lg border border-[var(--line)] p-4"
              key={item.id}
            >
              <div className="flex items-start justify-between gap-3">
                <h4 className="font-semibold">{item.label}</h4>
                <span
                  className={`rounded-full px-2 py-1 text-xs font-semibold ${
                    item.status === "PASS"
                      ? "bg-green-100 text-green-900"
                      : item.status === "WARNING"
                        ? "bg-amber-100 text-amber-950"
                        : "bg-red-100 text-red-950"
                  }`}
                >
                  {item.status === "PASS"
                    ? "Ready"
                    : item.status === "WARNING"
                      ? "Review"
                      : "Blocked"}
                </span>
              </div>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--muted)]">
                {item.messages.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
              <Link
                className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-[var(--accent-strong)] underline"
                href={`/discord/${item.section}?server=${encodeURIComponent(installationId)}`}
              >
                Review {item.label.toLowerCase()}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="representative-message-heading">
        <h3
          className="text-lg font-semibold"
          id="representative-message-heading"
        >
          Representative messages
        </h3>
        <p className="mt-1 text-sm text-[var(--muted)]">
          These four previews use synthetic teams and scores. Every preview is
          visibly marked and never contacts Discord.
        </p>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {previews.map((preview) => (
            <article
              className="rounded-lg border border-[var(--line)] bg-slate-50 p-4"
              key={preview.id}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="font-semibold">{preview.label}</h4>
                <span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-900">
                  {operationCopy[preview.operation] ?? preview.operation}
                </span>
              </div>
              <pre className="mt-3 rounded-md border border-[var(--line)] bg-white p-3 font-sans text-sm whitespace-pre-wrap">
                {preview.content}
              </pre>
            </article>
          ))}
        </div>
      </section>

      <section
        aria-labelledby="configuration-test-heading"
        className="rounded-lg border border-[var(--line)] p-4"
      >
        <h3 className="text-lg font-semibold" id="configuration-test-heading">
          Send a synthetic test
        </h3>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Tests can target only a saved, permission-verified route. The message
          begins with “TEST ONLY — SYNTHETIC — NOT A LIVE UPDATE,” contains no
          game data, disables mentions, and is rate-limited and audited.
        </p>
        {testDestinations.length ? (
          <form action={testDiscordChannelDelivery} className="mt-4">
            <input name="accountId" type="hidden" value={accountId} />
            <input name="installationId" type="hidden" value={installationId} />
            <input name="messageFormat" type="hidden" value={messageFormat} />
            <input name="returnSection" type="hidden" value="preview" />
            <label
              className="block text-sm font-medium"
              htmlFor="preview-test-destination"
            >
              Saved destination
            </label>
            <select
              className="mt-2 min-h-11 w-full rounded-lg border border-[var(--line)] bg-white px-3 sm:max-w-md"
              id="preview-test-destination"
              name="destinationId"
              required
            >
              {testDestinations.map((destination) => (
                <option key={destination.id} value={destination.id}>
                  #{destination.displayName} —{" "}
                  {destination.purposes.map(purposeLabel).join(", ")}
                </option>
              ))}
            </select>
            <button
              className="mt-4 min-h-11 rounded-lg border border-[var(--line)] px-4 text-sm font-semibold"
              type="submit"
            >
              Send marked synthetic test
            </button>
          </form>
        ) : (
          <p className="mt-4 rounded-lg border border-dashed border-[var(--line)] p-4 text-sm text-[var(--muted)]">
            Configure a permission-verified channel route before sending a test.
          </p>
        )}
      </section>
    </div>
  );
}
