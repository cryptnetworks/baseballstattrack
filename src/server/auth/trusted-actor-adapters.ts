import type { CorrectionActorContext } from "@/domain/corrections";
import type { ManagementActorContext } from "@/domain/management/team-season-roster";
import type { GameSetupActorContext } from "@/domain/setup/game-setup";
import { AuthorizationError } from "@/server/auth/errors";
import {
  requireTrustedActor,
  type Capability,
  type TrustedActorContext,
} from "@/server/auth/types";

function scopeFor(actor: TrustedActorContext) {
  const target = actor.target;
  if (target.kind === "ACCOUNT") return { kind: "ACCOUNT" as const };
  if (target.kind === "TEAM") {
    const teamId = target.teamIds[0];
    if (!teamId) throw new AuthorizationError("AUTHORIZATION_REQUIRED");
    return { kind: "TEAM" as const, teamId };
  }
  if (target.kind === "SEASON") {
    if (!target.seasonId) {
      throw new AuthorizationError("AUTHORIZATION_REQUIRED");
    }
    return { kind: "SEASON" as const, seasonId: target.seasonId };
  }
  if (!target.gameId) throw new AuthorizationError("AUTHORIZATION_REQUIRED");
  return { kind: "GAME" as const, gameId: target.gameId };
}

function common(
  actor: TrustedActorContext,
  accountId: string,
  capability: Capability,
) {
  const trusted = requireTrustedActor(actor, accountId, capability);
  return {
    accountId: trusted.accountId,
    actorId: trusted.actorId,
    actorKind: trusted.actorKind,
    actorUserId: trusted.actorUserId,
    membershipId: trusted.membershipId,
    authorizedAt: trusted.authorizedAt,
  };
}

export function toManagementActor(
  actor: TrustedActorContext,
  accountId: string,
  capability: ManagementActorContext["capability"],
): ManagementActorContext {
  return {
    ...common(actor, accountId, capability),
    capability,
    scope: scopeFor(actor) as ManagementActorContext["scope"],
  };
}

export function toGameSetupActor(
  actor: TrustedActorContext,
  accountId: string,
  capability: GameSetupActorContext["capability"],
): GameSetupActorContext {
  return {
    ...common(actor, accountId, capability),
    capability,
    scope: scopeFor(actor),
  };
}

export function toCorrectionActor(
  actor: TrustedActorContext,
  accountId: string,
  gameId: string,
): CorrectionActorContext {
  const trusted = requireTrustedActor(actor, accountId, "game.correct");
  if (trusted.target.kind !== "GAME" || trusted.target.gameId !== gameId) {
    throw new AuthorizationError("AUTHORIZATION_REQUIRED");
  }
  return {
    ...common(trusted, accountId, "game.correct"),
    capability: "game.correct",
    scope: { kind: "GAME", gameId },
  };
}
