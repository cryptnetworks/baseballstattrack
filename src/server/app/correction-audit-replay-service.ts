import {
  CorrectionWorkflowError,
  correctionBody,
  parseCorrectionCommand,
  requireCorrectionActor,
} from "@/domain/corrections";
import { GameEventError } from "@/domain/events/event-log";
import { PrismaGameEventRepository } from "@/server/data/game-event-repository";

function translateCorrectionError(error: unknown): never {
  if (error instanceof CorrectionWorkflowError) throw error;
  if (error instanceof GameEventError) {
    switch (error.code) {
      case "ACCOUNT_MISMATCH":
      case "GAME_MISMATCH":
      case "CORRECTION_TARGET_MISSING":
      case "SETUP_NOT_READY":
        throw new CorrectionWorkflowError(
          "NOT_FOUND_OR_INACCESSIBLE",
          "Correction resource is unavailable.",
        );
      case "STALE_SOURCE_REVISION":
        throw new CorrectionWorkflowError(
          "STALE_SOURCE_REVISION",
          "Expected source revision is stale.",
        );
      case "INVALID_LIFECYCLE_TRANSITION":
        throw new CorrectionWorkflowError(
          "LIFECYCLE_CONFLICT",
          "Game lifecycle does not permit this correction.",
        );
      case "CORRECTION_GRAPH_INVALID":
      case "INVALID_BASEBALL_TRANSITION":
      case "INVALID_LINEUP":
      case "INVALID_RUNNER_MOVEMENT":
      case "INVALID_PITCHER":
        throw new CorrectionWorkflowError(
          "INVALID_CORRECTION",
          "Correction does not produce valid replayable game history.",
        );
      case "DUPLICATE_IDEMPOTENCY_KEY":
      case "DUPLICATE_ACCEPTED_EVENT":
        throw new CorrectionWorkflowError(
          "DUPLICATE_SUBMISSION",
          "Correction idempotency or event identity was already used.",
        );
      case "PERSISTENCE_CONFLICT":
        throw new CorrectionWorkflowError(
          "PERSISTENCE_CONFLICT",
          "Concurrent correction acceptance conflicted.",
        );
      default:
        throw new CorrectionWorkflowError(
          "INTERNAL_INVARIANT_FAILURE",
          "Correction workflow failed closed.",
        );
    }
  }
  throw new CorrectionWorkflowError(
    "INTERNAL_INVARIANT_FAILURE",
    "Correction workflow failed closed.",
  );
}

export class CorrectionAuditReplayService {
  constructor(private readonly repository: PrismaGameEventRepository) {}

  async applyCorrection(input: unknown, actorInput: unknown) {
    const command = parseCorrectionCommand(input);
    const actor = requireCorrectionActor(
      actorInput,
      command.accountId,
      command.gameId,
    );
    try {
      return await this.repository.acceptCorrection(
        {
          accountId: command.accountId,
          gameId: command.gameId,
          setupSnapshotId: command.setupSnapshotId,
          expectedRevision: command.expectedSourceRevision,
          eventId: command.eventId,
          playTransactionId: command.playTransactionId,
          clientSubmissionId: command.idempotencyKey,
          recordedAt: command.recordedAt,
          actor: {
            accountId: actor.accountId,
            actorId: actor.actorId,
            actorKind: actor.actorKind,
            actorUserId: actor.actorUserId,
            capability: actor.capability,
            scope: actor.scope,
            authorizedAt: actor.authorizedAt,
          },
          body: correctionBody(command),
        },
        {
          correlationId: command.correlationId,
          membershipId: actor.membershipId,
        },
        actor,
      );
    } catch (error) {
      translateCorrectionError(error);
    }
  }
}
