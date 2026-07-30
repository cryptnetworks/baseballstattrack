"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import {
  SCORING_DRAFT_CHANGED_EVENT,
  createStoredScoringDraft,
  idempotencyKeyForProposal,
  scoringDraftStorageKey,
  serializeStoredScoringDraft,
  parseStoredScoringDraft,
  storedDraftBlocksNewEditor,
  type RecoverableScoringBody,
  type ScoringDraftKind,
  type ScoringRecoveryPhase,
} from "@/features/scoring/scoring-recovery";

const subscribeDraftChanges = (onChange: () => void) => {
  window.addEventListener("storage", onChange);
  window.addEventListener(SCORING_DRAFT_CHANGED_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(SCORING_DRAFT_CHANGED_EVENT, onChange);
  };
};

export function useScoringDraft({
  kind,
  accountId,
  gameId,
  setupSnapshotId,
  setupRevision,
  sourceRevision,
  initialClientSubmissionId,
  proposal,
  engaged,
  pending,
  resultStatus,
}: {
  kind: ScoringDraftKind;
  accountId: string;
  gameId: string;
  setupSnapshotId: string;
  setupRevision: number;
  sourceRevision: number;
  initialClientSubmissionId: string;
  proposal: RecoverableScoringBody | null;
  engaged: boolean;
  pending: boolean;
  resultStatus: "IDLE" | "SUCCESS" | "ERROR";
}) {
  const [clientSubmissionId, setClientSubmissionId] = useState(
    initialClientSubmissionId,
  );
  const priorProposal = useRef<string | null>(null);
  const createdAt = useRef<string | null>(null);
  const storageKey = scoringDraftStorageKey(accountId, gameId, kind);
  const storedValue = useSyncExternalStore(
    subscribeDraftChanges,
    () => {
      try {
        return localStorage.getItem(storageKey);
      } catch {
        return null;
      }
    },
    () => null,
  );
  const stored = storedValue ? parseStoredScoringDraft(storedValue) : null;
  const blockedByRecoveredDraft = storedDraftBlocksNewEditor(
    storedValue,
    clientSubmissionId,
  );
  const proposalFingerprint = proposal ? JSON.stringify(proposal) : null;
  const draftReady =
    !engaged ||
    proposal === null ||
    (stored?.ok === true &&
      stored.draft.idempotencyKey === clientSubmissionId &&
      JSON.stringify(stored.draft.proposal) === proposalFingerprint);

  useEffect(() => {
    if (resultStatus !== "SUCCESS") return;
    try {
      localStorage.removeItem(storageKey);
    } catch {
      return;
    }
    window.dispatchEvent(new Event(SCORING_DRAFT_CHANGED_EVENT));
  }, [resultStatus, storageKey]);

  useEffect(() => {
    if (!engaged || !proposal || resultStatus === "SUCCESS") return;
    const serializedProposal = JSON.stringify(proposal);
    const proposalSubmissionId = idempotencyKeyForProposal(
      priorProposal.current,
      serializedProposal,
      clientSubmissionId,
      () => crypto.randomUUID(),
    );
    if (proposalSubmissionId !== clientSubmissionId) {
      priorProposal.current = serializedProposal;
      createdAt.current = null;
      setClientSubmissionId(proposalSubmissionId);
    }
    if (blockedByRecoveredDraft) return;
    priorProposal.current = serializedProposal;
    createdAt.current ??= new Date().toISOString();
    const draft = createStoredScoringDraft({
      kind,
      accountId,
      gameId,
      setupSnapshotId,
      setupRevision,
      expectedSourceRevision: sourceRevision,
      idempotencyKey: proposalSubmissionId,
      proposal,
      createdAt: createdAt.current,
    });
    try {
      localStorage.setItem(storageKey, serializeStoredScoringDraft(draft));
    } catch {
      return;
    }
    window.dispatchEvent(new Event(SCORING_DRAFT_CHANGED_EVENT));
  }, [
    accountId,
    blockedByRecoveredDraft,
    clientSubmissionId,
    engaged,
    gameId,
    kind,
    proposal,
    resultStatus,
    setupRevision,
    setupSnapshotId,
    sourceRevision,
    storageKey,
  ]);

  const abandon = () => {
    try {
      localStorage.removeItem(storageKey);
    } catch {
      return;
    }
    window.dispatchEvent(new Event(SCORING_DRAFT_CHANGED_EVENT));
  };
  const phase: ScoringRecoveryPhase = pending
    ? "SUBMITTING"
    : resultStatus === "SUCCESS"
      ? "ACCEPTED"
      : resultStatus === "ERROR"
        ? "RETRYABLE_FAILURE"
        : engaged
          ? "LOCALLY_PENDING"
          : "EDITING";

  return {
    clientSubmissionId,
    storageKey,
    abandon,
    phase,
    blockedByRecoveredDraft,
    draftReady,
  };
}
