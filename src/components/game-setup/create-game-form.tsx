"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { createDraftGameAction } from "@/app/games/setup/actions";
import {
  initialCreateGameResult,
  WEATHER_CONDITIONS,
} from "@/features/game-setup/workflow";

type TeamSeasonChoice = {
  id: string;
  seasonId: string;
  teamName: string;
  seasonName: string;
};

export function CreateGameForm({
  accountId,
  teamSeasons,
  defaultScheduledAt,
}: {
  accountId: string;
  teamSeasons: readonly TeamSeasonChoice[];
  defaultScheduledAt: string;
}) {
  const [state, action, pending] = useActionState(
    createDraftGameAction,
    initialCreateGameResult,
  );
  const errorSummary = useRef<HTMLDivElement>(null);
  const [teamSeasonId, setTeamSeasonId] = useState(teamSeasons[0]?.id ?? "");
  const seasonId =
    teamSeasons.find(({ id }) => id === teamSeasonId)?.seasonId ?? "";

  useEffect(() => {
    if (state.status === "ERROR") errorSummary.current?.focus();
  }, [state]);

  return (
    <form action={action} className="mt-6 space-y-5">
      <input name="accountId" type="hidden" value={accountId} />
      <input name="seasonId" type="hidden" value={seasonId} />
      {state.status === "ERROR" ? (
        <div
          className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-950"
          ref={errorSummary}
          role="alert"
          tabIndex={-1}
        >
          <p className="font-semibold">Game draft was not created.</p>
          <p className="mt-1">{state.message}</p>
          {state.fieldErrors.length > 0 ? (
            <ul className="mt-2 list-disc pl-5">
              {state.fieldErrors.map((error, index) => (
                <li key={`${error.field}-${index}`}>{error.message}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <div>
        <label
          className="block text-sm font-medium"
          htmlFor="managedTeamSeasonId"
        >
          Team and season
        </label>
        <select
          className="mt-2 min-h-12 w-full rounded-lg border border-[var(--line)] bg-white px-3"
          id="managedTeamSeasonId"
          name="managedTeamSeasonId"
          onChange={(event) => setTeamSeasonId(event.target.value)}
          required
          value={teamSeasonId}
        >
          {teamSeasons.map((choice) => (
            <option key={choice.id} value={choice.id}>
              {choice.teamName} — {choice.seasonName}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium" htmlFor="scheduledAt">
          Game date and time (UTC)
        </label>
        <input
          className="mt-2 min-h-12 w-full rounded-lg border border-[var(--line)] bg-white px-3"
          defaultValue={defaultScheduledAt}
          id="scheduledAt"
          name="scheduledAt"
          required
          type="datetime-local"
        />
      </div>
      <div>
        <label className="block text-sm font-medium" htmlFor="location">
          Location{" "}
          <span className="font-normal text-[var(--muted)]">(optional)</span>
        </label>
        <input
          className="mt-2 min-h-12 w-full rounded-lg border border-[var(--line)] bg-white px-3"
          id="location"
          maxLength={120}
          name="location"
        />
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label
            className="block text-sm font-medium"
            htmlFor="weatherCondition"
          >
            Weather{" "}
            <span className="font-normal text-[var(--muted)]">(optional)</span>
          </label>
          <select
            className="mt-2 min-h-12 w-full rounded-lg border border-[var(--line)] bg-white px-3"
            id="weatherCondition"
            name="weatherCondition"
          >
            <option value="">Not recorded</option>
            {WEATHER_CONDITIONS.map((condition) => (
              <option key={condition} value={condition}>
                {condition.replaceAll("_", " ").toLowerCase()}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium" htmlFor="temperatureF">
            Temperature °F{" "}
            <span className="font-normal text-[var(--muted)]">(optional)</span>
          </label>
          <input
            className="mt-2 min-h-12 w-full rounded-lg border border-[var(--line)] bg-white px-3"
            id="temperatureF"
            max={130}
            min={-20}
            name="temperatureF"
            type="number"
          />
        </div>
      </div>
      <button
        className="inline-flex min-h-12 items-center justify-center rounded-lg bg-[var(--accent)] px-5 font-semibold text-white disabled:opacity-60"
        disabled={pending || teamSeasons.length === 0}
        type="submit"
      >
        {pending ? "Creating draft…" : "Create game draft"}
      </button>
    </form>
  );
}
