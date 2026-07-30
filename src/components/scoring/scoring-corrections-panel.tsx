"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";

import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  applyScoringCorrectionAction,
  initialCorrectionApplyActionResult,
  initialCorrectionPreviewActionResult,
  initialReopenGameActionResult,
  previewScoringCorrectionAction,
  reopenGameForCorrectionAction,
} from "@/app/games/score/actions";
import {
  correctionReasonCodes,
  type CorrectionAuditEntry,
  type RecentPlaySummary,
} from "@/features/scoring/scoring-corrections";

type StableSubmissionIds = {
  eventId: string;
  playTransactionId: string;
  idempotencyKey: string;
  replacementId: string;
  recordedAt: string;
};

type Props = {
  accountId: string;
  audit: CorrectionAuditEntry[];
  gameId: string;
  gameStatus: string;
  history: RecentPlaySummary[];
  page: number;
  pageCount: number;
  playerNames: Record<string, string>;
  setupSnapshotId: string;
  sourceRevision: number;
  submission: StableSubmissionIds;
};

function label(value: string) {
  return value.replaceAll("_", " ").toLowerCase();
}

function timestamp(value: string) {
  return `${value.slice(0, 10)} ${value.slice(11, 19)} UTC`;
}

function HiddenContext({
  accountId,
  gameId,
  setupSnapshotId,
  sourceRevision,
}: Pick<Props, "accountId" | "gameId" | "setupSnapshotId" | "sourceRevision">) {
  return (
    <>
      <input name="accountId" type="hidden" value={accountId} />
      <input name="gameId" type="hidden" value={gameId} />
      <input name="setupSnapshotId" type="hidden" value={setupSnapshotId} />
      <input name="expectedRevision" type="hidden" value={sourceRevision} />
    </>
  );
}

function SubmitButton({
  children,
  pendingLabel,
}: {
  children: React.ReactNode;
  pendingLabel: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--accent-strong)] px-4 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
      disabled={pending}
      type="submit"
    >
      {pending ? pendingLabel : children}
    </button>
  );
}

function PreviewChanges({
  playerNames,
  preview,
}: {
  playerNames: Props["playerNames"];
  preview: NonNullable<
    Extract<
      Awaited<ReturnType<typeof previewScoringCorrectionAction>>,
      { status: "PREVIEW" }
    >["preview"]
  >;
}) {
  const groups = [
    ["Batting", preview.changedBatting],
    ["Pitching", preview.changedPitching],
    ["Fielding", preview.changedFielding],
  ] as const;
  return (
    <div className="mt-5 rounded-xl border-2 border-amber-400 bg-amber-50 p-4">
      <p className="font-semibold text-amber-950">
        Preview only — no correction has been accepted
      </p>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-sm font-semibold">Score</dt>
          <dd>
            Away {preview.score.before.AWAY}–{preview.score.before.HOME} Home
            {" → "}Away {preview.score.after.AWAY}–{preview.score.after.HOME}{" "}
            Home
          </dd>
        </div>
        <div>
          <dt className="text-sm font-semibold">Game situation</dt>
          <dd>
            {preview.situation.before}
            {" → "}
            {preview.situation.after}
          </dd>
        </div>
        <div>
          <dt className="text-sm font-semibold">Verification</dt>
          <dd>{label(preview.verificationEffect)}</dd>
        </div>
      </dl>
      {groups.map(([heading, lines]) =>
        lines.length ? (
          <div className="mt-4" key={heading}>
            <h4 className="font-semibold">{heading} changes</h4>
            <ul className="mt-2 space-y-2">
              {lines.map((line) => (
                <li key={line.playerId}>
                  <span className="font-medium">
                    {playerNames[line.playerId] ?? line.playerId}:
                  </span>{" "}
                  {line.before} → {line.after}
                </li>
              ))}
            </ul>
          </div>
        ) : null,
      )}
    </div>
  );
}

