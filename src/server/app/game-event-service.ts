import { z } from "zod";

import { parseEventBody } from "@/domain/events/event-log";
import {
  type AcceptEventCommand,
  PrismaGameEventRepository,
  type ValidatedActorContext,
} from "@/server/data/game-event-repository";
import { getPrismaClient } from "@/server/data/prisma";
import { AuthorizationError } from "@/server/auth/errors";
import {
  requireTrustedActor,
  type TrustedActorContext,
} from "@/server/auth/types";

export type EventAcceptanceInput = Omit<
  AcceptEventCommand,
  "actor" | "body"
> & {
  body: unknown;
};

const id = z.string().trim().min(1).max(128);
const eventAcceptanceSchema = z
  .object({
    accountId: id,
    gameId: id,
    setupSnapshotId: id,
    expectedRevision: z.int().nonnegative(),
    eventId: id,
    playTransactionId: id,
    clientSubmissionId: id,
    recordedAt: z.iso.datetime(),
    body: z.unknown(),
  })
  .strict();

function capabilityForEvent(
  eventType: string,
  actor: TrustedActorContext,
): Exclude<ValidatedActorContext["capability"], "game.correct"> {
  if (eventType === "GameVerified") {
    return actor.capability === "game.reverify"
      ? "game.reverify"
      : "game.verify";
  }
  if (eventType === "GameStarted") return "game.start";
  if (eventType === "GameReopened") return "game.reopen";
  return "game.score";
}

function requireGameTarget(
  actor: TrustedActorContext,
  accountId: string,
  gameId: string,
  capability:
    Exclude<ValidatedActorContext["capability"], "game.correct"> | "game.view",
) {
  const trusted = requireTrustedActor(actor, accountId, capability);
  if (trusted.target.kind !== "GAME" || trusted.target.gameId !== gameId) {
    throw new AuthorizationError("AUTHORIZATION_REQUIRED");
  }
  return trusted;
}

export class GameEventService {
  constructor(private readonly repository: PrismaGameEventRepository) {}

  async accept(input: EventAcceptanceInput, actor: TrustedActorContext) {
    const command = eventAcceptanceSchema.parse(input);
    const body = parseEventBody(command.body);
    const capability = capabilityForEvent(body.eventType, actor);
    const trusted = requireGameTarget(
      actor,
      command.accountId,
      command.gameId,
      capability,
    );
    return this.repository.accept({
      ...command,
      body,
      actor: {
        accountId: trusted.accountId,
        actorId: trusted.actorId,
        actorKind: trusted.actorKind,
        actorUserId: trusted.actorUserId,
        capability,
        scope: { kind: "GAME", gameId: command.gameId },
        authorizedAt: trusted.authorizedAt,
      },
    });
  }

  async loadAcceptedHistory(
    accountId: string,
    gameId: string,
    setupSnapshotId: string,
    actor: TrustedActorContext,
  ) {
    requireGameTarget(actor, accountId, gameId, "game.view");
    return this.repository.loadAcceptedHistory(
      accountId,
      gameId,
      setupSnapshotId,
    );
  }

  async replay(
    accountId: string,
    gameId: string,
    setupSnapshotId: string,
    actor: TrustedActorContext,
  ) {
    requireGameTarget(actor, accountId, gameId, "game.view");
    return this.repository.replay(accountId, gameId, setupSnapshotId);
  }
}

export function getGameEventService() {
  return new GameEventService(new PrismaGameEventRepository(getPrismaClient()));
}
