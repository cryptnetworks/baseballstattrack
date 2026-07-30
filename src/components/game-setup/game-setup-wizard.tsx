"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";

import { mutateGameSetupAction } from "@/app/games/setup/actions";
import {
  BASEBALL_POSITIONS,
  initialSetupMutationResult,
  SETUP_STEPS,
  validateSetupDraft,
  WEATHER_CONDITIONS,
  type ExternalLineupRow,
  type ManagedLineupRow,
  type SetupStep,
  type SetupWorkflowDraft,
} from "@/features/game-setup/workflow";

type TeamSeasonOption = {
  id: string;
  teamName: string;
  roster: ManagedLineupRow[];
};

const stepLabels: Record<SetupStep, string> = {
  GAME_DETAILS: "Game details",
  PARTICIPANTS: "Participants",
  LINEUP: "Lineup and defense",
  REVIEW: "Review",
};

function formatLabel(value: string) {
  return value.replaceAll("_", " ").toLowerCase();
}

function swapBattingOrder<T extends ManagedLineupRow | ExternalLineupRow>(
  rows: readonly T[],
  index: number,
  direction: -1 | 1,
): T[] {
  const row = rows[index];
  if (!row?.battingOrder) return [...rows];
  const destination = row.battingOrder + direction;
  const otherIndex = rows.findIndex(
    ({ battingOrder }) => battingOrder === destination,
  );
  if (otherIndex === -1) return [...rows];
  return rows.map((candidate, candidateIndex) => {
    if (candidateIndex === index) {
      return { ...candidate, battingOrder: destination };
    }
    if (candidateIndex === otherIndex) {
      return { ...candidate, battingOrder: row.battingOrder };
    }
    return candidate;
  });
}

