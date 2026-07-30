import { resolveCapabilityDecision } from "@/server/auth/capability-policy";
import { AuthorizationError } from "@/server/auth/errors";
import type { AuthorizationStore } from "@/server/auth/store";
import {
  createTrustedActorContext,
  type AuthenticatedIdentity,
  type Capability,
  type ResourceTarget,
} from "@/server/auth/types";

export class AuthorizationService {
  constructor(private readonly store: AuthorizationStore) {}

  private async resolveUser(identity: AuthenticatedIdentity) {
    const user = await this.store.resolveOrProvisionUser(identity);
    if (!user.active) {
      throw new AuthorizationError("USER_DISABLED");
    }
    return user;
  }

  async listAvailableAccounts(identity: AuthenticatedIdentity) {
    const user = await this.resolveUser(identity);
    return this.store.listAvailableAccounts(user.id);
  }

  async authorize(
    identity: AuthenticatedIdentity,
    target: ResourceTarget,
    capability: Capability,
  ) {
    const user = await this.resolveUser(identity);
    const [authority, resolvedTarget] = await Promise.all([
      this.store.loadActiveAuthority(user.id, target.accountId),
      this.store.resolveTarget(target),
    ]);
    if (!authority) throw new AuthorizationError("NO_ACTIVE_MEMBERSHIP");
    if (!resolvedTarget || resolvedTarget.accountId !== target.accountId) {
      throw new AuthorizationError(
        target.kind === "ACCOUNT"
          ? "ACCOUNT_UNAVAILABLE"
          : "RESOURCE_UNAVAILABLE",
      );
    }
    const decision = resolveCapabilityDecision(
      authority,
      capability,
      resolvedTarget,
    );
    if (!decision.allowed) {
      throw new AuthorizationError("INSUFFICIENT_CAPABILITY");
    }
    return createTrustedActorContext({
      accountId: target.accountId,
      appUserId: user.id,
      membershipId: authority.membershipId,
      actorKind: "USER",
      actorId: user.id,
      actorUserId: user.id,
      capability,
      authorityReferenceIds: decision.contributingAuthority.map(
        (assignment) => assignment.id,
      ),
      target: resolvedTarget,
      authorizedAt: new Date().toISOString(),
    });
  }
}
