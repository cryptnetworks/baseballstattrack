import { saveDiscordUpdateContent } from "@/app/discord/update-content-actions";
import { DiscordSettingsFeedback } from "@/components/discord/discord-settings-feedback";
import {
  discordMessageFormats,
  type DiscordMessageFormat,
  type DiscordMessageStrategy,
  type DiscordUpdateTrigger,
} from "@/domain/discord-settings";
import {
  discordMessageBudgets,
  discordMessageStrategyDefinitions,
  discordUpdateTriggerDefinitions,
  representativeDiscordStrategyPreviews,
  type DiscordContentOperation,
} from "@/domain/discord-update-content";

const errorCopy: Readonly<Record<string, string>> = {
  "content-validation":
    "Choose at least one update trigger, keep correction updates selected, and include a final trigger for final-only delivery.",
  "content-conflict":
    "Settings changed in another session. Reload before continuing.",
  "content-inactive":
    "Reconnect this Discord server before changing update content.",
  "content-rate-limited":
    "Too many administration requests. Wait and try again.",
  "content-unavailable": "That Discord server or configuration is unavailable.",
};

const operationCopy: Readonly<Record<DiscordContentOperation, string>> = {
  IGNORE: "No delivery",
  CREATE: "Create message",
  EDIT: "Edit current message",
  APPEND: "Append message",
  QUEUE_SUMMARY: "Queue next summary",
  WAIT_FOR_FINAL: "Wait for final state",
};

function optionLabel(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => `${part[0]?.toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export function DiscordUpdateContentPanel({
  accountId,
  installationId,
  settings,
  notice,
  error,
}: {
  accountId: string;
  installationId: string;
  settings: Readonly<{
    revision: number;
    triggers: readonly DiscordUpdateTrigger[];
    messageStrategy: DiscordMessageStrategy;
    messageFormat: DiscordMessageFormat;
  }>;
  notice?: string;
  error?: string;
}) {
  const selected = new Set(settings.triggers);
  const previews = representativeDiscordStrategyPreviews(
    settings.messageFormat,
  );

  return (
    <section
      aria-labelledby="discord-update-content-heading"
      className="mt-8 space-y-6 border-t border-[var(--line)] pt-8"
    >
      <div>
        <h3
          className="text-xl font-semibold"
          id="discord-update-content-heading"
        >
          Update content
        </h3>
        <p className="mt-2 max-w-3xl text-sm text-[var(--muted)]">
          Choose which accepted changes affect Discord presentation and how a
          game is summarized. Delivery execution and retries remain separate
          from these saved settings.
        </p>
      </div>

      {error ? (
        <DiscordSettingsFeedback
          errors={[
            {
              message: errorCopy[error] ?? errorCopy["content-unavailable"]!,
            },
          ]}
          state="failure"
        />
      ) : null}
      {notice === "content-saved" ? (
        <p
          className="rounded-lg border border-green-300 bg-green-50 p-4 text-sm font-medium text-green-900"
          role="status"
        >
          Update content settings saved. New evaluations will pin this revision.
        </p>
      ) : null}

      <form action={saveDiscordUpdateContent} className="space-y-6">
        <input name="accountId" type="hidden" value={accountId} />
        <input name="installationId" type="hidden" value={installationId} />
        <input
          name="expectedRevision"
          type="hidden"
          value={settings.revision}
        />

        <fieldset className="space-y-3">
          <legend className="text-lg font-semibold">Message strategy</legend>
          <div className="grid gap-3 md:grid-cols-2">
            {discordMessageStrategyDefinitions.map((strategy) => (
              <label
                className="flex min-h-11 gap-3 rounded-lg border border-[var(--line)] p-4"
                key={strategy.id}
              >
                <input
                  className="mt-1 size-5 shrink-0"
                  defaultChecked={settings.messageStrategy === strategy.id}
                  name="messageStrategy"
                  type="radio"
                  value={strategy.id}
                />
                <span>
                  <span className="block font-semibold">{strategy.label}</span>
                  <span className="mt-1 block text-sm text-[var(--muted)]">
                    {strategy.description}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-lg font-semibold">Update triggers</legend>
          <p className="text-sm text-[var(--muted)]">
            Corrections are always included so a published result cannot remain
            stale after accepted replay changes the effective state.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            {discordUpdateTriggerDefinitions.map((trigger) => (
              <label
                className="flex min-h-11 gap-3 rounded-lg border border-[var(--line)] p-3"
                key={trigger.id}
              >
                {"required" in trigger && trigger.required ? (
                  <>
                    <input name="triggers" type="hidden" value={trigger.id} />
                    <input
                      aria-describedby={`${trigger.id}-description`}
                      checked
                      className="mt-1 size-5 shrink-0"
                      disabled
                      readOnly
                      type="checkbox"
                    />
                  </>
                ) : (
                  <input
                    aria-describedby={`${trigger.id}-description`}
                    className="mt-1 size-5 shrink-0"
                    defaultChecked={selected.has(trigger.id)}
                    name="triggers"
                    type="checkbox"
                    value={trigger.id}
                  />
                )}
                <span>
                  <span className="block font-semibold">
                    {trigger.label}
                    {"required" in trigger && trigger.required
                      ? " (required)"
                      : ""}
                  </span>
                  <span
                    className="mt-1 block text-sm text-[var(--muted)]"
                    id={`${trigger.id}-description`}
                  >
                    {trigger.description}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-lg font-semibold">Verbosity</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            {discordMessageFormats.map((format) => (
              <label
                className="flex min-h-11 gap-3 rounded-lg border border-[var(--line)] p-3"
                key={format}
              >
                <input
                  className="mt-1 size-5 shrink-0"
                  defaultChecked={settings.messageFormat === format}
                  name="messageFormat"
                  type="radio"
                  value={format}
                />
                <span>
                  <span className="block font-semibold">
                    {optionLabel(format)}
                  </span>
                  <span className="text-sm text-[var(--muted)]">
                    Up to {discordMessageBudgets[format].toLocaleString()} text
                    characters
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <button
          className="min-h-11 rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-white"
          type="submit"
        >
          Save update content
        </button>
      </form>

      <section aria-labelledby="strategy-examples-heading">
        <h4 className="text-lg font-semibold" id="strategy-examples-heading">
          Representative strategy examples
        </h4>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Examples use the saved {optionLabel(settings.messageFormat)} format
          and synthetic game data. Saving a different format refreshes every
          example. The later configuration-preview workflow will validate full
          routing and delivery readiness.
        </p>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {previews.map((preview) => (
            <article
              className="rounded-lg border border-[var(--line)] bg-slate-50 p-4"
              key={preview.id}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h5 className="font-semibold">{preview.label}</h5>
                {preview.id === settings.messageStrategy ? (
                  <span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-900">
                    Selected
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-sm text-[var(--muted)]">
                {preview.description}
              </p>
              <p className="mt-3 text-xs font-semibold tracking-wide text-[var(--muted)] uppercase">
                {operationCopy[preview.primary.operation]}
              </p>
              <pre className="mt-1 rounded-md border border-[var(--line)] bg-white p-3 font-sans text-sm whitespace-pre-wrap">
                {preview.primary.content}
              </pre>
              <p className="mt-3 text-xs font-semibold tracking-wide text-[var(--muted)] uppercase">
                Correction: {operationCopy[preview.correction.operation]}
              </p>
              <pre className="mt-1 rounded-md border border-amber-300 bg-amber-50 p-3 font-sans text-sm whitespace-pre-wrap">
                {preview.correction.content}
              </pre>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}
