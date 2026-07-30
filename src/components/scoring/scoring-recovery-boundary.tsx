"use client";

import {
  useActionState,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useRouter } from "next/navigation";

import {
  initialScoringRecoveryActionResult,
  recordRecoveredScoringAction,
} from "@/app/games/score/actions";
import {
  SCORING_DRAFT_CHANGED_EVENT,
  SCORING_DRAFT_KINDS,
  classifyRecoveryFailure,
  decideStoredDraft,
  parseStoredScoringDraft,
  scoringDraftStorageKey,
  shouldWarnForScoringNavigation,
  type RecoveryContext,
  type ScoringDraftKind,
  type ScoringRecoveryPhase,
  type StoredScoringDraft,
} from "@/features/scoring/scoring-recovery";

type RecoveryEntry = {
  key: string;
  kind: ScoringDraftKind;
  draft: StoredScoringDraft | null;
  phase: ScoringRecoveryPhase;
  message: string;
};

const labels: Record<ScoringDraftKind, string> = {
  PLATE_APPEARANCE: "plate appearance",
  RUNNER_PLAY: "runner-only play",
  LINEUP_CHANGE: "lineup or pitching change",
};

const subscribeOnline = (onChange: () => void) => {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
};

function entriesFromStorage(context: RecoveryContext): RecoveryEntry[] {
  const entries: RecoveryEntry[] = [];
  for (const kind of SCORING_DRAFT_KINDS) {
    const key = scoringDraftStorageKey(context.accountId, context.gameId, kind);
    let raw: string | null;
    try {
      raw = localStorage.getItem(key);
    } catch {
      entries.push({
        key,
        kind,
        draft: null,
        phase: "TERMINAL_REJECTION",
        message:
          "Browser storage is unavailable. Keep this page open until the action is accepted or discarded.",
      });
      continue;
    }
    if (!raw) continue;
    const parsed = parseStoredScoringDraft(raw);
    if (!parsed.ok) {
      entries.push({
        key,
        kind,
        draft: null,
        phase: "TERMINAL_REJECTION",
        message:
          parsed.reason === "OLD_SCHEMA"
            ? "This saved draft uses an old schema and cannot be retried."
            : "This saved draft is malformed or uses an unsupported event.",
      });
      continue;
    }
    const decision = decideStoredDraft(parsed.draft, context);
    if (decision.status === "ACCEPTED") {
      try {
        localStorage.removeItem(key);
      } catch {
        // Reconciliation remains server-authoritative even if local cleanup fails.
      }
      entries.push({
        key,
        kind,
        draft: parsed.draft,
        phase: "RECONCILED",
        message:
          "The server already accepted this action. The local draft was cleared.",
      });
      continue;
    }
    if (decision.status === "RECOVERABLE") {
      entries.push({
        key,
        kind,
        draft: parsed.draft,
        phase: "LOCALLY_PENDING",
        message:
          "Recovered an unaccepted draft at the current source revision.",
      });
      continue;
    }
    entries.push({
      key,
      kind,
      draft: parsed.draft,
      phase:
        decision.status === "STALE" ? "STALE_CONFLICT" : "TERMINAL_REJECTION",
      message:
        decision.status === "STALE"
          ? "State changed elsewhere. Reload and reconcile before recording another action."
          : "The saved draft no longer matches this Account, game, or accepted setup.",
    });
  }
  return entries;
}

