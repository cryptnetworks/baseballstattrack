import {
  changeDiscordCadenceState,
  requestDiscordManualRefresh,
  saveDiscordCadence,
} from "@/app/discord/cadence-actions";
import { DiscordSettingsFeedback } from "@/components/discord/discord-settings-feedback";
import { timeOfDay } from "@/domain/discord-cadence";

type Settings = Readonly<{
  revision: number;
  enabled: boolean;
  cadenceMode: "EVENT_DRIVEN" | "FIXED_INTERVAL" | "MANUAL_ONLY";
  cadenceSeconds: number;
  gameDayWindow: Readonly<{
    enabled: boolean;
    startMinute: number;
    endMinute: number;
  }>;
  digest: Readonly<{ enabled: boolean; minute: number }>;
  catchUpPolicy: "SKIP" | "LATEST_ONLY";
  quietHours: Readonly<{
    enabled: boolean;
    startMinute: number;
    endMinute: number;
    timeZone: string;
  }>;
  pausedAt: Date | null;
  manualRefreshRequestedAt: Date | null;
  nextScheduledEvaluationAt: Date | null;
  lastSuccessfulUpdateAt: Date | null;
}>;

const errorCopy: Readonly<Record<string, string>> = {
  validation:
    "Review the schedule, time zone, and time windows, then try again.",
  conflict: "Settings changed in another session. Reload before continuing.",
  inactive: "Reconnect this Discord server before changing update delivery.",
  incomplete:
    "Choose at least one tracked team-season and channel route before resuming.",
  "rate-limited": "Too many administration requests. Wait and try again.",
  unavailable: "That Discord server or schedule is unavailable.",
};

const noticeCopy: Readonly<Record<string, string>> = {
  saved: "Update schedule saved and its next evaluation was recalculated.",
  paused:
    "Update delivery paused. Settings and delivery history were preserved.",
  resumed: "Update delivery resumed using the selected catch-up policy.",
  requested: "A manual evaluation was requested.",
  coalesced:
    "A manual evaluation is already pending; no duplicate was created.",
};

function timestamp(value: Date | null, empty: string) {
  return value
    ? value.toISOString().replace("T", " ").replace(".000Z", " UTC")
    : empty;
}

function cadenceLabel(settings: Settings) {
  if (!settings.enabled) return settings.pausedAt ? "Paused" : "Not enabled";
  if (settings.cadenceMode === "EVENT_DRIVEN") return "Event-driven";
  if (settings.cadenceMode === "MANUAL_ONLY") return "Manual only";
  return `Every ${settings.cadenceSeconds / 60} minute${settings.cadenceSeconds === 60 ? "" : "s"}`;
}

function HiddenIdentity({
  accountId,
  installationId,
  revision,
}: {
  accountId: string;
  installationId: string;
  revision: number;
}) {
  return (
    <>
      <input name="accountId" type="hidden" value={accountId} />
      <input name="installationId" type="hidden" value={installationId} />
      <input name="expectedRevision" type="hidden" value={revision} />
    </>
  );
}

