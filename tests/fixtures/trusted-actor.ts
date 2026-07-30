import {
  createTrustedActorContext,
  type Capability,
  type TrustedActorContext,
} from "@/server/auth/types";

type TestActor = {
  accountId: string;
  actorId: string;
  actorKind: "USER" | "SERVICE";
  actorUserId: string | null;
  membershipId?: string | null;
  capability: Capability;
  scope:
    | { kind: "ACCOUNT" }
    | { kind: "TEAM"; teamId: string }
    | { kind: "SEASON"; seasonId: string }
    | { kind: "GAME"; gameId: string };
  authorizedAt: string;
};

export function trustedActorForTest(actor: TestActor): TrustedActorContext {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Synthetic trusted actors are available only in tests.");
  }
  const appUserId =
    actor.actorKind === "USER"
      ? (actor.actorUserId ?? actor.actorId)
      : actor.actorId;
  const target =
    actor.scope.kind === "ACCOUNT"
      ? {
          kind: "ACCOUNT" as const,
          accountId: actor.accountId,
          teamIds: [],
          seasonId: null,
          gameId: null,
        }
      : actor.scope.kind === "TEAM"
        ? {
            kind: "TEAM" as const,
            accountId: actor.accountId,
            teamIds: [actor.scope.teamId],
            seasonId: null,
            gameId: null,
          }
        : actor.scope.kind === "SEASON"
          ? {
              kind: "SEASON" as const,
              accountId: actor.accountId,
              teamIds: [],
              seasonId: actor.scope.seasonId,
              gameId: null,
            }
          : {
              kind: "GAME" as const,
              accountId: actor.accountId,
              teamIds: [],
              seasonId: null,
              gameId: actor.scope.gameId,
            };
  return createTrustedActorContext({
    accountId: actor.accountId,
    appUserId,
    membershipId:
      actor.membershipId ??
      (actor.actorKind === "USER" ? "test-membership" : null),
    actorKind: actor.actorKind,
    actorId: actor.actorId,
    actorUserId: actor.actorUserId,
    capability: actor.capability,
    authorityReferenceIds: ["test-authority"],
    target,
    authorizedAt: actor.authorizedAt,
  });
}
