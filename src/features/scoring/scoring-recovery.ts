import { z } from "zod";

import { parseEventBody, type EventBody } from "@/domain/events/event-log";

export const SCORING_DRAFT_SCHEMA_VERSION = 1 as const;
export const SCORING_DRAFT_STORAGE_PREFIX =
  "baseballstattrack:scoring-draft:v1";
export const SCORING_DRAFT_CHANGED_EVENT =
  "baseballstattrack:scoring-draft-changed";

export const SCORING_DRAFT_KINDS = [
  "PLATE_APPEARANCE",
  "RUNNER_PLAY",
  "LINEUP_CHANGE",
] as const;
export type ScoringDraftKind = (typeof SCORING_DRAFT_KINDS)[number];

export const SCORING_RECOVERY_PHASES = [
  "EDITING",
  "LOCALLY_PENDING",
  "SUBMITTING",
  "ACCEPTED",
  "RETRYABLE_FAILURE",
  "STALE_CONFLICT",
  "TERMINAL_REJECTION",
  "RECONCILED",
  "ABANDONED_LOCAL_DRAFT",
] as const;
export type ScoringRecoveryPhase = (typeof SCORING_RECOVERY_PHASES)[number];

export type RecoverableScoringBody = Extract<
  EventBody,
  {
    eventType:
      | "DefensiveAlignmentChanged"
      | "DefensiveSubstitutionMade"
      | "PitchingChangeMade"
      | "PlateAppearanceRecorded"
      | "RunnerPlayRecorded";
  }
>;

const id = z.string().trim().min(1).max(128);
const storedDraftEnvelope = z
  .object({
    schemaVersion: z.literal(SCORING_DRAFT_SCHEMA_VERSION),
    kind: z.enum(SCORING_DRAFT_KINDS),
    accountId: id,
    gameId: id,
    setupSnapshotId: id,
    setupRevision: z.int().positive(),
    expectedSourceRevision: z.int().nonnegative(),
    idempotencyKey: id,
    proposal: z.unknown(),
    createdAt: z.iso.datetime(),
  })
  .strict();

export type StoredScoringDraft = Omit<
  z.infer<typeof storedDraftEnvelope>,
  "proposal"
> & {
  proposal: RecoverableScoringBody;
};

export type RecoveryContext = {
  accountId: string;
  gameId: string;
  setupSnapshotId: string;
  setupRevision: number;
  sourceRevision: number;
  acceptedSubmissionIds: readonly string[];
};

export type ParsedStoredDraft =
  | { ok: true; draft: StoredScoringDraft }
  | {
      ok: false;
      reason: "MALFORMED" | "OLD_SCHEMA" | "UNSUPPORTED_EVENT";
    };

export type RecoveryDecision =
  | { status: "RECOVERABLE"; draft: StoredScoringDraft }
  | {
      status:
        "ACCEPTED" | "CROSS_ACCOUNT" | "WRONG_GAME" | "SETUP_CHANGED" | "STALE";
      draft: StoredScoringDraft;
    };

const eventTypes = new Set<RecoverableScoringBody["eventType"]>([
  "DefensiveAlignmentChanged",
  "DefensiveSubstitutionMade",
  "PitchingChangeMade",
  "PlateAppearanceRecorded",
  "RunnerPlayRecorded",
]);
const eventTypesByKind: Record<
  ScoringDraftKind,
  ReadonlySet<RecoverableScoringBody["eventType"]>
> = {
  PLATE_APPEARANCE: new Set(["PlateAppearanceRecorded"]),
  RUNNER_PLAY: new Set(["RunnerPlayRecorded"]),
  LINEUP_CHANGE: new Set([
    "DefensiveAlignmentChanged",
    "DefensiveSubstitutionMade",
    "PitchingChangeMade",
  ]),
};

export function scoringDraftStorageKey(
  accountId: string,
  gameId: string,
  kind: ScoringDraftKind,
) {
  return `${SCORING_DRAFT_STORAGE_PREFIX}:${accountId}:${gameId}:${kind}`;
}

