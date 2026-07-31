import { Prisma, type PrismaClient } from "@prisma/client";

import { AuthorizationError } from "@/server/auth/errors";
import type {
  ActiveAuthority,
  AuthenticatedIdentity,
  AuthorityAssignment,
  ResolvedTarget,
  ResourceTarget,
} from "@/server/auth/types";

export type AvailableAccount = Readonly<{
  id: string;
  externalId: string;
  slug: string;
  displayName: string;
}>;

export interface AuthorizationStore {
  resolveOrProvisionUser(
    identity: AuthenticatedIdentity,
  ): Promise<{ id: string; active: boolean }>;
  listAvailableAccounts(appUserId: string): Promise<AvailableAccount[]>;
  loadActiveAuthority(
    appUserId: string,
    accountId: string,
  ): Promise<ActiveAuthority | null>;
  resolveTarget(target: ResourceTarget): Promise<ResolvedTarget | null>;
}

type DatabaseClient = PrismaClient | Prisma.TransactionClient;
type ProviderIdentityErrorMetadata = {
  modelName?: unknown;
  target?: unknown;
  driverAdapterError?: {
    cause?: {
      constraint?: {
        fields?: unknown;
      };
    };
  };
};

const conflictRecoveryAttempts = 3;
const visibilityRetryDelayMs = 2;
const userSelection = { id: true, status: true } as const;

function normalizedConstraintFields(error: unknown): string[] | null {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== "P2002"
  ) {
    return null;
  }
  const metadata = error.meta as ProviderIdentityErrorMetadata | undefined;
  if (metadata?.modelName !== "AppUser") return null;
  const fields = Array.isArray(metadata.target)
    ? metadata.target
    : metadata.driverAdapterError?.cause?.constraint?.fields;
  if (!Array.isArray(fields)) return null;
  const normalized = fields.flatMap((field) =>
    typeof field === "string"
      ? [
          field.startsWith('"') && field.endsWith('"')
            ? field.slice(1, -1)
            : field,
        ]
      : [],
  );
  return normalized.length === fields.length ? normalized : null;
}

function isProviderIdentityConflict(error: unknown): boolean {
  const fields = normalizedConstraintFields(error);
  return (
    fields?.length === 2 &&
    fields.includes("provider") &&
    fields.includes("providerSubject")
  );
}

function waitForVisibility(attempt: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, visibilityRetryDelayMs * attempt);
  });
}

function provisioningFailure(): AuthorizationError {
  return new AuthorizationError("USER_PROVISIONING_FAILURE");
}

export class PrismaAuthorizationStore implements AuthorizationStore {
  constructor(private readonly prisma: DatabaseClient) {}

  private findUser(identity: AuthenticatedIdentity) {
    return this.prisma.appUser.findUnique({
      where: {
        provider_providerSubject: {
          provider: identity.provider,
          providerSubject: identity.providerSubject,
        },
      },
      select: userSelection,
    });
  }

  private async recoverConcurrentUser(identity: AuthenticatedIdentity) {
    for (let attempt = 1; attempt <= conflictRecoveryAttempts; attempt += 1) {
      const user = await this.findUser(identity);
      if (user) return user;
      if (attempt < conflictRecoveryAttempts) {
        await waitForVisibility(attempt);
      }
    }
    throw provisioningFailure();
  }

  async resolveOrProvisionUser(identity: AuthenticatedIdentity) {
    try {
      const existing = await this.findUser(identity);
      if (existing) {
        return { id: existing.id, active: existing.status === "ACTIVE" };
      }
      try {
        const user = await this.prisma.appUser.create({
          data: {
            provider: identity.provider,
            providerSubject: identity.providerSubject,
          },
          select: userSelection,
        });
        return { id: user.id, active: user.status === "ACTIVE" };
      } catch (error) {
        if (!isProviderIdentityConflict(error)) throw error;
        const user = await this.recoverConcurrentUser(identity);
        return { id: user.id, active: user.status === "ACTIVE" };
      }
    } catch (error) {
      if (
        error instanceof AuthorizationError &&
        error.code === "USER_PROVISIONING_FAILURE"
      ) {
        throw error;
      }
      throw provisioningFailure();
    }
  }

