import { z } from "zod";

import {
  correctionAppliedEventSchema,
  type AcceptedEvent,
  type EventBody,
} from "@/domain/events/event-log";

const stableId = z.string().trim().min(1).max(128);
const dateTime = z.iso.datetime();

export const correctionActorSchema = z
  .object({
    accountId: stableId,
    actorId: stableId,
    actorKind: z.enum(["USER", "SERVICE", "SYSTEM"]),
    actorUserId: stableId.nullable(),
    membershipId: stableId.nullable(),
    capability: z.literal("game.correct"),
    scope: z.object({ kind: z.literal("GAME"), gameId: stableId }).strict(),
    authorizedAt: dateTime,
  })
  .strict()
  .superRefine((actor, context) => {
    if (
      (actor.actorKind === "USER" &&
        (actor.actorUserId === null || actor.membershipId === null)) ||
      (actor.actorKind !== "USER" &&
        (actor.actorUserId !== null || actor.membershipId !== null))
    ) {
      context.addIssue({
        code: "custom",
        message: "Actor identity is inconsistent.",
      });
    }
  });

export const applyCorrectionCommandSchema = z
  .object({
    action: z.literal("APPLY_CORRECTION"),
    accountId: stableId,
    gameId: stableId,
    setupSnapshotId: stableId,
    expectedSourceRevision: z.int().nonnegative(),
    eventId: stableId,
    playTransactionId: stableId,
    idempotencyKey: stableId,
    correlationId: stableId,
    recordedAt: dateTime,
    correction: correctionAppliedEventSchema.shape.payload,
  })
  .strict();

export type CorrectionActorContext = z.infer<typeof correctionActorSchema>;
export type ApplyCorrectionCommand = z.infer<
  typeof applyCorrectionCommandSchema
>;

export type SafeCorrectionAudit = {
  id: string;
  accountId: string;
  actor: {
    kind: CorrectionActorContext["actorKind"];
    id: string;
    userId: string | null;
    membershipId: string | null;
  };
  action: "game.correction.apply";
  capability: "game.correct";
  target: {
    type: "Correction";
    correctionEventId: string;
    gameId: string;
    targetEventIds: string[];
  };
  reasonCode: string;
  outcome: "SUCCEEDED";
  occurredAt: string;
  correlationId: string;
  sourceRevision: {
    before: number;
    after: number;
  };
  verificationImpact:
    | "UNCHANGED_UNVERIFIED"
    | "REQUIRES_VERIFICATION"
    | "INVALIDATED_REQUIRES_REVERIFICATION";
};

export type CorrectionReportVersion = {
  sourceRevision: number;
  correctionRevision: number;
  setupRevision: number;
  eventSchemaVersion: number;
  reducerVersion: number;
  statisticDerivationVersion: number;
  statisticRulesVersion: number;
  rulesetVersionId: string;
  verificationStatus: "VERIFIED" | "UNVERIFIED";
  freshness: "CURRENT";
  generatedAt: string;
};

export type CorrectionWorkflowResult = {
  correction: AcceptedEvent & { eventType: "CorrectionApplied" };
  idempotentReplay: boolean;
  replay: {
    lifecycleStatus: string;
    score: { HOME: number; AWAY: number };
    effectiveEventCount: number;
  };
  statistics: {
    finalScore: { HOME: number; AWAY: number };
    batting: Array<{
      playerId: string;
      plateAppearances: number;
      hits: number;
      walks: number;
    }>;
    pitching: Array<{
      playerId: string;
      battersFaced: number;
      hitsAllowed: number;
      walks: number;
    }>;
  };
  version: CorrectionReportVersion;
  audit: SafeCorrectionAudit;
  auditHistory: SafeCorrectionAudit[];
};

export type CorrectionWorkflowErrorCode =
  | "INVALID_INPUT"
  | "AUTHORIZATION_REQUIRED"
  | "ACCOUNT_MISMATCH"
  | "NOT_FOUND_OR_INACCESSIBLE"
  | "STALE_SOURCE_REVISION"
  | "LIFECYCLE_CONFLICT"
  | "INVALID_CORRECTION"
  | "DUPLICATE_SUBMISSION"
  | "PERSISTENCE_CONFLICT"
  | "INTERNAL_INVARIANT_FAILURE";

export class CorrectionWorkflowError extends Error {
  constructor(
    readonly code: CorrectionWorkflowErrorCode,
    message: string,
    readonly issues: readonly { field: string; code: string }[] = [],
  ) {
    super(message);
    this.name = "CorrectionWorkflowError";
  }
}

export function parseCorrectionCommand(input: unknown): ApplyCorrectionCommand {
  const result = applyCorrectionCommandSchema.safeParse(input);
  if (!result.success) {
    throw new CorrectionWorkflowError(
      "INVALID_INPUT",
      "Correction command is invalid.",
      result.error.issues.slice(0, 20).map((issue) => ({
        field: issue.path.join("."),
        code: issue.code,
      })),
    );
  }
  return result.data;
}

export function requireCorrectionActor(
  input: unknown,
  accountId: string,
  gameId: string,
): CorrectionActorContext {
  const result = correctionActorSchema.safeParse(input);
  if (!result.success) {
    throw new CorrectionWorkflowError(
      "AUTHORIZATION_REQUIRED",
      "Validated correction actor context is required.",
    );
  }
  if (result.data.accountId !== accountId) {
    throw new CorrectionWorkflowError(
      "ACCOUNT_MISMATCH",
      "Validated actor Account does not match the request.",
    );
  }
  if (result.data.scope.gameId !== gameId) {
    throw new CorrectionWorkflowError(
      "AUTHORIZATION_REQUIRED",
      "Exact Game scope is required.",
    );
  }
  return result.data;
}

export function correctionBody(
  command: ApplyCorrectionCommand,
): Extract<EventBody, { eventType: "CorrectionApplied" }> {
  return {
    eventType: "CorrectionApplied",
    payload: command.correction,
  };
}