export function ScoringCorrectionsPanel(props: Props) {
  const router = useRouter();
  const selectable = useMemo(
    () => props.history.filter(({ status }) => status === "CURRENT"),
    [props.history],
  );
  const [targetEventId, setTargetEventId] = useState(selectable[0]?.id ?? "");
  const [correctionAction, setCorrectionAction] = useState("REVERSE_EVENT");
  const selected = selectable.find(({ id }) => id === targetEventId);
  const [previewState, previewAction, previewPending] = useActionState(
    previewScoringCorrectionAction,
    initialCorrectionPreviewActionResult,
  );
  const [applyState, applyAction, applyPending] = useActionState(
    applyScoringCorrectionAction,
    initialCorrectionApplyActionResult,
  );
  const [reopenState, reopenAction, reopenPending] = useActionState(
    reopenGameForCorrectionAction,
    initialReopenGameActionResult,
  );
  const lifecycleAllowsCorrection = [
    "IN_PROGRESS",
    "COMPLETED",
    "CORRECTED",
  ].includes(props.gameStatus);

  useEffect(() => {
    if (applyState.status === "SUCCESS" || reopenState.status === "SUCCESS") {
      router.refresh();
    }
  }, [applyState.status, reopenState.status, router]);

  return (
    <section
      aria-labelledby="corrections-heading"
      className="mt-10 border-t border-[var(--line)] pt-8"
      id="scoring-corrections"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[var(--accent-strong)]">
            Account-scoped history
          </p>
          <h2 className="mt-1 text-2xl font-semibold" id="corrections-heading">
            Recent plays and corrections
          </h2>
          <p className="mt-2 max-w-3xl text-[var(--muted)]">
            Review human-readable accepted events. Correcting a play preserves
            the original and adds an immutable audit event.
          </p>
        </div>
        <p className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium">
          Revision {props.sourceRevision}
        </p>
      </div>

      {props.gameStatus === "VERIFIED" ? (
        <form
          action={reopenAction}
          aria-labelledby="reopen-heading"
          aria-busy={reopenPending}
          className="mt-5 rounded-xl border border-amber-300 bg-amber-50 p-4"
        >
          <HiddenContext {...props} />
          <input
            name="eventId"
            type="hidden"
            value={props.submission.eventId}
          />
          <input
            name="playTransactionId"
            type="hidden"
            value={props.submission.playTransactionId}
          />
          <input
            name="clientSubmissionId"
            type="hidden"
            value={props.submission.idempotencyKey}
          />
          <input
            name="recordedAt"
            type="hidden"
            value={props.submission.recordedAt}
          />
          <input name="reasonCode" type="hidden" value="SCORER_REVIEW" />
          <h3 className="font-semibold text-amber-950" id="reopen-heading">
            Reopen required
          </h3>
          <p className="mt-1 text-sm text-amber-950">
            Verified games cannot be corrected. Reopening explicitly invalidates
            verification and requires reverification after review.
          </p>
          <label className="mt-3 flex gap-3">
            <input
              className="mt-1 size-4"
              name="confirmed"
              required
              type="checkbox"
              value="yes"
            />
            <span>I understand this game must be verified again.</span>
          </label>
          <div className="mt-4">
            <SubmitButton pendingLabel="Reopening…">
              Reopen for correction
            </SubmitButton>
          </div>
          {reopenState.message ? (
            <p
              className="mt-3 text-sm"
              role={reopenState.status === "ERROR" ? "alert" : "status"}
            >
              {reopenState.message}
            </p>
          ) : null}
        </form>
      ) : null}

      <ol className="mt-6 space-y-3" start={props.page * 10 + 1}>
        {props.history.map((event) => (
          <li
            className="rounded-xl border border-[var(--line)] bg-white p-4"
            key={event.id}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-semibold">
                  #{event.sequence} ·{" "}
                  {event.half
                    ? `${event.half.toLowerCase()} ${event.inning}`
                    : "game event"}{" "}
                  · {event.baseballIdentity}
                </p>
                <p className="mt-1">{event.outcome}</p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs font-semibold">
                <span className="rounded-full bg-slate-100 px-2 py-1">
                  {label(event.status)}
                </span>
                <span className="rounded-full bg-slate-100 px-2 py-1">
                  {label(event.correctionState)}
                </span>
              </div>
            </div>
            {event.correctedOutcome ? (
              <div className="mt-3 rounded-lg bg-blue-50 p-3">
                <p className="text-sm font-semibold text-blue-950">
                  Corrected judgment
                </p>
                <p className="mt-1 text-blue-950">{event.correctedOutcome}</p>
                <p className="mt-2 text-xs text-blue-900">
                  Original retained above for audit.
                </p>
              </div>
            ) : null}
            <p className="mt-3 text-sm text-[var(--muted)]">
              Score effect: away {event.scoreEffect.AWAY >= 0 ? "+" : ""}
              {event.scoreEffect.AWAY}, home{" "}
              {event.scoreEffect.HOME >= 0 ? "+" : ""}
              {event.scoreEffect.HOME} · Out effect: +{event.outEffect} ·{" "}
              {event.actorReference} ·{" "}
              <time dateTime={event.acceptedAt}>
                {timestamp(event.acceptedAt)}
              </time>
            </p>
          </li>
        ))}
      </ol>
      {!props.history.length ? (
        <p className="mt-5 rounded-xl border border-[var(--line)] bg-white p-4">
          No correctable plays have been accepted yet.
        </p>
      ) : null}

      {props.pageCount > 1 ? (
        <nav
          aria-label="Recent play history pages"
          className="mt-5 flex items-center gap-3"
        >
          {props.page > 0 ? (
            <Link
              className="inline-flex min-h-11 items-center rounded-lg border border-[var(--line)] bg-white px-4 font-medium"
              href={`?correctionPage=${props.page}#scoring-corrections`}
            >
              Newer plays
            </Link>
          ) : null}
          <span className="text-sm text-[var(--muted)]">
            Page {props.page + 1} of {props.pageCount}
          </span>
          {props.page + 1 < props.pageCount ? (
            <Link
              className="inline-flex min-h-11 items-center rounded-lg border border-[var(--line)] bg-white px-4 font-medium"
              href={`?correctionPage=${props.page + 2}#scoring-corrections`}
            >
              Older plays
            </Link>
          ) : null}
        </nav>
      ) : null}

      {props.gameStatus !== "VERIFIED" &&
      !lifecycleAllowsCorrection &&
      selectable.length ? (
        <p
          className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950"
          role="status"
        >
          Corrections are unavailable while the game is{" "}
          {props.gameStatus.toLowerCase()}. Restore an eligible lifecycle state
          before previewing a change.
        </p>
      ) : null}

      {lifecycleAllowsCorrection && selectable.length ? (
        <form
          action={previewAction}
          aria-labelledby="correction-builder-heading"
          aria-busy={previewPending}
          className="mt-8 rounded-xl border border-[var(--line)] bg-white p-4 sm:p-6"
        >
          <HiddenContext {...props} />
          <input
            name="replacementId"
            type="hidden"
            value={props.submission.replacementId}
          />
          <h3 className="text-xl font-semibold" id="correction-builder-heading">
            Build a correction
          </h3>
          <p className="mt-2 text-sm text-[var(--muted)]">
            A valid preview does not grant authorization or accept the change.
          </p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="grid gap-2 font-medium">
              Recent event
              <select
                className="min-h-11 rounded-lg border border-[var(--line)] bg-white px-3"
                name="targetEventId"
                onChange={(event) => {
                  setTargetEventId(event.target.value);
                  setCorrectionAction("REVERSE_EVENT");
                }}
                required
                value={targetEventId}
              >
                {selectable.map((event) => (
                  <option key={event.id} value={event.id}>
                    #{event.sequence} · {event.baseballIdentity} ·{" "}
                    {event.outcome}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-2 font-medium">
              Correction action
              <select
                className="min-h-11 rounded-lg border border-[var(--line)] bg-white px-3"
                name="action"
                onChange={(event) => setCorrectionAction(event.target.value)}
                value={correctionAction}
              >
                <option value="REVERSE_EVENT">
                  Reverse this event without replacement
                </option>
                {selected?.canReplaceJudgment ? (
                  <option value="REPLACE_PLATE_JUDGMENT">
                    Replace plate-appearance judgment
                  </option>
                ) : null}
              </select>
            </label>
            {correctionAction === "REPLACE_PLATE_JUDGMENT" ? (
              <>
                <label className="grid gap-2 font-medium">
                  Replacement outcome
                  <select
                    className="min-h-11 rounded-lg border border-[var(--line)] bg-white px-3"
                    name="replacementOutcome"
                    required
                  >
                    {selected?.replacementOutcomes.map((outcome) => (
                      <option key={outcome} value={outcome}>
                        {label(outcome)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-2 font-medium">
                  Responsible fielder (required for reached on error)
                  <select
                    className="min-h-11 rounded-lg border border-[var(--line)] bg-white px-3"
                    name="errorFielderId"
                  >
                    <option value="">Not applicable</option>
                    {selected?.eligibleFielderIds.map((playerId) => (
                      <option key={playerId} value={playerId}>
                        {props.playerNames[playerId] ?? playerId}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : null}
            <label className="grid gap-2 font-medium sm:col-span-2">
              Reason
              <select
                className="min-h-11 rounded-lg border border-[var(--line)] bg-white px-3"
                name="reasonCode"
                required
              >
                <option value="">Select a reason</option>
                {correctionReasonCodes.map((reason) => (
                  <option key={reason} value={reason}>
                    {label(reason)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-5">
            <SubmitButton pendingLabel="Calculating preview…">
              Preview downstream impact
            </SubmitButton>
          </div>
          {previewState.status === "ERROR" ? (
            <p className="mt-4 text-sm text-red-700" role="alert">
              {previewState.message}
            </p>
          ) : null}
        </form>
      ) : null}

      {previewState.status === "PREVIEW" ? (
        <div>
          <PreviewChanges
            playerNames={props.playerNames}
            preview={previewState.preview}
          />
          <form
            action={applyAction}
            aria-label="Confirm scoring correction"
            aria-busy={applyPending}
            className="mt-4 rounded-xl border border-[var(--line)] bg-white p-4"
          >
            <HiddenContext {...props} />
            <input
              name="targetEventId"
              type="hidden"
              value={previewState.draft.targetEventId}
            />
            <input
              name="action"
              type="hidden"
              value={previewState.draft.action}
            />
            <input
              name="replacementOutcome"
              type="hidden"
              value={previewState.draft.replacementOutcome ?? ""}
            />
            <input
              name="errorFielderId"
              type="hidden"
              value={previewState.draft.errorFielderId ?? ""}
            />
            <input
              name="reasonCode"
              type="hidden"
              value={previewState.draft.reasonCode}
            />
            <input
              name="replacementId"
              type="hidden"
              value={previewState.draft.replacementId}
            />
            <input
              name="eventId"
              type="hidden"
              value={props.submission.eventId}
            />
            <input
              name="playTransactionId"
              type="hidden"
              value={props.submission.playTransactionId}
            />
            <input
              name="idempotencyKey"
              type="hidden"
              value={props.submission.idempotencyKey}
            />
            <input
              name="recordedAt"
              type="hidden"
              value={props.submission.recordedAt}
            />
            <p className="font-semibold">
              Confirm revision {previewState.preview.sourceRevision} correction
            </p>
            <label className="mt-3 flex gap-3">
              <input
                className="mt-1 size-4"
                name="confirmed"
                required
                type="checkbox"
                value="yes"
              />
              <span>
                I reviewed this preview and understand the original remains in
                the audit history.
              </span>
            </label>
            <div className="mt-4">
              <SubmitButton pendingLabel="Accepting correction…">
                Accept correction
              </SubmitButton>
            </div>
            {applyState.message ? (
              <p
                className={`mt-4 text-sm ${
                  applyState.status === "ERROR"
                    ? "text-red-700"
                    : "text-emerald-800"
                }`}
                role={applyState.status === "ERROR" ? "alert" : "status"}
              >
                {applyState.message}
                {applyState.status === "SUCCESS" &&
                applyState.verificationStatus === "UNVERIFIED"
                  ? " Verification or reverification is required."
                  : ""}
              </p>
            ) : null}
          </form>
        </div>
      ) : null}

      <section
        aria-labelledby="correction-audit-heading"
        className="mt-8 rounded-xl bg-slate-950 p-4 text-white sm:p-6"
      >
        <h3 className="text-xl font-semibold" id="correction-audit-heading">
          Correction audit
        </h3>
        <p className="mt-2 text-sm text-slate-300">
          Baseball-history attribution only. Security audit records remain
          separate and are not exposed here.
        </p>
        {props.audit.length ? (
          <ol className="mt-4 space-y-3">
            {props.audit.map((entry) => (
              <li
                className="rounded-lg border border-slate-700 p-3"
                key={entry.correctionEventId}
              >
                <p className="font-semibold">
                  Revision {entry.sourceRevision.before} →{" "}
                  {entry.sourceRevision.after} · {label(entry.reasonCode)}
                </p>
                <p className="mt-1 text-sm text-slate-300">
                  Targets: {entry.targetEventIds.join(", ")} ·{" "}
                  {entry.actorReference} ·{" "}
                  <time dateTime={entry.occurredAt}>
                    {timestamp(entry.occurredAt)}
                  </time>
                </p>
                <p className="mt-1 text-sm text-slate-300">
                  {label(entry.verificationEffect)} · {label(entry.status)}
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-4 text-slate-300">No corrections accepted.</p>
        )}
      </section>
    </section>
  );
}
