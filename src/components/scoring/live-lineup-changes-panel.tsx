"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import {
  initialLineupChangeActionResult,
  recordLineupChangeAction,
} from "@/app/games/score/actions";
import type {
  BaseballPosition,
  GameSide,
  GameState,
} from "@/domain/events/event-log";
import {
  BASEBALL_POSITIONS,
  battingSide,
  fieldingSide,
  positionLabel,
  previewAlignmentSwap,
  previewPitchingChange,
  previewSubstitution,
  type LineupChangePreview,
} from "@/features/scoring/live-lineup-changes";
import {
  currentBatterId,
  nextBatterId,
} from "@/features/scoring/plate-appearance";
import { useScoringDraft } from "@/features/scoring/use-scoring-draft";

type ChangeMode = "BATTING" | "DEFENSE" | "ALIGNMENT" | "PITCHING";

const modeOptions = [
  { value: "BATTING", label: "Batter / runner" },
  { value: "DEFENSE", label: "Defensive replacement" },
  { value: "ALIGNMENT", label: "Position swap" },
  { value: "PITCHING", label: "Pitching change" },
] as const satisfies readonly { value: ChangeMode; label: string }[];

function emptyPreview(message: string): LineupChangePreview {
  return {
    body: null,
    nextState: null,
    errors: [message],
    warnings: [],
    label: "Incomplete lineup change",
  };
}

function activePlayers(state: GameState, side: GameSide) {
  return state.lineups[side].filter(({ active }) => active);
}

function unusedPlayers(state: GameState, side: GameSide) {
  return state.lineups[side].filter(
    ({ active, playerId }) =>
      !active && !state.participatedPlayers[side].includes(playerId),
  );
}

function playerOptionLabel(
  playerNames: Record<string, string>,
  entry: GameState["lineups"][GameSide][number],
) {
  const order =
    entry.battingOrder === null
      ? "no batting slot"
      : `slot ${entry.battingOrder}`;
  return `${playerNames[entry.playerId] ?? entry.playerId} · ${order} · ${positionLabel(entry.position)}`;
}

