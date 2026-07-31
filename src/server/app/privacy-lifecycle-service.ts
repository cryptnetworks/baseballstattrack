import { randomBytes } from "node:crypto";

import {
  ACCOUNT_DELETION_GRACE_MILLISECONDS,
  EXPORT_ARTIFACT_TTL_MILLISECONDS,
  PRIVACY_CONFIRMATION,
  PrivacyLifecycleError,
  cancelPrivacyRequestSchema,
  createPrivacyRequestSchema,
  exportArtifactAccessSchema,
  prepareExportSchema,
  privacyHoldSchema,
  privacyHoldReferenceSchema,
  privacyRequestReferenceSchema,
} from "@/domain/privacy-lifecycle";
import { PortableDataService } from "@/server/app/portable-data-service";
import type { TrustedActorContext } from "@/server/auth/types";
import { requireTrustedActor } from "@/server/auth/types";
import { PrismaGameBoxScoreRepository } from "@/server/data/game-box-score-repository";
import { PrismaGameEventRepository } from "@/server/data/game-event-repository";
import { PrismaPortableDataRepository } from "@/server/data/portable-data-repository";
import { getPrismaClient } from "@/server/data/prisma";
import { PrismaPrivacyLifecycleRepository } from "@/server/data/privacy-lifecycle-repository";

type Clock = () => Date;

function accountActor(
  actorInput: TrustedActorContext,
  accountId: string,
  capability: TrustedActorContext["capability"],
) {
  const actor = requireTrustedActor(actorInput, accountId, capability);
  if (actor.target.kind !== "ACCOUNT") {
    throw new PrivacyLifecycleError(
      "LIFECYCLE_UNAVAILABLE",
      "The privacy operation is unavailable.",
    );
  }
  return actor;
}

export class PrivacyLifecycleService {
  constructor(
    private readonly repository: Pick<
      PrismaPrivacyLifecycleRepository,
      | "prepareExportArtifact"
      | "consumeExportArtifact"
      | "cancelExportArtifact"
      | "createLifecycleRequest"
      | "cancelLifecycleRequest"
      | "placeHold"
      | "releaseHold"
      | "executeLifecycleRequest"
    >,
    private readonly portableData: Pick<PortableDataService, "exportAccount">,
    private readonly clock: Clock = () => new Date(),
  ) {}

  async prepareExport(input: unknown, actorInput: TrustedActorContext) {
    const parsed = prepareExportSchema.parse(input);
    const actor = accountActor(actorInput, parsed.accountId, "report.export");
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(
      this.clock().getTime() + EXPORT_ARTIFACT_TTL_MILLISECONDS,
    );
    const stored = await this.repository.prepareExportArtifact({
      ...parsed,
      actor,
      token,
      expiresAt,
    });
    return {
      artifactId: stored.id,
      token,
      expiresAt: stored.expiresAt.toISOString(),
      oneTime: true as const,
    };
  }

  async downloadExport(input: unknown, actorInput: TrustedActorContext) {
    const parsed = exportArtifactAccessSchema.parse(input);
    const actor = accountActor(actorInput, parsed.accountId, "report.export");
    const consumed = await this.repository.consumeExportArtifact({
      ...parsed,
      actor,
      now: this.clock(),
    });
    if (!consumed) {
      throw new PrivacyLifecycleError(
        "EXPORT_UNAVAILABLE",
        "The export is unavailable.",
      );
    }
    return this.portableData.exportAccount(parsed.accountId, actor);
  }

  async cancelExport(input: unknown, actorInput: TrustedActorContext) {
    const parsed = exportArtifactAccessSchema.parse(input);
    const actor = accountActor(actorInput, parsed.accountId, "report.export");
    const cancelled = await this.repository.cancelExportArtifact({
      ...parsed,
      actor,
      now: this.clock(),
    });
    if (!cancelled) {
      throw new PrivacyLifecycleError(
        "EXPORT_UNAVAILABLE",
        "The export is unavailable.",
      );
    }
    return { cancelled: true as const };
  }