export function DiscordCadencePanel({
  accountId,
  installationId,
  settings,
  notice,
  error,
}: {
  accountId: string;
  installationId: string;
  settings: Settings;
  notice?: string;
  error?: string;
}) {
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
          className="rounded-lg border border-green-300 bg-green-50 p-4 text-sm font-medium text-green-900"
          role="status"
        >
          {noticeCopy[notice] ?? noticeCopy.saved}
        </p>
      ) : null}

      <section
        aria-labelledby="discord-update-status"
        className="rounded-lg border border-[var(--line)] bg-slate-50 p-4"
      >
        <h3 className="text-lg font-semibold" id="discord-update-status">
          Delivery status
        </h3>
        <dl className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-sm font-medium text-[var(--muted)]">Cadence</dt>
            <dd className="font-semibold">{cadenceLabel(settings)}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-[var(--muted)]">
              Next scheduled evaluation
            </dt>
            <dd className="font-semibold">
              {timestamp(
                settings.nextScheduledEvaluationAt,
                settings.enabled && settings.cadenceMode === "EVENT_DRIVEN"
                  ? "Waiting for a matching game event"
                  : "None scheduled",
              )}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-[var(--muted)]">
              Last successful update
            </dt>
            <dd className="font-semibold">
              {timestamp(
                settings.lastSuccessfulUpdateAt,
                "No successful update recorded",
              )}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-[var(--muted)]">
              Manual evaluation
            </dt>
            <dd className="font-semibold">
              {timestamp(
                settings.manualRefreshRequestedAt,
                "No request pending",
              )}
            </dd>
          </div>
        </dl>
      </section>

      <form action={saveDiscordCadence} className="space-y-5">
        <HiddenIdentity
          accountId={accountId}
          installationId={installationId}
          revision={settings.revision}
        />
        <fieldset className="space-y-4">
          <legend className="text-lg font-semibold">Evaluation policy</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium" htmlFor="cadence-mode">
              Cadence mode
              <select
                className="mt-1 min-h-11 w-full rounded-lg border border-[var(--line)] bg-white px-3"
                defaultValue={settings.cadenceMode}
                id="cadence-mode"
                name="cadenceMode"
              >
                <option value="EVENT_DRIVEN">Event-driven</option>
                <option value="FIXED_INTERVAL">Fixed interval</option>
                <option value="MANUAL_ONLY">Manual only</option>
              </select>
            </label>
            <label className="text-sm font-medium" htmlFor="cadence-seconds">
              Fixed interval
              <select
                className="mt-1 min-h-11 w-full rounded-lg border border-[var(--line)] bg-white px-3"
                defaultValue={String(settings.cadenceSeconds)}
                id="cadence-seconds"
                name="cadenceSeconds"
              >
                <option value="60">1 minute</option>
                <option value="300">5 minutes</option>
                <option value="900">15 minutes</option>
                <option value="1800">30 minutes</option>
                <option value="3600">60 minutes</option>
              </select>
            </label>
            <label className="text-sm font-medium" htmlFor="schedule-time-zone">
              Schedule time zone
              <input
                className="mt-1 min-h-11 w-full rounded-lg border border-[var(--line)] px-3"
                defaultValue={settings.quietHours.timeZone}
                id="schedule-time-zone"
                maxLength={64}
                name="timeZone"
                required
              />
            </label>
            <label className="text-sm font-medium" htmlFor="catch-up-policy">
              After resume
              <select
                className="mt-1 min-h-11 w-full rounded-lg border border-[var(--line)] bg-white px-3"
                defaultValue={settings.catchUpPolicy}
                id="catch-up-policy"
                name="catchUpPolicy"
              >
                <option value="LATEST_ONLY">Evaluate latest state once</option>
                <option value="SKIP">
                  Wait for the next normal evaluation
                </option>
              </select>
            </label>
          </div>
        </fieldset>

        <fieldset className="rounded-lg border border-[var(--line)] p-4">
          <legend className="px-1 font-semibold">Game-day window</legend>
          <label className="flex min-h-11 items-center gap-3">
            <input
              className="size-5"
              defaultChecked={settings.gameDayWindow.enabled}
              name="gameDayWindowEnabled"
              type="checkbox"
            />{" "}
            Limit timed evaluations to this daily window
          </label>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium" htmlFor="game-day-start">
              Starts
              <input
                className="mt-1 min-h-11 w-full rounded-lg border border-[var(--line)] px-3"
                defaultValue={timeOfDay(settings.gameDayWindow.startMinute)}
                id="game-day-start"
                name="gameDayStart"
                type="time"
              />
            </label>
            <label className="text-sm font-medium" htmlFor="game-day-end">
              Ends
              <input
                className="mt-1 min-h-11 w-full rounded-lg border border-[var(--line)] px-3"
                defaultValue={timeOfDay(settings.gameDayWindow.endMinute)}
                id="game-day-end"
                name="gameDayEnd"
                type="time"
              />
            </label>
          </div>
        </fieldset>

        <fieldset className="rounded-lg border border-[var(--line)] p-4">
          <legend className="px-1 font-semibold">Quiet hours</legend>
          <label className="flex min-h-11 items-center gap-3">
            <input
              className="size-5"
              defaultChecked={settings.quietHours.enabled}
              name="quietHoursEnabled"
              type="checkbox"
            />{" "}
            Defer evaluations during quiet hours
          </label>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium" htmlFor="quiet-start">
              Starts
              <input
                className="mt-1 min-h-11 w-full rounded-lg border border-[var(--line)] px-3"
                defaultValue={timeOfDay(settings.quietHours.startMinute)}
                id="quiet-start"
                name="quietStart"
                type="time"
              />
            </label>
            <label className="text-sm font-medium" htmlFor="quiet-end">
              Ends
              <input
                className="mt-1 min-h-11 w-full rounded-lg border border-[var(--line)] px-3"
                defaultValue={timeOfDay(settings.quietHours.endMinute)}
                id="quiet-end"
                name="quietEnd"
                type="time"
              />
            </label>
          </div>
        </fieldset>

        <fieldset className="rounded-lg border border-[var(--line)] p-4">
          <legend className="px-1 font-semibold">Scheduled digest</legend>
          <label className="flex min-h-11 items-center gap-3">
            <input
              className="size-5"
              defaultChecked={settings.digest.enabled}
              name="digestEnabled"
              type="checkbox"
            />{" "}
            Evaluate one daily digest
          </label>
          <label
            className="mt-3 block text-sm font-medium"
            htmlFor="digest-time"
          >
            Digest time
            <input
              className="mt-1 min-h-11 w-full rounded-lg border border-[var(--line)] px-3 sm:max-w-xs"
              defaultValue={timeOfDay(settings.digest.minute)}
              id="digest-time"
              name="digestTime"
              type="time"
            />
          </label>
        </fieldset>

        <button
          className="min-h-11 rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-white"
          type="submit"
        >
          Save update schedule
        </button>
      </form>

      <div className="grid gap-4 border-t border-[var(--line)] pt-5 sm:grid-cols-2">
        <form action={changeDiscordCadenceState}>
          <HiddenIdentity
            accountId={accountId}
            installationId={installationId}
            revision={settings.revision}
          />
          <input
            name="operation"
            type="hidden"
            value={settings.enabled ? "PAUSE" : "RESUME"}
          />
          <button
            className="min-h-11 w-full rounded-lg border border-[var(--line)] px-4 text-sm font-semibold"
            type="submit"
          >
            {settings.enabled ? "Pause delivery" : "Resume delivery"}
          </button>
          <p className="mt-2 text-xs text-[var(--muted)]">
            Pause preserves settings and history. Resume never replays every
            missed event.
          </p>
        </form>
        <form action={requestDiscordManualRefresh}>
          <HiddenIdentity
            accountId={accountId}
            installationId={installationId}
            revision={settings.revision}
          />
          <button
            className="min-h-11 w-full rounded-lg border border-[var(--line)] px-4 text-sm font-semibold disabled:bg-slate-100 disabled:text-slate-400"
            disabled={!settings.enabled}
            type="submit"
          >
            Request manual evaluation
          </button>
          <p className="mt-2 text-xs text-[var(--muted)]">
            Repeated requests coalesce into one pending evaluation and still
            respect configured windows.
          </p>
        </form>
      </div>
    </div>
  );
}