export function parseStoredScoringDraft(raw: string): ParsedStoredDraft {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "MALFORMED" };
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "schemaVersion" in value &&
    value.schemaVersion !== SCORING_DRAFT_SCHEMA_VERSION
  ) {
    return { ok: false, reason: "OLD_SCHEMA" };
  }
  const envelope = storedDraftEnvelope.safeParse(value);
  if (!envelope.success) return { ok: false, reason: "MALFORMED" };
  let proposal: EventBody;
  try {
    proposal = parseEventBody(envelope.data.proposal);
  } catch {
    return { ok: false, reason: "UNSUPPORTED_EVENT" };
  }
  if (
    !eventTypes.has(
      proposal.eventType as RecoverableScoringBody["eventType"],
    ) ||
    !eventTypesByKind[envelope.data.kind].has(
      proposal.eventType as RecoverableScoringBody["eventType"],
    )
  ) {
    return { ok: false, reason: "UNSUPPORTED_EVENT" };
  }
  return {
    ok: true,
    draft: {
      ...envelope.data,
      proposal: proposal as RecoverableScoringBody,
    },
  };
}

export function createStoredScoringDraft(input: {
  kind: ScoringDraftKind;
  accountId: string;
  gameId: string;
  setupSnapshotId: string;
  setupRevision: number;
  expectedSourceRevision: number;
  idempotencyKey: string;
  proposal: RecoverableScoringBody;
  createdAt?: string;
}): StoredScoringDraft {
  const parsed = parseStoredScoringDraft(
    JSON.stringify({
      schemaVersion: SCORING_DRAFT_SCHEMA_VERSION,
      ...input,
      createdAt: input.createdAt ?? new Date().toISOString(),
    }),
  );
  if (!parsed.ok) throw new Error("Cannot persist an invalid scoring draft.");
  return parsed.draft;
}

export function decideStoredDraft(
  draft: StoredScoringDraft,
  context: RecoveryContext,
): RecoveryDecision {
  if (draft.accountId !== context.accountId) {
    return { status: "CROSS_ACCOUNT", draft };
  }
  if (draft.gameId !== context.gameId) {
    return { status: "WRONG_GAME", draft };
  }
  if (
    draft.setupSnapshotId !== context.setupSnapshotId ||
    draft.setupRevision !== context.setupRevision
  ) {
    return { status: "SETUP_CHANGED", draft };
  }
  if (context.acceptedSubmissionIds.includes(draft.idempotencyKey)) {
    return { status: "ACCEPTED", draft };
  }
  if (draft.expectedSourceRevision !== context.sourceRevision) {
    return { status: "STALE", draft };
  }
  return { status: "RECOVERABLE", draft };
}

export function serializeStoredScoringDraft(draft: StoredScoringDraft) {
  return JSON.stringify(draft);
}

export function classifyRecoveryFailure(code: string): ScoringRecoveryPhase {
  if (code === "STALE_SOURCE_REVISION") return "STALE_CONFLICT";
  if (code === "NETWORK_FAILURE" || code === "UNEXPECTED_FAILURE") {
    return "RETRYABLE_FAILURE";
  }
  return "TERMINAL_REJECTION";
}

export function shouldWarnForScoringNavigation(
  currentHref: string,
  destinationHref: string,
  hasUnacceptedDraft: boolean,
) {
  if (!hasUnacceptedDraft) return false;
  const current = new URL(currentHref);
  const destination = new URL(destinationHref, current);
  return (
    destination.origin !== current.origin ||
    destination.pathname !== current.pathname ||
    destination.search !== current.search
  );
}

export function idempotencyKeyForProposal(
  previousProposal: string | null,
  nextProposal: string,
  currentKey: string,
  createKey: () => string,
) {
  return previousProposal !== null && previousProposal !== nextProposal
    ? createKey()
    : currentKey;
}

export function storedDraftBlocksNewEditor(
  storedValue: string | null,
  currentKey: string,
) {
  if (storedValue === null) return false;
  const parsed = parseStoredScoringDraft(storedValue);
  return !parsed.ok || parsed.draft.idempotencyKey !== currentKey;
}