  async listAvailableAccounts(appUserId: string) {
    const memberships = await this.prisma.accountMembership.findMany({
      where: {
        userId: appUserId,
        status: "ACTIVE",
        account: { status: "ACTIVE" },
      },
      select: {
        account: {
          select: {
            id: true,
            externalId: true,
            slug: true,
            displayName: true,
          },
        },
      },
      orderBy: { account: { displayName: "asc" } },
    });
    return memberships.map(({ account }) => account);
  }

  async loadActiveAuthority(appUserId: string, accountId: string) {
    const membership = await this.prisma.accountMembership.findFirst({
      where: {
        accountId,
        userId: appUserId,
        status: "ACTIVE",
        account: { status: "ACTIVE" },
        user: { status: "ACTIVE" },
      },
      select: {
        id: true,
        roleAssignments: {
          where: { revokedAt: null },
          select: {
            id: true,
            role: true,
            scope: true,
            teamId: true,
            seasonId: true,
            gameId: true,
          },
        },
        capabilityGrants: {
          where: { revokedAt: null },
          select: {
            id: true,
            capability: true,
            scope: true,
            teamId: true,
            seasonId: true,
            gameId: true,
          },
        },
      },
    });
    if (!membership) return null;
    const assignments: AuthorityAssignment[] = [
      ...membership.roleAssignments.map((assignment) => ({
        id: assignment.id,
        source: "ROLE" as const,
        role: assignment.role,
        capability: null,
        scope: assignment.scope,
        teamId: assignment.teamId,
        seasonId: assignment.seasonId,
        gameId: assignment.gameId,
      })),
      ...membership.capabilityGrants.map((grant) => ({
        id: grant.id,
        source: "GRANT" as const,
        role: null,
        capability: grant.capability,
        scope: grant.scope,
        teamId: grant.teamId,
        seasonId: grant.seasonId,
        gameId: grant.gameId,
      })),
    ];
    return {
      appUserId,
      membershipId: membership.id,
      accountId,
      assignments,
    };
  }

  async resolveTarget(target: ResourceTarget) {
    if (target.kind === "ACCOUNT") {
      const account = await this.prisma.account.findFirst({
        where: { id: target.accountId, status: "ACTIVE" },
        select: { id: true },
      });
      return account
        ? {
            kind: "ACCOUNT" as const,
            accountId: account.id,
            teamIds: [],
            seasonId: null,
            gameId: null,
          }
        : null;
    }
    if (target.kind === "TEAM") {
      const team = await this.prisma.team.findFirst({
        where: { id: target.teamId, accountId: target.accountId },
        select: { id: true, accountId: true },
      });
      return team
        ? {
            kind: "TEAM" as const,
            accountId: team.accountId,
            teamIds: [team.id],
            seasonId: null,
            gameId: null,
          }
        : null;
    }
    if (target.kind === "SEASON") {
      const season = await this.prisma.season.findFirst({
        where: { id: target.seasonId, accountId: target.accountId },
        select: { id: true, accountId: true },
      });
      return season
        ? {
            kind: "SEASON" as const,
            accountId: season.accountId,
            teamIds: [],
            seasonId: season.id,
            gameId: null,
          }
        : null;
    }
    const game = await this.prisma.game.findFirst({
      where: { id: target.gameId, accountId: target.accountId },
      select: {
        id: true,
        accountId: true,
        seasonId: true,
        teamSeason: { select: { teamId: true } },
        teamSnapshots: {
          where: { teamId: { not: null } },
          select: { teamId: true },
        },
      },
    });
    if (!game) return null;
    const teamIds = new Set<string>([game.teamSeason.teamId]);
    for (const snapshot of game.teamSnapshots) {
      if (snapshot.teamId) teamIds.add(snapshot.teamId);
    }
    return {
      kind: "GAME" as const,
      accountId: game.accountId,
      teamIds: [...teamIds],
      seasonId: game.seasonId,
      gameId: game.id,
    };
  }
}