function LineupPreview({
  heading,
  state,
  side,
  playerNames,
}: {
  heading: string;
  state: GameState;
  side: GameSide;
  playerNames: Record<string, string>;
}) {
  const lineup = activePlayers(state, side).sort((left, right) => {
    if (left.battingOrder === null) return 1;
    if (right.battingOrder === null) return -1;
    return left.battingOrder - right.battingOrder;
  });
  return (
    <section
      aria-label={heading}
      className="rounded-xl border border-[var(--line)] bg-white p-4"
    >
      <h4 className="font-semibold">{heading}</h4>
      <ul className="mt-3 space-y-2 text-sm">
        {lineup.map((entry) => (
          <li
            className="flex items-start justify-between gap-3 border-t border-[var(--line)] pt-2 first:border-0 first:pt-0"
            key={entry.playerId}
          >
            <span>
              {entry.battingOrder === null ? "—" : entry.battingOrder}.{" "}
              {playerNames[entry.playerId] ?? entry.playerId}
            </span>
            <span className="text-right text-[var(--muted)]">
              {positionLabel(entry.position)}
              {state.activePitcher[side] === entry.playerId
                ? " · active pitcher"
                : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function LiveLineupChangesPanel({
  accountId,
  gameId,
  setupSnapshotId,
  state,
  playerNames,
  initialClientSubmissionId,
}: {
  accountId: string;
  gameId: string;
  setupSnapshotId: string;
  state: GameState;
  playerNames: Record<string, string>;
  initialClientSubmissionId: string;
}) {
  const offense = battingSide(state);
  const defense = fieldingSide(state);
  const firstOffense = currentBatterId(state);
  const firstDefender =
    activePlayers(state, defense).find(
      ({ playerId }) => playerId !== state.activePitcher[defense],
    )?.playerId ?? "";
  const firstInactiveOffense = unusedPlayers(state, offense)[0]?.playerId ?? "";
  const firstInactiveDefense = unusedPlayers(state, defense)[0]?.playerId ?? "";
  const movableDefenders = activePlayers(state, defense).filter(
    ({ position, playerId }) =>
      position !== null && playerId !== state.activePitcher[defense],
  );
  const outgoingPitcher = state.lineups[defense].find(
    ({ playerId }) => playerId === state.activePitcher[defense],
  );
  const pitchingCandidates = state.lineups[defense]
    .filter(
      ({ active, battingOrder, playerId, position: candidatePosition }) =>
        playerId !== state.activePitcher[defense] &&
        (active || !state.participatedPlayers[defense].includes(playerId)) &&
        !(
          active &&
          candidatePosition === null &&
          outgoingPitcher?.battingOrder !== null &&
          battingOrder !== null
        ),
    )
    .sort((left, right) => {
      const priority = (entry: (typeof state.lineups)[GameSide][number]) =>
        !entry.active ? 0 : entry.battingOrder === null ? 1 : 2;
      return priority(left) - priority(right);
    });
  const [mode, setMode] = useState<ChangeMode>("BATTING");
  const [outgoing, setOutgoing] = useState(firstOffense);
  const [incoming, setIncoming] = useState(firstInactiveOffense);
  const [position, setPosition] = useState<BaseballPosition>(
    state.lineups[offense].find(({ playerId }) => playerId === firstOffense)
      ?.position ?? "DESIGNATED_HITTER",
  );
  const [firstSwap, setFirstSwap] = useState(
    movableDefenders[0]?.playerId ?? "",
  );
  const [secondSwap, setSecondSwap] = useState(
    movableDefenders[1]?.playerId ?? "",
  );
  const [incomingPitcher, setIncomingPitcher] = useState(
    pitchingCandidates[0]?.playerId ?? "",
  );
  const [engaged, setEngaged] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const resilientAction = async (
    previous: typeof initialLineupChangeActionResult,
    formData: FormData,
  ) => {
    try {
      return await recordLineupChangeAction(previous, formData);
    } catch {
      return {
        status: "ERROR" as const,
        code: "NETWORK_FAILURE",
        message:
          "Acceptance could not be confirmed. Retry the unchanged change to reuse its submission identity.",
      };
    }
  };
  const [result, action, pending] = useActionState(
    resilientAction,
    initialLineupChangeActionResult,
  );
  const statusRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (result.status !== "IDLE") statusRef.current?.focus();
  }, [result]);

  const side = mode === "BATTING" ? offense : defense;
  const preview =
    mode === "PITCHING"
      ? incomingPitcher
        ? previewPitchingChange(state, incomingPitcher)
        : emptyPreview("Select the incoming pitcher.")
      : mode === "ALIGNMENT"
        ? firstSwap && secondSwap
          ? previewAlignmentSwap(state, {
              side: defense,
              firstPlayerId: firstSwap,
              secondPlayerId: secondSwap,
            })
          : emptyPreview("Select two active defenders.")
        : outgoing && incoming
          ? previewSubstitution(state, {
              side,
              outgoingPlayerId: outgoing,
              incomingPlayerId: incoming,
              position,
            })
          : emptyPreview("Select the leaving and entering players.");
  const { clientSubmissionId, abandon, blockedByRecoveredDraft, draftReady } =
    useScoringDraft({
      kind: "LINEUP_CHANGE",
      accountId,
      gameId,
      setupSnapshotId,
      setupRevision: state.setupRevision,
      sourceRevision: state.sourceRevision,
      initialClientSubmissionId,
      proposal: preview.body,
      engaged,
      pending,
      resultStatus: result.status,
    });
  const locked =
    pending || result.status === "ERROR" || blockedByRecoveredDraft;

  const chooseMode = (nextMode: ChangeMode) => {
    setMode(nextMode);
    setEngaged(true);
    setConfirmed(false);
    if (nextMode === "BATTING") {
      const player = state.lineups[offense].find(
        ({ playerId }) => playerId === firstOffense,
      );
      setOutgoing(firstOffense);
      setIncoming(firstInactiveOffense);
      setPosition(player?.position ?? "DESIGNATED_HITTER");
    }
    if (nextMode === "DEFENSE") {
      const player = state.lineups[defense].find(
        ({ playerId }) => playerId === firstDefender,
      );
      setOutgoing(firstDefender);
      setIncoming(firstInactiveDefense);
      setPosition(player?.position ?? "CATCHER");
    }
  };

  const selectOutgoing = (playerId: string) => {
    setOutgoing(playerId);
    setEngaged(true);
    const player = state.lineups[side].find(
      ({ playerId: candidate }) => candidate === playerId,
    );
    if (player?.position && player.position !== "PITCHER") {
      setPosition(player.position);
    }
    setConfirmed(false);
  };

  const discardFailedChange = () => {
    abandon();
    setConfirmed(false);
    window.location.reload();
  };

  const currentBatter = currentBatterId(state);
  const onDeck = nextBatterId(state);
  const player = (playerId: string) => playerNames[playerId] ?? playerId;
  const outgoingPlayer =
    mode === "PITCHING"
      ? state.activePitcher[defense]
      : mode === "ALIGNMENT"
        ? firstSwap
        : outgoing;
  const incomingPlayer =
    mode === "PITCHING"
      ? incomingPitcher
      : mode === "ALIGNMENT"
        ? secondSwap
        : incoming;

  return (
    <section
      aria-labelledby="lineup-changes-heading"
      className="mt-10 border-t border-[var(--line)] pt-8"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold" id="lineup-changes-heading">
            Lineup and pitching changes
          </h2>
          <p className="mt-2 max-w-3xl text-[var(--muted)]">
            Preview one typed change against the current inning, lineup,
            defense, and source revision before recording it.
          </p>
        </div>
        <p className="text-sm text-[var(--muted)]">
          Effective {state.half?.toLowerCase()} {state.inning}, {state.outs}{" "}
          outs · revision {state.sourceRevision}
        </p>
      </div>

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
            ? "Saving lineup change"
            : result.status === "ERROR" || blockedByRecoveredDraft
              ? "Change not confirmed"
              : engaged
                ? "Locally pending lineup change"
                : "No pending lineup change"}
        </p>
        <p className="mt-1 text-sm">
          {blockedByRecoveredDraft
            ? "Resolve the recovered lineup-change draft above before starting another."
            : result.message ||
              `Current batter: ${player(currentBatter)}. On deck: ${player(onDeck)}. Active pitcher: ${player(state.activePitcher[defense])}.`}
        </p>
      </div>

      <fieldset className="mt-5" disabled={locked}>
        <legend className="font-semibold">Change type</legend>
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {modeOptions.map((option) => (
            <button
              aria-pressed={mode === option.value}
              className={`min-h-12 rounded-xl border px-3 text-left font-semibold ${
                mode === option.value
                  ? "border-[var(--accent)] bg-emerald-50 text-[var(--accent-strong)]"
                  : "border-[var(--line)] bg-white"
              }`}
              key={option.value}
              onClick={() => chooseMode(option.value)}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>

        {mode === "BATTING" || mode === "DEFENSE" ? (
          <div className="mt-5 grid gap-4 rounded-xl border border-[var(--line)] bg-white p-4 sm:grid-cols-3">
            <label className="text-sm font-medium">
              Player leaving
              <select
                className="mt-2 min-h-12 w-full rounded-lg border border-[var(--line)] bg-white px-3"
                onChange={(event) => selectOutgoing(event.target.value)}
                value={outgoing}
              >
                {activePlayers(state, side)
                  .filter(
                    ({ playerId }) => playerId !== state.activePitcher[side],
                  )
                  .map((entry) => (
                    <option key={entry.playerId} value={entry.playerId}>
                      {playerOptionLabel(playerNames, entry)}
                    </option>
                  ))}
              </select>
            </label>
            <label className="text-sm font-medium">
              Eligible unused player entering
              <select
                className="mt-2 min-h-12 w-full rounded-lg border border-[var(--line)] bg-white px-3"
                onChange={(event) => {
                  setIncoming(event.target.value);
                  setEngaged(true);
                  setConfirmed(false);
                }}
                value={incoming}
              >
                {unusedPlayers(state, side).map((entry) => (
                  <option key={entry.playerId} value={entry.playerId}>
                    {playerOptionLabel(playerNames, entry)}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium">
              Resulting role
              <select
                className="mt-2 min-h-12 w-full rounded-lg border border-[var(--line)] bg-white px-3"
                onChange={(event) => {
                  setPosition(event.target.value as BaseballPosition);
                  setEngaged(true);
                  setConfirmed(false);
                }}
                value={position}
              >
                {BASEBALL_POSITIONS.filter(
                  (candidate) => candidate !== "PITCHER",
                ).map((candidate) => (
                  <option key={candidate} value={candidate}>
                    {positionLabel(candidate)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}

        {mode === "ALIGNMENT" ? (
          <div className="mt-5 grid gap-4 rounded-xl border border-[var(--line)] bg-white p-4 sm:grid-cols-2">
            <label className="text-sm font-medium">
              First defender
              <select
                className="mt-2 min-h-12 w-full rounded-lg border border-[var(--line)] bg-white px-3"
                onChange={(event) => {
                  setFirstSwap(event.target.value);
                  setEngaged(true);
                  setConfirmed(false);
                }}
                value={firstSwap}
              >
                {movableDefenders.map((entry) => (
                  <option key={entry.playerId} value={entry.playerId}>
                    {playerOptionLabel(playerNames, entry)}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium">
              Second defender
              <select
                className="mt-2 min-h-12 w-full rounded-lg border border-[var(--line)] bg-white px-3"
                onChange={(event) => {
                  setSecondSwap(event.target.value);
                  setEngaged(true);
                  setConfirmed(false);
                }}
                value={secondSwap}
              >
                {movableDefenders.map((entry) => (
                  <option key={entry.playerId} value={entry.playerId}>
                    {playerOptionLabel(playerNames, entry)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}

        {mode === "PITCHING" ? (
          <div className="mt-5 grid gap-4 rounded-xl border border-[var(--line)] bg-white p-4 sm:grid-cols-2">
            <div>
              <p className="text-sm text-[var(--muted)]">Pitcher leaving</p>
              <p className="font-semibold">
                {player(state.activePitcher[defense])}
              </p>
              <p className="mt-2 text-sm text-[var(--muted)]">
                {Object.values(state.bases).filter(Boolean).length} inherited
                runners · {state.outs} outs · batter {player(currentBatter)}
              </p>
            </div>
            <label className="text-sm font-medium">
              Eligible pitcher entering
              <select
                className="mt-2 min-h-12 w-full rounded-lg border border-[var(--line)] bg-white px-3"
                onChange={(event) => {
                  setIncomingPitcher(event.target.value);
                  setEngaged(true);
                  setConfirmed(false);
                }}
                value={incomingPitcher}
              >
                {pitchingCandidates.map((entry) => (
                  <option key={entry.playerId} value={entry.playerId}>
                    {playerOptionLabel(playerNames, entry)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}
      </fieldset>

      <div className="mt-5 rounded-xl border border-[var(--line)] bg-white p-4">
        <p className="text-sm text-[var(--muted)]">Proposed change</p>
        <p className="mt-1 font-semibold">{preview.label}</p>
        <p className="mt-1 text-sm">
          {player(outgoingPlayer)} → {player(incomingPlayer)}
        </p>
        {preview.warnings.map((warning) => (
          <p className="mt-2 text-sm text-amber-900" key={warning}>
            Warning: {warning}
          </p>
        ))}
      </div>

      {preview.nextState ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <LineupPreview
            heading="Authoritative before"
            playerNames={playerNames}
            side={side}
            state={state}
          />
          <LineupPreview
            heading="Resulting lineup and defense"
            playerNames={playerNames}
            side={side}
            state={preview.nextState}
          />
        </div>
      ) : null}

      {preview.errors.length > 0 ? (
        <div
          className="mt-4 rounded-xl border border-red-300 bg-red-50 p-4 text-red-950"
          role="alert"
        >
          <p className="font-semibold">Change cannot be recorded</p>
          <ul className="mt-2 list-disc pl-5 text-sm">
            {preview.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}

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
        <label className="flex min-h-12 items-center gap-3 rounded-xl border border-[var(--line)] bg-white px-4 text-sm font-medium">
          <input
            checked={confirmed}
            disabled={locked || preview.body === null}
            onChange={(event) => {
              setEngaged(true);
              setConfirmed(event.target.checked);
            }}
            type="checkbox"
          />
          Confirm the leaving player, entering player, role, and effective game
          state shown above.
        </label>
        <div className="mt-3 flex flex-wrap gap-3">
          <button
            className="min-h-12 flex-1 rounded-lg bg-slate-950 px-5 font-semibold text-white disabled:opacity-50 sm:flex-none"
            disabled={
              pending ||
              blockedByRecoveredDraft ||
              !draftReady ||
              preview.body === null ||
              (!confirmed && result.status !== "ERROR")
            }
            type="submit"
          >
            {pending
              ? "Recording…"
              : result.status === "ERROR"
                ? "Retry unchanged change"
                : "Record confirmed change"}
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
                onClick={discardFailedChange}
                type="button"
              >
                Discard failed change
              </button>
            </>
          ) : null}
        </div>
      </form>
    </section>
  );
}