export function ScoringRecoveryBoundary({
  context,
}: {
  context: RecoveryContext;
}) {
  const router = useRouter();
  const online = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
  const [entries, setEntries] = useState<RecoveryEntry[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const resilientAction = async (
    previous: typeof initialScoringRecoveryActionResult,
    formData: FormData,
  ) => {
    const storageKey = String(formData.get("storageKey") ?? "");
    setActiveKey(storageKey);
    let response: typeof initialScoringRecoveryActionResult;
    try {
      response = await recordRecoveredScoringAction(previous, formData);
    } catch {
      response = {
        status: "ERROR" as const,
        code: "NETWORK_FAILURE",
        message:
          "The connection failed before acceptance was confirmed. Retry the unchanged recovered action.",
      };
    }
    if (response.status === "SUCCESS") {
      try {
        localStorage.removeItem(storageKey);
      } catch {
        // The accepted submission identity still prevents a duplicate retry.
      }
      window.dispatchEvent(new Event(SCORING_DRAFT_CHANGED_EVENT));
      setEntries((current) =>
        current.map((entry) =>
          entry.key === storageKey
            ? {
                ...entry,
                phase: "RECONCILED",
                message: response.message,
              }
            : entry,
        ),
      );
      router.refresh();
    } else if (response.status === "ERROR") {
      setEntries((current) =>
        current.map((entry) =>
          entry.key === storageKey
            ? {
                ...entry,
                phase: classifyRecoveryFailure(response.code),
                message: response.message,
              }
            : entry,
        ),
      );
    }
    requestAnimationFrame(() => statusRef.current?.focus());
    return response;
  };
  const [, action, pending] = useActionState(
    resilientAction,
    initialScoringRecoveryActionResult,
  );

  useEffect(() => {
    const refreshEntries = () => setEntries(entriesFromStorage(context));
    refreshEntries();
    window.addEventListener("storage", refreshEntries);
    window.addEventListener(SCORING_DRAFT_CHANGED_EVENT, refreshEntries);
    return () => {
      window.removeEventListener("storage", refreshEntries);
      window.removeEventListener(SCORING_DRAFT_CHANGED_EVENT, refreshEntries);
    };
  }, [context]);

  const hasUnacceptedDraft = entries.some(
    ({ phase }) => phase !== "RECONCILED" && phase !== "ABANDONED_LOCAL_DRAFT",
  );

  useEffect(() => {
    if (!hasUnacceptedDraft) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const protectNavigation = (event: MouseEvent) => {
      const target = event.target as Element | null;
      const anchor = target?.closest("a");
      if (!anchor?.href) return;
      if (
        shouldWarnForScoringNavigation(
          window.location.href,
          anchor.href,
          hasUnacceptedDraft,
        ) &&
        !window.confirm(
          "An unaccepted scoring draft is saved on this device. Leave this page?",
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const refreshAfterResume = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", protectNavigation, true);
    document.addEventListener("visibilitychange", refreshAfterResume);
    window.addEventListener("pageshow", refreshAfterResume);
    window.addEventListener("online", refreshAfterResume);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", protectNavigation, true);
      document.removeEventListener("visibilitychange", refreshAfterResume);
      window.removeEventListener("pageshow", refreshAfterResume);
      window.removeEventListener("online", refreshAfterResume);
    };
  }, [hasUnacceptedDraft, router]);

  const discard = (entry: RecoveryEntry) => {
    try {
      localStorage.removeItem(entry.key);
    } catch {
      setEntries((current) =>
        current.map((candidate) =>
          candidate.key === entry.key
            ? {
                ...candidate,
                phase: "TERMINAL_REJECTION",
                message:
                  "Browser storage could not discard this draft. Storage access must be restored first.",
              }
            : candidate,
        ),
      );
      return;
    }
    window.dispatchEvent(new Event(SCORING_DRAFT_CHANGED_EVENT));
    setEntries((current) =>
      current.map((candidate) =>
        candidate.key === entry.key
          ? {
              ...candidate,
              draft: null,
              phase: "ABANDONED_LOCAL_DRAFT",
              message: "The local draft was discarded without server changes.",
            }
          : candidate,
      ),
    );
    requestAnimationFrame(() => statusRef.current?.focus());
  };

  return (
    <section
      aria-labelledby="recovery-heading"
      className="mt-6 rounded-xl border border-[var(--line)] bg-white p-4"
    >
      <div
        aria-live="polite"
        className="flex flex-wrap items-start justify-between gap-3"
        ref={statusRef}
        role="status"
        tabIndex={-1}
      >
        <div>
          <h2 className="font-semibold" id="recovery-heading">
            Save and recovery status
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {pending
              ? "Saving"
              : !online && hasUnacceptedDraft
                ? "Pending connection"
                : entries.some(({ phase }) => phase === "STALE_CONFLICT")
                  ? "State changed elsewhere"
                  : entries.some(
                        ({ phase }) =>
                          phase === "RETRYABLE_FAILURE" ||
                          phase === "TERMINAL_REJECTION",
                      )
                    ? "Needs attention"
                    : entries.some(({ phase }) => phase === "RECONCILED")
                      ? "Recovered"
                      : hasUnacceptedDraft
                        ? "Locally pending"
                        : "Saved"}
          </p>
        </div>
        <p className="text-sm text-[var(--muted)]">
          Authoritative revision {context.sourceRevision}
        </p>
      </div>

      {entries.length > 0 ? (
        <ul className="mt-4 space-y-3">
          {entries.map((entry) => {
            const retryable =
              entry.draft !== null &&
              (entry.phase === "LOCALLY_PENDING" ||
                entry.phase === "RETRYABLE_FAILURE");
            return (
              <li
                className="rounded-lg border border-[var(--line)] p-4"
                key={entry.key}
              >
                <p className="font-semibold">Recovered {labels[entry.kind]}</p>
                <p className="mt-1 text-sm">{entry.message}</p>
                {entry.draft ? (
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    Saved{" "}
                    {new Date(entry.draft.createdAt).toLocaleString(undefined, {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}{" "}
                    · expected revision {entry.draft.expectedSourceRevision}
                  </p>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-3">
                  {retryable ? (
                    <form action={action}>
                      <input
                        name="storageKey"
                        type="hidden"
                        value={entry.key}
                      />
                      <input
                        name="accountId"
                        type="hidden"
                        value={entry.draft!.accountId}
                      />
                      <input
                        name="gameId"
                        type="hidden"
                        value={entry.draft!.gameId}
                      />
                      <input
                        name="setupSnapshotId"
                        type="hidden"
                        value={entry.draft!.setupSnapshotId}
                      />
                      <input
                        name="expectedRevision"
                        type="hidden"
                        value={entry.draft!.expectedSourceRevision}
                      />
                      <input
                        name="clientSubmissionId"
                        type="hidden"
                        value={entry.draft!.idempotencyKey}
                      />
                      <input
                        name="body"
                        type="hidden"
                        value={JSON.stringify(entry.draft!.proposal)}
                      />
                      <button
                        className="min-h-11 rounded-lg bg-slate-950 px-4 font-semibold text-white disabled:opacity-50"
                        disabled={pending || !online}
                        type="submit"
                      >
                        {pending && activeKey === entry.key
                          ? "Saving…"
                          : "Retry unchanged action"}
                      </button>
                    </form>
                  ) : null}
                  {entry.phase === "STALE_CONFLICT" ? (
                    <button
                      className="min-h-11 rounded-lg border border-[var(--line)] px-4 font-semibold"
                      onClick={() => router.refresh()}
                      type="button"
                    >
                      Reload authoritative state
                    </button>
                  ) : null}
                  {entry.phase !== "RECONCILED" &&
                  entry.phase !== "ABANDONED_LOCAL_DRAFT" ? (
                    <button
                      className="min-h-11 rounded-lg border border-red-300 px-4 font-semibold text-red-800"
                      onClick={() => discard(entry)}
                      type="button"
                    >
                      Discard local draft
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-[var(--muted)]">
          No unaccepted action is stored on this device.
        </p>
      )}
    </section>
  );
}