export function LineupFields({
  heading,
  rows,
  onChange,
  onRowsChange,
  onRemove,
  immutable,
}: {
  heading: string;
  rows: readonly (ManagedLineupRow | ExternalLineupRow)[];
  onChange: (index: number, row: ManagedLineupRow | ExternalLineupRow) => void;
  onRowsChange: (
    rows: readonly (ManagedLineupRow | ExternalLineupRow)[],
  ) => void;
  onRemove?: (index: number) => void;
  immutable: boolean;
}) {
  const selectedRows = rows.filter(
    (row) => row.kind === "EXTERNAL" || row.selected,
  );
  return (
    <fieldset className="rounded-xl border border-[var(--line)] p-4">
      <legend className="px-1 text-lg font-semibold">{heading}</legend>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Use native controls or the named move buttons; drag and drop is not
        required.
      </p>
      <div className="mt-4 space-y-3">
        {rows.map((row, index) => {
          const active = row.kind === "EXTERNAL" || row.selected;
          const order = row.battingOrder ?? "";
          const playerKey =
            row.kind === "MANAGED" ? row.rosterEntryId : row.clientId;
          const nameId = `${heading}-${playerKey}-name`;
          return (
            <article
              className="rounded-lg border border-[var(--line)] bg-[var(--background)] p-3"
              key={playerKey}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                {row.kind === "MANAGED" ? (
                  <label
                    className="flex min-h-11 items-center gap-3 font-medium"
                    htmlFor={`${playerKey}-selected`}
                  >
                    <input
                      checked={row.selected}
                      disabled={immutable}
                      id={`${playerKey}-selected`}
                      onChange={(event) =>
                        onChange(index, {
                          ...row,
                          selected: event.target.checked,
                        })
                      }
                      type="checkbox"
                    />
                    {row.displayName}
                    {row.jerseyNumber ? ` #${row.jerseyNumber}` : ""}
                    {!row.eligible ? (
                      <span className="text-sm font-normal text-red-800">
                        No longer eligible
                      </span>
                    ) : null}
                  </label>
                ) : (
                  <div className="min-w-56 flex-1">
                    <label
                      className="block text-sm font-medium"
                      htmlFor={nameId}
                    >
                      Player label
                    </label>
                    <input
                      className="mt-1 min-h-11 w-full rounded-lg border border-[var(--line)] bg-white px-3"
                      disabled={immutable}
                      id={nameId}
                      maxLength={100}
                      onChange={(event) =>
                        onChange(index, {
                          ...row,
                          displayName: event.target.value,
                        })
                      }
                      value={row.displayName}
                    />
                  </div>
                )}
                {row.kind === "EXTERNAL" && onRemove ? (
                  <button
                    className="min-h-11 rounded-lg border border-red-300 bg-white px-3 text-sm font-medium text-red-800"
                    disabled={immutable}
                    onClick={() => onRemove(index)}
                    type="button"
                  >
                    Remove {row.displayName || "player"}
                  </button>
                ) : null}
              </div>
              <div
                aria-disabled={!active}
                className="mt-3 grid gap-3 sm:grid-cols-3"
              >
                <div>
                  <label
                    className="block text-sm font-medium"
                    htmlFor={`${playerKey}-order`}
                  >
                    Batting order
                  </label>
                  <input
                    className="mt-1 min-h-11 w-full rounded-lg border border-[var(--line)] bg-white px-3"
                    disabled={
                      !active ||
                      immutable ||
                      (row.kind === "MANAGED" && !row.eligible)
                    }
                    id={`${playerKey}-order`}
                    max={30}
                    min={1}
                    onChange={(event) =>
                      onChange(index, {
                        ...row,
                        battingOrder:
                          event.target.value.length > 0
                            ? Number(event.target.value)
                            : null,
                      })
                    }
                    type="number"
                    value={order}
                  />
                </div>
                <div>
                  <label
                    className="block text-sm font-medium"
                    htmlFor={`${playerKey}-position`}
                  >
                    Defensive position
                  </label>
                  <select
                    className="mt-1 min-h-11 w-full rounded-lg border border-[var(--line)] bg-white px-3"
                    disabled={
                      !active ||
                      immutable ||
                      (row.kind === "MANAGED" && !row.eligible)
                    }
                    id={`${playerKey}-position`}
                    onChange={(event) =>
                      onChange(index, {
                        ...row,
                        defensivePosition:
                          event.target.value.length > 0
                            ? (event.target
                                .value as (typeof BASEBALL_POSITIONS)[number])
                            : null,
                        isStartingPitcher:
                          event.target.value === "PITCHER"
                            ? row.isStartingPitcher
                            : false,
                      })
                    }
                    value={row.defensivePosition ?? ""}
                  >
                    <option value="">Bench / no position</option>
                    {BASEBALL_POSITIONS.map((position) => (
                      <option key={position} value={position}>
                        {formatLabel(position)}
                      </option>
                    ))}
                  </select>
                </div>
                <label className="flex min-h-11 items-end gap-3 pb-2 text-sm font-medium">
                  <input
                    checked={row.isStartingPitcher}
                    disabled={
                      !active ||
                      immutable ||
                      (row.kind === "MANAGED" && !row.eligible)
                    }
                    onChange={(event) =>
                      onChange(index, {
                        ...row,
                        isStartingPitcher: event.target.checked,
                        defensivePosition: event.target.checked
                          ? "PITCHER"
                          : row.defensivePosition,
                      })
                    }
                    type="checkbox"
                  />
                  Starting pitcher
                </label>
              </div>
              {active && row.battingOrder !== null ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    className="min-h-11 rounded-lg border border-[var(--line)] bg-white px-3 text-sm font-medium"
                    disabled={
                      immutable ||
                      row.battingOrder <= 1 ||
                      !selectedRows.some(
                        ({ battingOrder }) =>
                          battingOrder === row.battingOrder! - 1,
                      )
                    }
                    onClick={() => {
                      onRowsChange(swapBattingOrder(rows, index, -1));
                    }}
                    type="button"
                  >
                    Move {row.displayName || "player"} up
                  </button>
                  <button
                    className="min-h-11 rounded-lg border border-[var(--line)] bg-white px-3 text-sm font-medium"
                    disabled={
                      immutable ||
                      !selectedRows.some(
                        ({ battingOrder }) =>
                          battingOrder === row.battingOrder! + 1,
                      )
                    }
                    onClick={() => {
                      onRowsChange(swapBattingOrder(rows, index, 1));
                    }}
                    type="button"
                  >
                    Move {row.displayName || "player"} down
                  </button>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </fieldset>
  );
}

export function GameSetupWizard({
  initialDraft,
  initialGameStatus,
  managedTeamName,
  seasonName,
  teamSeasons,
  rulesets,
}: {
  initialDraft: SetupWorkflowDraft;
  initialGameStatus: "DRAFT" | "READY" | "IN_PROGRESS";
  managedTeamName: string;
  seasonName: string;
  teamSeasons: readonly TeamSeasonOption[];
  rulesets: readonly { id: string; label: string }[];
}) {
  const [draft, setDraft] = useState(initialDraft);
  const [step, setStep] = useState<SetupStep>("GAME_DETAILS");
  const [edited, setEdited] = useState(false);
  const [result, action, pending] = useActionState(
    mutateGameSetupAction,
    initialSetupMutationResult,
  );
  const errorSummary = useRef<HTMLDivElement>(null);
  const statusMessage = useRef<HTMLDivElement>(null);

  const actionIsCurrent =
    result.status === "SUCCESS" &&
    draft.clientSubmissionId === result.acceptedClientSubmissionId;
  const currentDraft = useMemo(
    () =>
      actionIsCurrent
        ? {
            ...draft,
            expectedSetupRevision: result.setupRevision,
            clientSubmissionId: result.nextClientSubmissionId,
          }
        : draft,
    [actionIsCurrent, draft, result],
  );
  const gameStatus = actionIsCurrent ? result.gameStatus : initialGameStatus;
  const dirty = edited && !actionIsCurrent;
  const immutable = gameStatus === "IN_PROGRESS";
  const readyErrors = useMemo(
    () => validateSetupDraft(currentDraft, { requireReady: true }),
    [currentDraft],
  );

  useEffect(() => {
    if (result.status === "ERROR") {
      errorSummary.current?.focus();
    } else if (result.status === "SUCCESS") {
      statusMessage.current?.focus();
    }
  }, [result]);

  const updateDraft = (patch: Partial<SetupWorkflowDraft>) => {
    setDraft({ ...currentDraft, ...patch });
    setEdited(true);
  };

  const selectedOpponent = teamSeasons.find(
    ({ id }) => id === currentDraft.opponentTeamSeasonId,
  );
  const displayedOpponentLineup = currentDraft.opponentManagedLineup;

  const stepIndex = SETUP_STEPS.indexOf(step);

  return (
    <form action={action}>
      <input name="draft" type="hidden" value={JSON.stringify(currentDraft)} />
      <input
        name="reuseCurrentSetup"
        type="hidden"
        value={String(!dirty && currentDraft.expectedSetupRevision > 0)}
      />
      <div className="rounded-xl border border-[var(--line)] bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-[var(--muted)]">
              {managedTeamName} · {seasonName}
            </p>
            <p className="mt-1 font-semibold">
              {gameStatus === "IN_PROGRESS"
                ? "Game in progress"
                : gameStatus === "READY"
                  ? "Ready for first pitch"
                  : "Draft setup"}
            </p>
          </div>
          <div
            aria-live="polite"
            className="rounded-lg border border-[var(--line)] bg-[var(--background)] px-3 py-2 text-sm font-medium"
            ref={statusMessage}
            tabIndex={-1}
          >
            {pending
              ? "Saving"
              : result.status === "ERROR"
                ? "Needs attention"
                : dirty
                  ? "Unsaved changes"
                  : result.status === "SUCCESS"
                    ? result.message
                    : `Saved · setup revision ${currentDraft.expectedSetupRevision}`}
          </div>
        </div>
        <p className="mt-3 text-xs text-[var(--muted)]">
          Server-authoritative setup revision{" "}
          {currentDraft.expectedSetupRevision}
        </p>
      </div>

      {result.status === "ERROR" ? (
        <div
          className="mt-4 rounded-xl border border-red-300 bg-red-50 p-4 text-red-950"
          ref={errorSummary}
          role="alert"
          tabIndex={-1}
        >
          <p className="font-semibold">{result.message}</p>
          {result.fieldErrors.length > 0 ? (
            <ul className="mt-2 list-disc pl-5 text-sm">
              {result.fieldErrors.map((error, index) => (
                <li key={`${error.field}-${index}`}>
                  <a
                    className="underline"
                    href={`#${error.field}`}
                    onClick={() => {
                      if (
                        error.field === "scheduledAt" ||
                        error.field === "location"
                      ) {
                        setStep("GAME_DETAILS");
                      } else if (
                        error.field === "opponentTeamSeasonId" ||
                        error.field === "externalOpponentName"
                      ) {
                        setStep("PARTICIPANTS");
                      } else {
                        setStep("LINEUP");
                      }
                    }}
                  >
                    {error.message}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <nav aria-label="Game setup progress" className="mt-6">
        <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {SETUP_STEPS.map((candidate, index) => (
            <li key={candidate}>
              <button
                aria-current={candidate === step ? "step" : undefined}
                className={`min-h-12 w-full rounded-lg border px-3 text-left text-sm font-medium ${
                  candidate === step
                    ? "border-[var(--accent)] bg-emerald-50 text-[var(--accent-strong)]"
                    : "border-[var(--line)] bg-white"
                }`}
                onClick={() => setStep(candidate)}
                type="button"
              >
                <span className="block text-xs">Step {index + 1}</span>
                {stepLabels[candidate]}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <section className="mt-6 rounded-xl border border-[var(--line)] bg-white p-4 sm:p-6">
        {step === "GAME_DETAILS" ? (
          <div className="space-y-5">
            <div>
              <h2 className="text-2xl font-semibold">Game details</h2>
              <p className="mt-2 text-sm text-[var(--muted)]">
                Date, rules, and field conditions remain editable until first
                pitch.
              </p>
            </div>
            <div>
              <label
                className="block text-sm font-medium"
                htmlFor="scheduledAt"
              >
                Game date and time (UTC)
              </label>
              <input
                className="mt-2 min-h-12 w-full rounded-lg border border-[var(--line)] bg-white px-3"
                disabled={immutable}
                id="scheduledAt"
                onChange={(event) =>
                  updateDraft({ scheduledAt: event.target.value })
                }
                required
                type="datetime-local"
                value={currentDraft.scheduledAt}
              />
            </div>
            <div>
              <label
                className="block text-sm font-medium"
                htmlFor="rulesetVersionId"
              >
                Ruleset
              </label>
              <select
                className="mt-2 min-h-12 w-full rounded-lg border border-[var(--line)] bg-white px-3"
                disabled={immutable}
                id="rulesetVersionId"
                onChange={(event) =>
                  updateDraft({ rulesetVersionId: event.target.value })
                }
                value={currentDraft.rulesetVersionId}
              >
                {rulesets.map((ruleset) => (
                  <option key={ruleset.id} value={ruleset.id}>
                    {ruleset.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium" htmlFor="location">
                Location{" "}
                <span className="font-normal text-[var(--muted)]">
                  (optional)
                </span>
              </label>
              <input
                className="mt-2 min-h-12 w-full rounded-lg border border-[var(--line)] bg-white px-3"
                disabled={immutable}
                id="location"
                maxLength={120}
                onChange={(event) =>
                  updateDraft({ location: event.target.value })
                }
                value={currentDraft.location}
              />
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label
                  className="block text-sm font-medium"
                  htmlFor="weatherCondition"
                >
                  Weather{" "}
                  <span className="font-normal text-[var(--muted)]">
                    (optional)
                  </span>
                </label>
                <select
                  className="mt-2 min-h-12 w-full rounded-lg border border-[var(--line)] bg-white px-3"
                  disabled={immutable}
                  id="weatherCondition"
                  onChange={(event) =>
                    updateDraft({
                      weatherCondition:
                        event.target.value.length > 0
                          ? (event.target
                              .value as (typeof WEATHER_CONDITIONS)[number])
                          : null,
                    })
                  }
                  value={currentDraft.weatherCondition ?? ""}
                >
                  <option value="">Not recorded</option>
                  {WEATHER_CONDITIONS.map((condition) => (
                    <option key={condition} value={condition}>
                      {formatLabel(condition)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  className="block text-sm font-medium"
                  htmlFor="temperatureF"
                >
                  Temperature °F{" "}
                  <span className="font-normal text-[var(--muted)]">
                    (optional)
                  </span>
                </label>
                <input
                  className="mt-2 min-h-12 w-full rounded-lg border border-[var(--line)] bg-white px-3"
                  disabled={immutable}
                  id="temperatureF"
                  max={130}
                  min={-20}
                  onChange={(event) =>
                    updateDraft({
                      temperatureF:
                        event.target.value.length > 0
                          ? Number(event.target.value)
                          : null,
                    })
                  }
                  type="number"
                  value={currentDraft.temperatureF ?? ""}
                />
              </div>
            </div>
          </div>
        ) : null}

        {step === "PARTICIPANTS" ? (
          <div className="space-y-5">
            <div>
              <h2 className="text-2xl font-semibold">Participants</h2>
              <p className="mt-2 text-sm text-[var(--muted)]">
                Choose the managed team’s side and a bounded managed or external
                opponent.
              </p>
            </div>
            <fieldset>
              <legend className="text-sm font-medium">
                {managedTeamName} is
              </legend>
              <div className="mt-2 flex flex-wrap gap-3">
                {(["HOME", "AWAY"] as const).map((side) => (
                  <label
                    className="flex min-h-12 items-center gap-3 rounded-lg border border-[var(--line)] px-4"
                    key={side}
                  >
                    <input
                      checked={currentDraft.managedSide === side}
                      disabled={immutable}
                      name="managedSide"
                      onChange={() => updateDraft({ managedSide: side })}
                      type="radio"
                    />
                    {side === "HOME" ? "Home" : "Away"}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="text-sm font-medium">Opponent type</legend>
              <div className="mt-2 flex flex-wrap gap-3">
                {(["MANAGED", "EXTERNAL"] as const).map((kind) => (
                  <label
                    className="flex min-h-12 items-center gap-3 rounded-lg border border-[var(--line)] px-4"
                    key={kind}
                  >
                    <input
                      checked={currentDraft.opponentKind === kind}
                      disabled={immutable}
                      name="opponentKind"
                      onChange={() => updateDraft({ opponentKind: kind })}
                      type="radio"
                    />
                    {kind === "MANAGED" ? "Managed team" : "External opponent"}
                  </label>
                ))}
              </div>
            </fieldset>
            {currentDraft.opponentKind === "MANAGED" ? (
              <div id="opponentTeamSeasonId">
                <label
                  className="block text-sm font-medium"
                  htmlFor="opponent-team"
                >
                  Managed opponent
                </label>
                <select
                  className="mt-2 min-h-12 w-full rounded-lg border border-[var(--line)] bg-white px-3"
                  disabled={immutable}
                  id="opponent-team"
                  onChange={(event) => {
                    const selected = teamSeasons.find(
                      ({ id }) => id === event.target.value,
                    );
                    updateDraft({
                      opponentTeamSeasonId: event.target.value || null,
                      opponentManagedLineup: selected?.roster ?? [],
                    });
                  }}
                  value={currentDraft.opponentTeamSeasonId ?? ""}
                >
                  <option value="">Choose an opponent</option>
                  {teamSeasons
                    .filter(({ id }) => id !== currentDraft.managedTeamSeasonId)
                    .map((teamSeason) => (
                      <option key={teamSeason.id} value={teamSeason.id}>
                        {teamSeason.teamName}
                      </option>
                    ))}
                </select>
              </div>
            ) : (
              <div id="externalOpponentName">
                <label
                  className="block text-sm font-medium"
                  htmlFor="external-opponent"
                >
                  External opponent name
                </label>
                <input
                  className="mt-2 min-h-12 w-full rounded-lg border border-[var(--line)] bg-white px-3"
                  disabled={immutable}
                  id="external-opponent"
                  maxLength={100}
                  onChange={(event) =>
                    updateDraft({ externalOpponentName: event.target.value })
                  }
                  value={currentDraft.externalOpponentName}
                />
                <p className="mt-2 text-xs text-[var(--muted)]">
                  Use only the team label needed for scorekeeping. Do not enter
                  contacts, notes, or private player details.
                </p>
              </div>
            )}
          </div>
        ) : null}

        {step === "LINEUP" ? (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-semibold">Lineup and defense</h2>
              <p className="mt-2 text-sm text-[var(--muted)]">
                Select active players, assign a contiguous batting order, set
                defense, and choose one starting pitcher for each side.
              </p>
            </div>
            <div id="managedLineup">
              <LineupFields
                heading={managedTeamName}
                immutable={immutable}
                onChange={(index, row) => {
                  const rows = [...currentDraft.managedLineup];
                  rows[index] = row as ManagedLineupRow;
                  updateDraft({ managedLineup: rows });
                }}
                onRowsChange={(rows) =>
                  updateDraft({
                    managedLineup: rows as ManagedLineupRow[],
                  })
                }
                rows={currentDraft.managedLineup}
              />
            </div>
            <div id="opponentLineup">
              {currentDraft.opponentKind === "MANAGED" ? (
                <LineupFields
                  heading={selectedOpponent?.teamName ?? "Managed opponent"}
                  immutable={immutable}
                  onChange={(index, row) => {
                    const rows = [...displayedOpponentLineup];
                    rows[index] = row as ManagedLineupRow;
                    updateDraft({ opponentManagedLineup: rows });
                  }}
                  onRowsChange={(rows) =>
                    updateDraft({
                      opponentManagedLineup: rows as ManagedLineupRow[],
                    })
                  }
                  rows={displayedOpponentLineup}
                />
              ) : (
                <>
                  <LineupFields
                    heading={
                      currentDraft.externalOpponentName || "External opponent"
                    }
                    immutable={immutable}
                    onChange={(index, row) => {
                      const rows = [...currentDraft.externalLineup];
                      rows[index] = row as ExternalLineupRow;
                      updateDraft({ externalLineup: rows });
                    }}
                    onRowsChange={(rows) =>
                      updateDraft({
                        externalLineup: rows as ExternalLineupRow[],
                      })
                    }
                    onRemove={(index) =>
                      updateDraft({
                        externalLineup: currentDraft.externalLineup.filter(
                          (_, candidateIndex) => candidateIndex !== index,
                        ),
                      })
                    }
                    rows={currentDraft.externalLineup}
                  />
                  <button
                    className="mt-3 min-h-12 rounded-lg border border-[var(--line)] bg-white px-4 font-medium"
                    disabled={immutable}
                    onClick={() =>
                      updateDraft({
                        externalLineup: [
                          ...currentDraft.externalLineup,
                          {
                            kind: "EXTERNAL",
                            clientId: crypto.randomUUID(),
                            displayName: "",
                            jerseyNumber: null,
                            battingOrder: null,
                            defensivePosition: null,
                            isStartingPitcher: false,
                          },
                        ],
                      })
                    }
                    type="button"
                  >
                    Add external player
                  </button>
                </>
              )}
            </div>
          </div>
        ) : null}

        {step === "REVIEW" ? (
          <div className="space-y-5">
            <div>
              <h2 className="text-2xl font-semibold">Review and readiness</h2>
              <p className="mt-2 text-sm text-[var(--muted)]">
                Readiness always validates the current authoritative proposal.
              </p>
            </div>
            <dl className="grid gap-3 rounded-lg bg-[var(--background)] p-4 sm:grid-cols-2">
              <div>
                <dt className="text-sm text-[var(--muted)]">Game</dt>
                <dd className="font-medium">
                  {currentDraft.managedSide === "HOME"
                    ? `${managedTeamName} vs ${
                        currentDraft.opponentKind === "MANAGED"
                          ? selectedOpponent?.teamName
                          : currentDraft.externalOpponentName
                      }`
                    : `${
                        currentDraft.opponentKind === "MANAGED"
                          ? selectedOpponent?.teamName
                          : currentDraft.externalOpponentName
                      } vs ${managedTeamName}`}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-[var(--muted)]">Date</dt>
                <dd className="font-medium">
                  {new Date(currentDraft.scheduledAt).toLocaleString()}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-[var(--muted)]">Managed lineup</dt>
                <dd className="font-medium">
                  {
                    currentDraft.managedLineup.filter(
                      ({ selected }) => selected,
                    ).length
                  }{" "}
                  selected
                </dd>
              </div>
              <div>
                <dt className="text-sm text-[var(--muted)]">Setup state</dt>
                <dd className="font-medium">{gameStatus.toLowerCase()}</dd>
              </div>
            </dl>
            {readyErrors.length > 0 ? (
              <div
                className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950"
                role="status"
              >
                <p className="font-semibold">Not ready yet</p>
                <ul className="mt-2 list-disc pl-5 text-sm">
                  {readyErrors.map((error, index) => (
                    <li key={`${error.field}-${index}`}>{error.message}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p
                className="rounded-lg border border-emerald-300 bg-emerald-50 p-4 font-medium text-emerald-950"
                role="status"
              >
                All client-side readiness checks pass. The server will perform
                authoritative domain validation.
              </p>
            )}
          </div>
        ) : null}
      </section>

      <div className="sticky bottom-0 mt-6 border-t border-[var(--line)] bg-[var(--background)]/95 py-4 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2">
            <button
              className="min-h-12 rounded-lg border border-[var(--line)] bg-white px-4 font-medium disabled:opacity-50"
              disabled={stepIndex === 0}
              onClick={() => setStep(SETUP_STEPS[stepIndex - 1] ?? step)}
              type="button"
            >
              Previous
            </button>
            <button
              className="min-h-12 rounded-lg border border-[var(--line)] bg-white px-4 font-medium disabled:opacity-50"
              disabled={stepIndex === SETUP_STEPS.length - 1}
              onClick={() => setStep(SETUP_STEPS[stepIndex + 1] ?? step)}
              type="button"
            >
              Next
            </button>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {!immutable ? (
              <button
                className="min-h-12 rounded-lg border border-[var(--accent)] bg-white px-4 font-semibold text-[var(--accent-strong)] disabled:opacity-50"
                disabled={
                  pending || (!dirty && currentDraft.expectedSetupRevision > 0)
                }
                name="intent"
                type="submit"
                value="SAVE"
              >
                {pending ? "Saving…" : "Save draft"}
              </button>
            ) : null}
            {step === "REVIEW" && !immutable ? (
              <button
                className="min-h-12 rounded-lg bg-[var(--accent)] px-4 font-semibold text-white disabled:opacity-50"
                disabled={pending || readyErrors.length > 0}
                name="intent"
                type="submit"
                value="READY"
              >
                Save and mark ready
              </button>
            ) : null}
            {gameStatus === "READY" ? (
              <button
                className="min-h-12 rounded-lg bg-slate-950 px-4 font-semibold text-white disabled:opacity-50"
                disabled={pending || dirty}
                name="intent"
                type="submit"
                value="START"
              >
                Start game
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </form>
  );
}
