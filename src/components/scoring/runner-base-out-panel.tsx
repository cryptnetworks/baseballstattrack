"use client";

import { useActionState, useMemo, useState } from "react";

import {
  initialRunnerPlayActionResult,
  recordRunnerPlayAction,
} from "@/app/games/score/actions";
import type { Base, GameState } from "@/domain/events/event-log";
import {
  RUNNER_PLAY_TYPES,
  previewRunnerPlay,
  type RunnerOutcome,
  type RunnerPlayDraft,
  type RunnerPlayType,
} from "@/features/scoring/runner-interactions";

const bases = ["FIRST", "SECOND", "THIRD"] as const;
const labels: Record<RunnerPlayType, string> = {
  OPTIONAL_ADVANCE: "Optional advance",
  ERROR: "Advance on error",
  STOLEN_BASE: "Stolen base",
  CAUGHT_STEALING: "Caught stealing",
  PICKOFF: "Pickoff",
  RUNNER_OUT: "Runner out",
  WILD_PITCH: "Wild pitch",
  PASSED_BALL: "Passed ball",
};
const baseLabels: Record<Base, string> = {
  FIRST: "first",
  SECOND: "second",
  THIRD: "third",
};

function outcomesFrom(base: Base): RunnerOutcome[] {
  if (base === "FIRST") return ["REMAINS", "SECOND", "THIRD", "HOME", "OUT"];
  if (base === "SECOND") return ["REMAINS", "THIRD", "HOME", "OUT"];
  return ["REMAINS", "HOME", "OUT"];
}

function outcomeLabel(outcome: RunnerOutcome) {
  if (outcome === "REMAINS") return "Remains";
  if (outcome === "HOME") return "Scores";
  if (outcome === "OUT") return "Is out";
  return `Advances to ${baseLabels[outcome]}`;
}

function runnerLabel(
  runnerId: string | null,
  playerNames: Record<string, string>,
) {
  return runnerId ? (playerNames[runnerId] ?? runnerId) : "Empty";
}