  async createRequest(input: unknown, actorInput: TrustedActorContext) {
    const parsed = createPrivacyRequestSchema.parse(input);
    const capability =
      parsed.target === "ACCOUNT"
        ? "account.delete_request"
        : parsed.target === "USER"
          ? "privacy.request"
          : "privacy.manage";
    const actor = accountActor(actorInput, parsed.accountId, capability);
    if (
      parsed.confirmation !== PRIVACY_CONFIRMATION[parsed.target] ||
      (parsed.target === "ACCOUNT" && parsed.targetId !== parsed.accountId) ||
      (parsed.target === "USER" &&
        (actor.actorKind !== "USER" || parsed.targetId !== actor.appUserId))
    ) {
      throw new PrivacyLifecycleError(
        "CONFIRMATION_REQUIRED",
        "The destructive privacy confirmation is invalid.",
      );
    }
    const now = this.clock();
    const scheduledFor = new Date(
      now.getTime() +
        (parsed.target === "PLAYER" ? 0 : ACCOUNT_DELETION_GRACE_MILLISECONDS),
    );
    const result = await this.repository.createLifecycleRequest({
      accountId: parsed.accountId,
      actor,
      clientRequestId: parsed.clientRequestId,
      target: parsed.target,
      targetId: parsed.targetId,
      reasonCode: parsed.reasonCode,
      scheduledFor,
      now,
    });
    if (!result) {
      throw new PrivacyLifecycleError(
        "LIFECYCLE_UNAVAILABLE",
        "The privacy operation is unavailable.",
      );
    }
    if (result.conflict) {
      throw new PrivacyLifecycleError(
        "LIFECYCLE_CONFLICT",
        "The idempotency key was already used for another request.",
      );
    }
    if (!result.exactRetry) {
      return { request: result.request, idempotentRetry: false };
    }
    return { request: result.request, idempotentRetry: true };
  }

  async cancelRequest(input: unknown, actorInput: TrustedActorContext) {
    const parsed = cancelPrivacyRequestSchema.parse(input);
    const capability =
      parsed.target === "ACCOUNT"
        ? "account.delete_request"
        : parsed.target === "USER"
          ? "privacy.request"
          : "privacy.manage";
    const actor = accountActor(actorInput, parsed.accountId, capability);
    const request = await this.repository.cancelLifecycleRequest({
      ...parsed,
      actor,
      now: this.clock(),
    });
    if (!request) {
      throw new PrivacyLifecycleError(
        "LIFECYCLE_UNAVAILABLE",
        "The privacy operation is unavailable.",
      );
    }
    return request;
  }

  async placeHold(input: unknown, actorInput: TrustedActorContext) {
    const parsed = privacyHoldSchema.parse(input);
    const actor = accountActor(actorInput, parsed.accountId, "privacy.manage");
    if (
      parsed.expiresAt !== null &&
      Date.parse(parsed.expiresAt) <= this.clock().getTime()
    ) {
      throw new PrivacyLifecycleError(
        "INVALID_LIFECYCLE_INPUT",
        "A privacy hold expiry must be in the future.",
      );
    }
    const hold = await this.repository.placeHold({
      accountId: parsed.accountId,
      requestId: parsed.requestId,
      reasonCode: parsed.reasonCode,
      expiresAt: parsed.expiresAt ? new Date(parsed.expiresAt) : null,
      actor,
    });
    if (!hold) {
      throw new PrivacyLifecycleError(
        "LIFECYCLE_UNAVAILABLE",
        "The privacy operation is unavailable.",
      );
    }
    return hold;
  }

  async releaseHold(input: unknown, actorInput: TrustedActorContext) {
    const parsed = privacyHoldReferenceSchema.parse(input);
    const actor = accountActor(actorInput, parsed.accountId, "privacy.manage");
    const hold = await this.repository.releaseHold({
      ...parsed,
      actor,
      now: this.clock(),
    });
    if (!hold) {
      throw new PrivacyLifecycleError(
        "LIFECYCLE_UNAVAILABLE",
        "The privacy operation is unavailable.",
      );
    }
    return hold;
  }

  async executeRequest(input: unknown, actorInput: TrustedActorContext) {
    const parsed = privacyRequestReferenceSchema.parse(input);
    const actor = accountActor(actorInput, parsed.accountId, "privacy.manage");
    if (actor.actorKind !== "SERVICE") {
      throw new PrivacyLifecycleError(
        "LIFECYCLE_UNAVAILABLE",
        "The privacy operation is unavailable.",
      );
    }
    const outcome = await this.repository.executeLifecycleRequest({
      ...parsed,
      actor,
      now: this.clock(),
    });
    if (outcome === "BLOCKED") {
      throw new PrivacyLifecycleError(
        "HOLD_ACTIVE",
        "The privacy request is blocked by a recorded hold.",
      );
    }
    if (outcome === "NOT_READY") {
      throw new PrivacyLifecycleError(
        "NOT_READY",
        "The privacy request remains in its cancellation window.",
      );
    }
    if (outcome === "UNAVAILABLE") {
      throw new PrivacyLifecycleError(
        "LIFECYCLE_UNAVAILABLE",
        "The privacy operation is unavailable.",
      );
    }
    return { completed: true as const };
  }
}

export function getPrivacyLifecycleService() {
  const prisma = getPrismaClient();
  return new PrivacyLifecycleService(
    new PrismaPrivacyLifecycleRepository(prisma),
    new PortableDataService(
      new PrismaPortableDataRepository(prisma),
      new PrismaGameEventRepository(prisma),
      new PrismaGameBoxScoreRepository(prisma),
    ),
  );
}
