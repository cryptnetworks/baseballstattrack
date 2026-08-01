import { saveDiscordTrackedScopes } from "@/app/discord/scope-actions";
import {
  discordGameScopeTreatments,
  discordTrackedScopeKey,
} from "@/domain/discord-tracked-scopes";
import { DiscordSettingsFeedback } from "@/components/discord/discord-settings-feedback";

type GameCounts = Readonly<{
  upcoming: number;
  inProgress: number;
  completed: number;
  corrected: number;
  archived: number;
  incomplete: number;
}>;

type Scope = Readonly<{
  teamId: string;
  teamName: string;
  seasonId: string;
  seasonName: string;
  seasonStatus: string;
  startsOn: Date | null;
  endsOn: Date | null;
  available: boolean;
  staleReasons: readonly string[];
  selected: boolean;
  games: GameCounts;
  gameCount: number;
}>;

const errorCopy: Readonly<Record<string, string>> = {
  validation: "Review the selected team-seasons and try again.",
  conflict: "Settings changed in another session. Reload and save again.",
  stale: "A selected team-season is no longer available. Reload before saving.",
  inactive: "Reconnect this Discord server before changing tracked teams.",
  "rate-limited": "Too many administration requests. Wait and try again.",
  unavailable: "That Discord server or team-season is unavailable.",
};

function dateLabel(value: Date | null) {
  return value ? value.toISOString().slice(0, 10) : "date not set";
}

function scopeState(scope: Scope) {
  if (!scope.available) return `Archived: ${scope.staleReasons.join(", ")}`;
  if (scope.selected) return "Tracking enabled";
  return "Tracking paused";
}

export function DiscordTrackedScopesPanel({
  accountId,
  installationId,
  revision,
  scopes,
  selectedCount,
  staleSelectedCount,
  notice,
  error,
}: {
  accountId: string;
  installationId: string;
  revision: number;
  scopes: readonly Scope[];
  selectedCount: number;
  staleSelectedCount: number;
  notice?: string;
  error?: string;
}) {
  const available = scopes.filter((scope) => scope.available);
  const stale = scopes.filter((scope) => !scope.available);
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
          Tracked team-seasons saved. Configuration consumers receive the new
          scope revision without a bot restart.
        </p>
      ) : null}

      <section
        aria-labelledby="discord-game-treatment-heading"
        className="rounded-lg border border-[var(--line)] bg-slate-50 p-4"
      >
        <h3
          className="text-lg font-semibold"
          id="discord-game-treatment-heading"
        >
          How game states are treated
        </h3>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          {discordGameScopeTreatments.map((treatment) => (
            <div key={treatment.id}>
              <dt className="font-medium">{treatment.label}</dt>
              <dd className="text-sm text-[var(--muted)]">
                {treatment.description}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <form action={saveDiscordTrackedScopes}>
        <input name="accountId" type="hidden" value={accountId} />
        <input name="installationId" type="hidden" value={installationId} />
        <input name="expectedRevision" type="hidden" value={revision} />
        <fieldset>
          <legend className="text-lg font-semibold">
            Tracked team-seasons
          </legend>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Select one or more authorized team-seasons. Clear a selection to
            pause tracking without disconnecting Discord or changing channel
            routes.
          </p>
          <p className="mt-2 text-sm font-medium" role="status">
            {selectedCount} active {selectedCount === 1 ? "scope" : "scopes"}
            {staleSelectedCount
              ? `; ${staleSelectedCount} stale selection${staleSelectedCount === 1 ? "" : "s"}`
              : ""}
          </p>

          {available.length ? (
            <ul className="mt-4 divide-y divide-[var(--line)] rounded-lg border border-[var(--line)]">
              {available.map((scope) => {
                const key = discordTrackedScopeKey(
                  scope.teamId,
                  scope.seasonId,
                );
                return (
                  <li className="p-4" key={key}>
                    <label className="flex min-h-11 cursor-pointer items-start gap-3">
                      <input
                        className="mt-1 size-5 shrink-0"
                        defaultChecked={scope.selected}
                        name="scope"
                        type="checkbox"
                        value={key}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold">
                          {scope.teamName} — {scope.seasonName}
                        </span>
                        <span className="block text-xs text-[var(--muted)]">
                          {scope.seasonStatus.toLowerCase()} ·{" "}
                          {dateLabel(scope.startsOn)}
                          {" to "}
                          {dateLabel(scope.endsOn)} · {scopeState(scope)}
                        </span>
                      </span>
                    </label>
                    {scope.gameCount ? (
                      <ul
                        aria-label={`${scope.teamName} ${scope.seasonName} game states`}
                        className="mt-2 flex flex-wrap gap-2 text-xs"
                      >
                        {discordGameScopeTreatments.map((treatment) => (
                          <li
                            className="rounded-full bg-slate-100 px-2 py-1"
                            key={treatment.id}
                          >
                            {treatment.label}: {scope.games[treatment.id]}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-xs text-[var(--muted)]">
                        Empty season: no games are currently available. The
                        scope remains ready for future games.
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-4 rounded-lg border border-dashed border-[var(--line)] p-4 text-sm text-[var(--muted)]">
              No active team-season is available for this Account. Create or
              restore a team-season before enabling Discord tracking.
            </p>
          )}

          {stale.length ? (
            <div
              className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
              role={staleSelectedCount ? "alert" : "status"}
            >
              <h4 className="font-semibold">Archived team-season history</h4>
              <p className="mt-1">
                Archived scopes cannot be newly selected and generate no new
                delivery. Saving removes any stale selection while preserving
                historical games.
              </p>
              <ul className="mt-2 list-disc pl-5">
                {stale.map((scope) => (
                  <li
                    key={discordTrackedScopeKey(scope.teamId, scope.seasonId)}
                  >
                    {scope.teamName} — {scope.seasonName}
                    {scope.selected ? " (stale selection)" : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </fieldset>
        <button
          className="mt-5 min-h-11 rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-white"
          type="submit"
        >
          Save tracked teams
        </button>
      </form>
    </div>
  );
}
