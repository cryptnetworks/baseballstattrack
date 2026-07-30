"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";

import { useRouter } from "next/navigation";

import {
  initialVerifyBoxScoreActionResult,
  verifyBoxScoreAction,
} from "@/app/games/[gameId]/box-score/actions";

type Props = {
  accountId: string;
  gameId: string;
  mode: "VERIFY" | "REVERIFY";
  setupSnapshotId: string;
  sourceRevision: number;
  submission: {
    eventId: string;
    playTransactionId: string;
    clientSubmissionId: string;
    recordedAt: string;
  };
};

function VerifyButton({ mode }: Pick<Props, "mode">) {
  const { pending } = useFormStatus();
  return (
    <button
      className="inline-flex min-h-11 items-center rounded-lg bg-[var(--accent-strong)] px-4 font-semibold text-white disabled:opacity-60"
      disabled={pending}
      type="submit"
    >
      {pending
        ? "Recording verification…"
        : mode === "REVERIFY"
          ? "Reverify corrected game"
          : "Verify game"}
    </button>
  );
}

export function BoxScoreVerificationPanel(props: Props) {
  const router = useRouter();
  const statusRef = useRef<HTMLParagraphElement>(null);
  const [state, action] = useActionState(
    verifyBoxScoreAction,
    initialVerifyBoxScoreActionResult,
  );
  useEffect(() => {
    if (state.status === "ERROR") statusRef.current?.focus();
    if (state.status === "SUCCESS") router.refresh();
  }, [router, state.status]);
  return (
    <form
      action={action}
      aria-labelledby="verification-action-heading"
      className="rounded-xl border border-amber-300 bg-amber-50 p-4"
    >
      <input name="accountId" type="hidden" value={props.accountId} />
      <input name="gameId" type="hidden" value={props.gameId} />
      <input
        name="setupSnapshotId"
        type="hidden"
        value={props.setupSnapshotId}
      />
      <input
        name="expectedRevision"
        type="hidden"
        value={props.sourceRevision}
      />
      <input name="eventId" type="hidden" value={props.submission.eventId} />
      <input
        name="playTransactionId"
        type="hidden"
        value={props.submission.playTransactionId}
      />
      <input
        name="clientSubmissionId"
        type="hidden"
        value={props.submission.clientSubmissionId}
      />
      <input
        name="recordedAt"
        type="hidden"
        value={props.submission.recordedAt}
      />
      <input name="mode" type="hidden" value={props.mode} />
      <h2
        className="font-semibold text-amber-950"
        id="verification-action-heading"
      >
        {props.mode === "REVERIFY"
          ? "Reverification required"
          : "Verification available"}
      </h2>
      <p className="mt-2 text-sm text-amber-950">
        Confirm only after reviewing revision {props.sourceRevision}, its
        reconciliation checks, and every corrected or incomplete-state label.
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
          I confirm this report matches the authoritative game record.
        </span>
      </label>
      <div className="mt-4">
        <VerifyButton mode={props.mode} />
      </div>
      {state.message ? (
        <p
          className="mt-3 text-sm"
          ref={statusRef}
          role={state.status === "ERROR" ? "alert" : "status"}
          tabIndex={-1}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
