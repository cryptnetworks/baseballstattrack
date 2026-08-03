import type { AuthorizationScope, MembershipRole } from "@prisma/client";

import { AuthorizationError } from "@/server/auth/errors";

export const AUTH_PROVIDER = "supabase";

export const capabilities = [
  "account.view",
  "account.manage",
  "account.archive",
  "account.delete_request",
  "membership.view",
  "membership.invite",
  "membership.update",
  "membership.remove",
  "membership.role_assign",
  "membership.grant_manage",
  "ownership.transfer",
  "ownership.promote",
  "ownership.demote",
  "team.view",
  "team.manage",
  "season.view",
  "season.manage",
  "roster.view",
  "roster.manage",
  "player.private_view",
  "game.create",
  "game.setup",
  "game.view",
  "game.start",
  "game.score",
  "game.suspend",
  "game.resume",
  "game.complete",
  "game.correct",
  "game.reopen",
  "game.abandon",
  "game.cancel",
  "game.archive",
  "game.verify",
  "game.reverify",
  "report.view",
  "report.export",
  "report.publish",
  "audit.view",
  "configuration.view",
  "configuration.manage",
  "discord.settings.view",
  "discord.settings.configure",
  "discord.settings.preview",
  "discord.settings.operate",
  "privacy.request",
  "privacy.manage",
  "ruleset.view",
  "ruleset.manage",
  "fantasy.league.view",
  "fantasy.league.manage",
  "fantasy.league.activate",
  "fantasy.roster.manage",
  "fantasy.scoring.calculate",
  "fantasy.scoring.view",
] as const;

export type Capability = (typeof capabilities)[number];

export type AuthenticatedIdentity = Readonly<{
  provider: typeof AUTH_PROVIDER;
  providerSubject: string;
}>;

export type ResourceTarget =
  | Readonly<{ kind: "ACCOUNT"; accountId: string }>
  | Readonly<{ kind: "TEAM"; accountId: string; teamId: string }>
  | Readonly<{ kind: "SEASON"; accountId: string; seasonId: string }>
  | Readonly<{ kind: "GAME"; accountId: string; gameId: string }>;

export type ResolvedTarget = Readonly<{
  kind: ResourceTarget["kind"];
  accountId: string;
  teamIds: readonly string[];
  seasonId: string | null;
  gameId: string | null;
}>;

export type AuthorityAssignment = Readonly<{
  id: string;
  source: "ROLE" | "GRANT";
  role: MembershipRole | null;
  capability: string | null;
  scope: AuthorizationScope;
  teamId: string | null;
  seasonId: string | null;
  gameId: string | null;
}>;

export type ActiveAuthority = Readonly<{
  appUserId: string;
  membershipId: string;
  accountId: string;
  assignments: readonly AuthorityAssignment[];
}>;

const trustedActorMarker: unique symbol = Symbol("trusted-actor");

export type TrustedActorContext = Readonly<{
  [trustedActorMarker]: true;
  accountId: string;
  appUserId: string;
  membershipId: string | null;
  actorKind: "USER" | "SERVICE";
  actorId: string;
  actorUserId: string | null;
  capability: Capability;
  authorityReferenceIds: readonly string[];
  target: ResolvedTarget;
  authorizedAt: string;
}>;

type TrustedActorInput = Omit<TrustedActorContext, typeof trustedActorMarker>;

export function createTrustedActorContext(
  input: TrustedActorInput,
): TrustedActorContext {
  const actor = {
    ...input,
    target: Object.freeze({
      ...input.target,
      teamIds: Object.freeze([...input.target.teamIds]),
    }),
    authorityReferenceIds: Object.freeze([...input.authorityReferenceIds]),
  };
  Object.defineProperty(actor, trustedActorMarker, {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return Object.freeze(actor) as TrustedActorContext;
}

export function requireTrustedActor(
  input: TrustedActorContext,
  accountId: string,
  capability: Capability,
): TrustedActorContext {
  if (
    !input ||
    input[trustedActorMarker] !== true ||
    (input.actorKind === "USER" &&
      (input.actorUserId !== input.appUserId ||
        input.actorId !== input.appUserId ||
        input.membershipId === null)) ||
    (input.actorKind === "SERVICE" &&
      (input.actorUserId !== null || input.membershipId !== null)) ||
    input.accountId !== accountId ||
    input.target.accountId !== accountId ||
    input.capability !== capability
  ) {
    throw new AuthorizationError("AUTHORIZATION_REQUIRED");
  }
  return input;
}