export function BaseState({
  bases: occupied,
  heading,
  playerNames,
}: {
  bases: GameState["bases"];
  heading: string;
  playerNames: Record<string, string>;
}) {
  return (
    <section
      aria-label={`${heading} base occupancy`}
      className="rounded-xl border border-[var(--line)] bg-white p-4"
    >
      <h3 className="font-semibold">{heading}</h3>
      <div
        aria-hidden="true"
        className="mx-auto mt-5 grid w-44 rotate-45 grid-cols-2 gap-3"
      >
        <span className="h-16 rounded-lg border-2 border-slate-400 bg-slate-100" />
        <span
          className={`h-16 rounded-lg border-2 ${
            occupied.SECOND
              ? "border-emerald-700 bg-emerald-100"
              : "border-slate-400 bg-slate-100"
          }`}
        />
        <span
          className={`h-16 rounded-lg border-2 ${
            occupied.THIRD
              ? "border-emerald-700 bg-emerald-100"
              : "border-slate-400 bg-slate-100"
          }`}
        />
        <span
          className={`h-16 rounded-lg border-2 ${
            occupied.FIRST
              ? "border-emerald-700 bg-emerald-100"
              : "border-slate-400 bg-slate-100"
          }`}
        />
      </div>
      <dl className="mt-6 grid gap-2 text-sm">
        {bases.map((base) => (
          <div className="flex justify-between gap-3" key={base}>
            <dt className="font-medium">{baseLabels[base]}</dt>
            <dd>{runnerLabel(occupied[base], playerNames)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function RunnerBaseOutPanel({
  accountId,
  gameId,
  setupSnapshotId,
  state,
  playerNames,
  defenders,
  initialClientSubmissionId,
}: {
  accountId: string;
  gameId: string;
  setupSnapshotId: string;
  state: GameState;
  playerNames: Record<string, string>;
  defenders: readonly { id: string; label: string }[];
  initialClientSubmissionId: string;
}) {
  const [playType, setPlayType] = useState<RunnerPlayType>("OPTIONAL_ADVANCE");
  const [outcomes, setOutcomes] = useState<
    Partial<Record<Base, RunnerOutcome>>
  >({});
  const [earnedRuns, setEarnedRuns] = useState<RunnerPlayDraft["earnedRuns"]>(
    {},
  );
  const [outFielderId, setOutFielderId] = useState("");
  const [errorFielderId, setErrorFielderId] = useState("");
  const [clientSubmissionId] = useState(initialClientSubmissionId);
  const [result, action, pending] = useActionState(
    recordRunnerPlayAction,
    initialRunnerPlayActionResult,
  );
  const draft = useMemo<RunnerPlayDraft>(
    () => ({
      playType,
      outcomes,
      earnedRuns,
      outFielderIds: outFielderId ? [outFielderId] : [],
      errorFielderId: errorFielderId || null,
    }),
    [earnedRuns, errorFielderId, outFielderId, outcomes, playType],
  );
  const preview = useMemo(
    () => previewRunnerPlay(state, draft),
    [draft, state],
  );

  const battingSide = state.half === "TOP" ? "AWAY" : "HOME";
  const walkOffCandidate =
    state.half === "BOTTOM" &&
    (state.inning ?? 0) >= state.scheduledInnings &&
    state.score.HOME + preview.runs > state.score.AWAY;
  const occupiedCount = bases.filter((base) => state.bases[base]).length;

  return (
    <div>
      <div
        aria-live="polite"
        className={`rounded-xl border p-4 ${
          result.status === "ERROR"
            ? "border-red-300 bg-red-50 text-red-950"
            : "border-[var(--line)] bg-white"
        }`}
        role={result.status === "ERROR" ? "alert" : "status"}
      >
        {pending
          ? "Recording the complete runner play…"
          : result.message ||
            `Authoritative source revision ${state.sourceRevision}.`}
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <BaseState
          bases={state.bases}
          heading="Before"
          playerNames={playerNames}
        />
        <BaseState
          bases={preview.bases}
          heading="Proposed after"
          playerNames={playerNames}
        />
      </div>

      <dl className="mt-4 grid gap-3 rounded-xl border border-[var(--line)] bg-white p-4 sm:grid-cols-4">
        <div>
          <dt className="text-sm text-[var(--muted)]">Batting side</dt>
          <dd className="font-semibold">{battingSide.toLowerCase()}</dd>
        </div>
        <div>
          <dt className="text-sm text-[var(--muted)]">Outs</dt>
          <dd className="font-semibold">
            {state.outs} → {preview.outs}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-[var(--muted)]">Runs proposed</dt>
          <dd className="font-semibold">{preview.runs}</dd>
        </div>
        <div>
          <dt className="text-sm text-[var(--muted)]">Movement</dt>
          <dd className="font-semibold">Optional / scorer selected</dd>
        </div>
      </dl>

      {occupiedCount === 0 ? (
        <p
          className="mt-5 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950"
          role="status"
        >
          No runners are on base. Runner-only controls become available after a
          batter reaches; plate-appearance entry is intentionally outside issue
          #18.
        </p>
      ) : (
        <form action={action} className="mt-5">
          <input name="accountId" type="hidden" value={accountId} />
          <input name="gameId" type="hidden" value={gameId} />
          <input name="setupSnapshotId" type="hidden" value={setupSnapshotId} />
          <input
            name="expectedRevision"
            type="hidden"
            value={state.sourceRevision}
          />
          <input
            name="clientSubmissionId"
            type="hidden"
            value={clientSubmissionId}
          />
          <input
            name="body"
            type="hidden"
            value={preview.body ? JSON.stringify(preview.body) : ""}
          />

          <fieldset className="rounded-xl border border-[var(--line)] bg-white p-4 sm:p-6">
            <legend className="px-1 text-lg font-semibold">
              Atomic runner play
            </legend>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Every changed runner is validated and accepted together. Nothing
              is persisted when any component is invalid.
            </p>
            <label
              className="mt-5 block text-sm font-medium"
              htmlFor="playType"
            >
              Play classification
            </label>
            <select
              className="mt-2 min-h-12 w-full rounded-lg border border-[var(--line)] bg-white px-3"
              id="playType"
              onChange={(event) => {
                setPlayType(event.target.value as RunnerPlayType);
                setOutcomes({});
              }}
              value={playType}
            >
              {RUNNER_PLAY_TYPES.map((type) => (
                <option key={type} value={type}>
                  {labels[type]}
                </option>
              ))}
            </select>

            <div className="mt-5 space-y-4">
              {bases.map((base) => {
                const runnerId = state.bases[base];
                if (!runnerId) return null;
                const outcome = outcomes[base] ?? "REMAINS";
                return (
                  <div
                    className="rounded-lg border border-[var(--line)] p-4"
                    key={base}
                  >
                    <label
                      className="block font-semibold"
                      htmlFor={`${base}-outcome`}
                    >
                      {runnerLabel(runnerId, playerNames)} on {baseLabels[base]}
                    </label>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      Responsible pitcher:{" "}
                      {runnerLabel(
                        state.runnerPitcherResponsibility[runnerId] ?? null,
                        playerNames,
                      )}
                    </p>
                    <select
                      className="mt-3 min-h-12 w-full rounded-lg border border-[var(--line)] bg-white px-3"
                      id={`${base}-outcome`}
                      onChange={(event) =>
                        setOutcomes({
                          ...outcomes,
                          [base]: event.target.value as RunnerOutcome,
                        })
                      }
                      value={outcome}
                    >
                      {outcomesFrom(base).map((candidate) => (
                        <option key={candidate} value={candidate}>
                          {outcomeLabel(candidate)}
                        </option>
                      ))}
                    </select>
                    {outcome === "HOME" ? (
                      <label className="mt-3 block text-sm font-medium">
                        Earned-run classification
                        <select
                          className="mt-2 min-h-12 w-full rounded-lg border border-[var(--line)] bg-white px-3"
                          onChange={(event) =>
                            setEarnedRuns({
                              ...earnedRuns,
                              [base]: event.target
                                .value as RunnerPlayDraft["earnedRuns"][Base],
                            })
                          }
                          value={earnedRuns[base] ?? "PENDING"}
                        >
                          <option value="PENDING">Pending scorer review</option>
                          <option value="EARNED">Earned</option>
                          <option value="UNEARNED">Unearned</option>
                        </select>
                      </label>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {playType === "CAUGHT_STEALING" ||
            playType === "PICKOFF" ||
            playType === "RUNNER_OUT" ? (
              <label className="mt-5 block text-sm font-medium">
                Fielder receiving the putout
                <select
                  className="mt-2 min-h-12 w-full rounded-lg border border-[var(--line)] bg-white px-3"
                  onChange={(event) => setOutFielderId(event.target.value)}
                  value={outFielderId}
                >
                  <option value="">Select fielder</option>
                  {defenders.map((defender) => (
                    <option key={defender.id} value={defender.id}>
                      {defender.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {playType === "ERROR" ? (
              <label className="mt-5 block text-sm font-medium">
                Fielder charged with error
                <select
                  className="mt-2 min-h-12 w-full rounded-lg border border-[var(--line)] bg-white px-3"
                  onChange={(event) => setErrorFielderId(event.target.value)}
                  value={errorFielderId}
                >
                  <option value="">Select fielder</option>
                  {defenders.map((defender) => (
                    <option key={defender.id} value={defender.id}>
                      {defender.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </fieldset>

          {preview.errors.length > 0 ? (
            <div
              className="mt-4 rounded-xl border border-red-300 bg-red-50 p-4 text-red-950"
              role="alert"
            >
              <p className="font-semibold">Review the proposed play</p>
              <ul className="mt-2 list-disc pl-5 text-sm">
                {preview.errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="sr-only" aria-live="polite">
            {preview.announcements.join(". ")}
          </div>
          {walkOffCandidate ? (
            <p
              className="mt-4 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-950"
              role="status"
            >
              This proposal reaches a walk-off score condition. The server
              remains responsible for accepting the play and the explicit game
              completion event.
            </p>
          ) : null}
          <button
            className="mt-5 min-h-12 w-full rounded-lg bg-slate-950 px-5 font-semibold text-white disabled:opacity-50 sm:w-auto"
            disabled={pending || preview.body === null}
            type="submit"
          >
            {pending ? "Recording…" : "Record complete runner play"}
          </button>
        </form>
      )}
    </div>
  );
}
