"use client";

import {
  useActionState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  initialPlateAppearanceActionResult,
  recordPlateAppearanceAction,
} from "@/app/games/score/actions";
import { BaseState } from "@/components/scoring/runner-base-out-panel";
import type { Base, GameState } from "@/domain/events/event-log";
import {
  PLATE_OUTCOMES,
  createPlateAppearanceDraft,
  currentBatterId,
  nextBatterId,
  plateOutcomeForShortcut,
  previewPlateAppearance,
  type PlateAppearanceDraft,
  type PlateOutcome,
} from "@/features/scoring/plate-appearance";
import type { RunnerOutcome } from "@/features/scoring/runner-interactions";
import { useScoringDraft } from "@/features/scoring/use-scoring-draft";

const bases = ["FIRST", "SECOND", "THIRD"] as const;
const baseLabels: Record<Base, string> = {
  FIRST: "first",
  SECOND: "second",
  THIRD: "third",
};

function runnerOutcomes(base: Base): RunnerOutcome[] {
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

const needsBattedBall = (outcome: PlateOutcome) =>
  [
    "BATTER_OUT",
    "SINGLE",
    "DOUBLE",
    "TRIPLE",
    "HOME_RUN",
    "FIELDER_CHOICE",
    "REACHED_ON_ERROR",
    "SACRIFICE_BUNT",
    "SACRIFICE_FLY",
  ].includes(outcome);

const subscribeOnline = (onChange: () => void) => {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
};

export function PlateAppearancePanel({
  accountId,
  gameId,
  setupSnapshotId,
  state,
  playerNames,
  defenders,
  initialClientSubmissionId,
  lastAcceptedAction,
}: {
  accountId: string;
  gameId: string;
  setupSnapshotId: string;
  state: GameState;
  playerNames: Record<string, string>;
  defenders: readonly { id: string; label: string }[];
  initialClientSubmissionId: string;
  lastAcceptedAction: string;
}) {
  const [draft, setDraft] = useState<PlateAppearanceDraft | null>(null);
  const online = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
  const resilientAction = useCallback(
    async (
      previous: typeof initialPlateAppearanceActionResult,
      formData: FormData,
    ) => {
      try {
        return await recordPlateAppearanceAction(previous, formData);
      } catch {
        return {
          status: "ERROR" as const,
          code: "NETWORK_FAILURE",
          message:
            "The connection failed before acceptance was confirmed. Retry this unchanged proposal to reuse its submission identity.",
        };
      }
    },
    [],
  );
  const [result, action, pending] = useActionState(
    resilientAction,
    initialPlateAppearanceActionResult,
  );
  const statusRef = useRef<HTMLDivElement>(null);
  const detailsRef = useRef<HTMLFieldSetElement>(null);
  const preview = useMemo(
    () => (draft ? previewPlateAppearance(state, draft) : null),
    [draft, state],
  );
  const { clientSubmissionId, abandon, blockedByRecoveredDraft, draftReady } =
    useScoringDraft({
      kind: "PLATE_APPEARANCE",
      accountId,
      gameId,
      setupSnapshotId,
      setupRevision: state.setupRevision,
      sourceRevision: state.sourceRevision,
      initialClientSubmissionId,
      proposal: preview?.body ?? null,
      engaged: draft !== null,
      pending,
      resultStatus: result.status,
    });
  const locked =
    pending || result.status === "ERROR" || blockedByRecoveredDraft;
  const chooseOutcome = useCallback(
    (outcome: PlateOutcome) => {
      setDraft(createPlateAppearanceDraft(state, outcome));
      requestAnimationFrame(() => detailsRef.current?.focus());
    },
    [state],
  );

  useEffect(() => {
    if (result.status !== "IDLE") statusRef.current?.focus();
  }, [result]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const element = event.target as HTMLElement | null;
      if (
        pending ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        ["INPUT", "SELECT", "TEXTAREA"].includes(element?.tagName ?? "")
      ) {
        return;
      }
      const outcome = plateOutcomeForShortcut(event.key);
      if (!outcome) return;
      event.preventDefault();
      chooseOutcome(outcome);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [chooseOutcome, pending]);

  const batterId = currentBatterId(state);
  const onDeckId = nextBatterId(state);
  const fieldingSide = state.half === "TOP" ? "HOME" : "AWAY";
  const pitcherId = state.activePitcher[fieldingSide];
  const player = (id: string) => playerNames[id] ?? id;
  const patchDraft = (patch: Partial<PlateAppearanceDraft>) => {
    if (draft) setDraft({ ...draft, ...patch });
  };
  const complexity =
    preview &&
    (preview.runs > 0 ||
      state.outs !== preview.outs ||
      bases.some((base) => state.bases[base] !== preview.bases[base]));

  return (
    <section aria-labelledby="plate-appearance-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold" id="plate-appearance-heading">
            Record plate appearance
          </h2>
          <p className="mt-2 text-[var(--muted)]">
            Select the batter result, review affected runners, then record one
            atomic play.
          </p>
        </div>
        <a
          className="inline-flex min-h-11 items-center text-sm font-semibold text-[var(--accent-strong)] underline-offset-4 hover:underline"
          href="#runner-only-actions"
        >
          Runner-only action
        </a>
      </div>

      <dl className="mt-4 grid gap-3 rounded-xl border border-[var(--line)] bg-white p-4 sm:grid-cols-3">
        <div>
          <dt className="text-sm text-[var(--muted)]">At bat</dt>
          <dd className="font-semibold">{player(batterId)}</dd>
        </div>
        <div>
          <dt className="text-sm text-[var(--muted)]">On deck</dt>
          <dd className="font-semibold">{player(onDeckId)}</dd>
        </div>
        <div>
          <dt className="text-sm text-[var(--muted)]">Active pitcher</dt>
          <dd className="font-semibold">{player(pitcherId)}</dd>
        </div>
      </dl>

      <div
        aria-live="polite"
        className={`mt-4 rounded-xl border p-4 ${
          result.status === "ERROR"
            ? "border-red-300 bg-red-50 text-red-950"
            : "border-[var(--line)] bg-white"
        }`}
        ref={statusRef}
        role={result.status === "ERROR" ? "alert" : "status"}
        tabIndex={-1}
      >
        <p className="font-semibold">
          {pending
            ? "Saving"
            : !online
              ? "Pending connection"
              : result.status === "ERROR" || blockedByRecoveredDraft
                ? "Needs attention"
                : draft
                  ? "Locally pending"
                  : "Saved"}
        </p>
        <p className="mt-1 text-sm">
          {pending
            ? "Submitting this complete play once."
            : !online
              ? "This draft remains local to the open page. Reconnect before recording."
              : blockedByRecoveredDraft
                ? "Resolve the recovered plate-appearance draft above before starting another."
                : result.message ||
                  `Authoritative source revision ${state.sourceRevision}. Last accepted: ${lastAcceptedAction}.`}
        </p>
      </div>

      <fieldset className="mt-5">
        <legend className="font-semibold">Common outcomes</legend>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Keyboard shortcuts are shown in parentheses.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {PLATE_OUTCOMES.filter(({ common }) => common).map((outcome) => (
            <button
              aria-keyshortcuts={outcome.key}
              className={`min-h-14 rounded-xl border px-3 text-left font-semibold ${
                draft?.outcome === outcome.value
                  ? "border-[var(--accent)] bg-emerald-50 text-[var(--accent-strong)]"
                  : "border-[var(--line)] bg-white"
              }`}
              disabled={locked}
              key={outcome.value}
              onClick={() => chooseOutcome(outcome.value)}
              type="button"
            >
              {outcome.label}
              <span className="ml-1 text-xs font-normal">({outcome.key})</span>
            </button>
          ))}
        </div>
        <details className="mt-3 rounded-xl border border-[var(--line)] bg-white p-4">
          <summary className="min-h-11 cursor-pointer font-semibold">
            More outcomes
          </summary>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {PLATE_OUTCOMES.filter(({ common }) => !common).map((outcome) => (
              <button
                aria-keyshortcuts={outcome.key}
                className="min-h-12 rounded-lg border border-[var(--line)] bg-white px-3 text-left font-medium"
                disabled={locked}
                key={outcome.value}
                onClick={() => chooseOutcome(outcome.value)}
                type="button"
              >
                {outcome.label}{" "}
                <span className="text-xs font-normal">({outcome.key})</span>
              </button>
            ))}
          </div>
        </details>
      </fieldset>

      {draft && preview ? (
        <form action={action} className="mt-6">
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

          <fieldset
            aria-label="Plate appearance proposal"
            className="rounded-xl border border-[var(--line)] bg-white p-4 sm:p-6"
            disabled={locked}
            ref={detailsRef}
            tabIndex={-1}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm text-[var(--muted)]">Selected outcome</p>
                <h3 className="text-xl font-semibold">
                  {
                    PLATE_OUTCOMES.find(({ value }) => value === draft.outcome)
                      ?.label
                  }
                </h3>
              </div>
              <button
                className="min-h-11 rounded-lg border border-[var(--line)] px-3 text-sm font-medium"
                onClick={() => setDraft(null)}
                type="button"
              >
                Discard proposal
              </button>
            </div>

            {needsBattedBall(draft.outcome) ? (
              <label className="mt-5 block text-sm font-medium">
                Batted-ball type
                <select
                  className="mt-2 min-h-12 w-full rounded-lg border border-[var(--line)] bg-white px-3"
                  onChange={(event) =>
                    patchDraft({
                      battedBall: event.target.value as NonNullable<
                        PlateAppearanceDraft["battedBall"]
                      >,
                    })
                  }
                  value={draft.battedBall ?? "GROUND_BALL"}
                >
                  <option value="GROUND_BALL">Ground ball</option>
                  <option value="FLY_BALL">Fly ball</option>
                  <option value="LINE_DRIVE">Line drive</option>
                  <option value="POP_UP">Pop up</option>
                  <option value="BUNT">Bunt</option>
                </select>
              </label>
            ) : null}

            <div className="mt-5 space-y-4">
              {bases.map((base) => {
                const runnerId = state.bases[base];
                if (!runnerId) return null;
                const runnerOutcome = draft.outcomes[base] ?? "REMAINS";
                return (
                  <fieldset
                    className="rounded-lg border border-[var(--line)] p-4"
                    key={base}
                  >
                    <legend className="px-1 font-semibold">
                      {player(runnerId)} on {baseLabels[base]}
                    </legend>
                    <label className="block text-sm font-medium">
                      Runner result
                      <select
                        className="mt-2 min-h-12 w-full rounded-lg border border-[var(--line)] bg-white px-3"
                        onChange={(event) =>
                          patchDraft({
                            outcomes: {
                              ...draft.outcomes,
                              [base]: event.target.value as RunnerOutcome,
                            },
                          })
                        }
                        value={runnerOutcome}
                      >
                        {runnerOutcomes(base).map((candidate) => (
                          <option key={candidate} value={candidate}>
                            {outcomeLabel(candidate)}
                          </option>
                        ))}
                      </select>
                    </label>
                    {runnerOutcome === "HOME" ? (
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <label className="text-sm font-medium">
                          Earned-run classification
                          <select
                            className="mt-2 min-h-12 w-full rounded-lg border border-[var(--line)] bg-white px-3"
                            onChange={(event) =>
                              patchDraft({
                                earnedRuns: {
                                  ...draft.earnedRuns,
                                  [base]: event.target
                                    .value as PlateAppearanceDraft["earnedRuns"][Base],
                                },
                              })
                            }
                            value={draft.earnedRuns[base] ?? "PENDING"}
                          >
                            <option value="PENDING">Pending review</option>
                            <option value="EARNED">Earned</option>
                            <option value="UNEARNED">Unearned</option>
                          </select>
                        </label>
                        <label className="flex min-h-12 items-center gap-3 self-end text-sm font-medium">
                          <input
                            checked={draft.rbiEligible[base] ?? false}
                            onChange={(event) =>
                              patchDraft({
                                rbiEligible: {
                                  ...draft.rbiEligible,
                                  [base]: event.target.checked,
                                },
                              })
                            }
                            type="checkbox"
                          />
                          Credit RBI
                        </label>
                      </div>
                    ) : null}
                    {runnerOutcome === "OUT" ? (
                      <label className="mt-3 flex min-h-11 items-center gap-3 text-sm font-medium">
                        <input
                          checked={draft.forceOuts[base] ?? false}
                          onChange={(event) =>
                            patchDraft({
                              forceOuts: {
                                ...draft.forceOuts,
                                [base]: event.target.checked,
                              },
                            })
                          }
                          type="checkbox"
                        />
                        Force out
                      </label>
                    ) : null}
                  </fieldset>
                );
              })}
            </div>

            {draft.outcome === "HOME_RUN" ? (
              <div className="mt-4 grid gap-3 rounded-lg border border-[var(--line)] p-4 sm:grid-cols-2">
                <label className="text-sm font-medium">
                  Batter run classification
                  <select
                    className="mt-2 min-h-12 w-full rounded-lg border border-[var(--line)] bg-white px-3"
                    onChange={(event) =>
                      patchDraft({
                        earnedRuns: {
                          ...draft.earnedRuns,
                          BATTER: event.target.value as NonNullable<
                            PlateAppearanceDraft["earnedRuns"]["BATTER"]
                          >,
                        },
                      })
                    }
                    value={draft.earnedRuns.BATTER ?? "EARNED"}
                  >
                    <option value="EARNED">Earned</option>
                    <option value="UNEARNED">Unearned</option>
                    <option value="PENDING">Pending review</option>
                  </select>
                </label>
                <label className="flex min-h-12 items-center gap-3 self-end text-sm font-medium">
                  <input
                    checked={draft.rbiEligible.BATTER ?? true}
                    onChange={(event) =>
                      patchDraft({
                        rbiEligible: {
                          ...draft.rbiEligible,
                          BATTER: event.target.checked,
                        },
                      })
                    }
                    type="checkbox"
                  />
                  Credit batter RBI
                </label>
              </div>
            ) : null}

            {preview.body?.payload.movements.some(({ to }) => to === "OUT") ||
            preview.errors.includes(
              "Select the fielder receiving the putout.",
            ) ? (
              <label className="mt-5 block text-sm font-medium">
                Fielder receiving putout
                <select
                  className="mt-2 min-h-12 w-full rounded-lg border border-[var(--line)] bg-white px-3"
                  onChange={(event) =>
                    patchDraft({
                      putoutFielderId: event.target.value || null,
                    })
                  }
                  value={draft.putoutFielderId ?? ""}
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

            {draft.outcome === "REACHED_ON_ERROR" ? (
              <label className="mt-5 block text-sm font-medium">
                Fielder charged with error
                <select
                  className="mt-2 min-h-12 w-full rounded-lg border border-[var(--line)] bg-white px-3"
                  onChange={(event) =>
                    patchDraft({
                      errorFielderId: event.target.value || null,
                    })
                  }
                  value={draft.errorFielderId ?? ""}
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

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <BaseState
              bases={state.bases}
              heading="Authoritative before"
              playerNames={playerNames}
            />
            <BaseState
              bases={preview.bases}
              heading="Proposed after"
              playerNames={playerNames}
            />
          </div>

          <dl className="mt-4 grid gap-3 rounded-xl border border-[var(--line)] bg-white p-4 sm:grid-cols-3">
            <div>
              <dt className="text-sm text-[var(--muted)]">Outs</dt>
              <dd className="font-semibold">
                {state.outs} → {preview.outs}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-[var(--muted)]">Runs</dt>
              <dd className="font-semibold">{preview.runs}</dd>
            </div>
            <div>
              <dt className="text-sm text-[var(--muted)]">Review</dt>
              <dd className="font-semibold">
                {complexity ? "Runner effects included" : "Routine play"}
              </dd>
            </div>
          </dl>

          {preview.errors.length > 0 ? (
            <div
              className="mt-4 rounded-xl border border-red-300 bg-red-50 p-4 text-red-950"
              role="alert"
            >
              <p className="font-semibold">Review before recording</p>
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
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              className="min-h-12 flex-1 rounded-lg bg-slate-950 px-5 font-semibold text-white disabled:opacity-50 sm:flex-none"
              disabled={
                pending ||
                blockedByRecoveredDraft ||
                !draftReady ||
                !online ||
                preview.body === null
              }
              type="submit"
            >
              {pending
                ? "Recording…"
                : result.status === "ERROR"
                  ? "Retry same proposal"
                  : "Record plate appearance"}
            </button>
            {result.status === "ERROR" ? (
              <>
                <button
                  className="min-h-12 rounded-lg border border-[var(--line)] bg-white px-4 font-semibold"
                  onClick={() => window.location.reload()}
                  type="button"
                >
                  Reload authoritative state
                </button>
                <button
                  className="min-h-12 rounded-lg border border-[var(--line)] bg-white px-4 font-semibold"
                  onClick={() => {
                    abandon();
                    window.location.reload();
                  }}
                  type="button"
                >
                  Discard local draft
                </button>
              </>
            ) : null}
          </div>
        </form>
      ) : null}
    </section>
  );
}
