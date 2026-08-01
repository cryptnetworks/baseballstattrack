import {
  ActorKind,
  AuditOutcome,
  AuditScope,
  DiscordInstallationStatus,
  DiscordRoleGrantStatus,
  Prisma,
  type PrismaClient,
} from "@prisma/client";

import {
  DISCORD_MEMBERSHIP_MAX_AGE_MS,
  type DiscordRoleGrantRevokeInput,
  type DiscordRoleGrantUpdateInput,
} from "@/domain/discord-permissions";
import type { TrustedActorContext } from "@/server/auth/types";

export class DiscordPermissionsConflictError extends Error {
  constructor() {
    super("Discord role grant revision conflict.");
    this.name = "DiscordPermissionsConflictError";
  }
}

function actorKind(value: "USER" | "SERVICE") {
  return value === "USER" ? ActorKind.USER : ActorKind.SERVICE;
}

const grantInclude = {
  guildRole: {
    select: {
      externalId: true,
      roleReference: true,
      displayName: true,
      enabled: true,
      lastVerifiedAt: true,
    },
  },
} satisfies Prisma.DiscordRoleGrantInclude;

type GrantRow = Prisma.DiscordRoleGrantGetPayload<{
  include: typeof grantInclude;
}>;

function grantView(grant: GrantRow) {
  return {
    id: grant.externalId,
    role: {
      id: grant.guildRole.externalId,
      reference: grant.guildRole.roleReference,
      displayName: grant.guildRole.displayName,
      available: grant.guildRole.enabled,
      lastVerifiedAt: grant.guildRole.lastVerifiedAt,
    },
    actions: [...grant.actions],
    status: grant.status,
    revision: grant.revision,
    revokedAt: grant.revokedAt,
    createdAt: grant.createdAt,
    updatedAt: grant.updatedAt,
  };
}

function auditState(
  grant: Pick<GrantRow, "actions" | "status" | "revision" | "revokedAt"> | null,
) {
  return grant
    ? {
        actions: [...grant.actions].sort(),
        status: grant.status,
        revision: grant.revision,
        revoked: grant.revokedAt !== null,
      }
    : null;
}

function safeMetadata(value: Prisma.JsonValue | null) {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  const metadata = value as Record<string, Prisma.JsonValue>;
  return {
    serverId: typeof metadata.serverId === "string" ? metadata.serverId : null,
    category: typeof metadata.category === "string" ? metadata.category : null,
    before: metadata.before ?? null,
    after: metadata.after ?? null,
  };
}

export class PrismaDiscordPermissionsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listGrants(accountId: string, installationExternalId: string) {
    const installation = await this.prisma.discordInstallation.findUnique({
      where: {
        accountId_externalId: {
          accountId,
          externalId: installationExternalId,
        },
      },
      select: {
        externalId: true,
        guildDisplayName: true,
        status: true,
        roleGrants: {
          include: grantInclude,
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!installation) return null;
    return {
      installation: {
        id: installation.externalId,
        displayName: installation.guildDisplayName,
        status: installation.status,
      },
      grants: installation.roleGrants.map(grantView),
    };
  }

  async writeGrant(
    input: DiscordRoleGrantUpdateInput & { actor: TrustedActorContext },
  ) {
    return this.write(input, "update");
  }

  async revokeGrant(
    input: DiscordRoleGrantRevokeInput & { actor: TrustedActorContext },
  ) {
    return this.write(input, "revoke");
  }

  private async write(
    input:
      | (DiscordRoleGrantUpdateInput & { actor: TrustedActorContext })
      | (DiscordRoleGrantRevokeInput & { actor: TrustedActorContext }),
    operation: "update" | "revoke",
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const nextActions = "actions" in input ? input.actions : null;
        const rows = await tx.$queryRaw<Array<{ now: Date }>>`
          SELECT clock_timestamp() AS now
        `;
        const now = rows[0]?.now;
        if (!now) return { outcome: "unavailable" as const };
        const installation = await tx.discordInstallation.findUnique({
          where: {
            accountId_externalId: {
              accountId: input.accountId,
              externalId: input.installationId,
            },
          },
          select: { id: true, externalId: true, status: true },
        });
        if (!installation) return { outcome: "unavailable" as const };
        if (installation.status !== DiscordInstallationStatus.ACTIVE) {
          return { outcome: "membership_stale" as const };
        }
        const guildRole = await tx.discordGuildRole.findUnique({
          where: {
            accountId_externalId: {
              accountId: input.accountId,
              externalId: input.roleId,
            },
          },
          select: {
            id: true,
            externalId: true,
            installationId: true,
            enabled: true,
            lastVerifiedAt: true,
          },
        });
        if (!guildRole || guildRole.installationId !== installation.id) {
          return { outcome: "unavailable" as const };
        }
        if (
          !guildRole.enabled ||
          now.getTime() - guildRole.lastVerifiedAt.getTime() < 0 ||
          now.getTime() - guildRole.lastVerifiedAt.getTime() >
            DISCORD_MEMBERSHIP_MAX_AGE_MS
        ) {
          return { outcome: "membership_stale" as const };
        }
        const current = await tx.discordRoleGrant.findUnique({
          where: {
            accountId_installationId_guildRoleId: {
              accountId: input.accountId,
              installationId: installation.id,
              guildRoleId: guildRole.id,
            },
          },
          include: grantInclude,
        });
        const currentRevision = current?.revision ?? 0;
        if (currentRevision !== input.expectedRevision) {
          throw new DiscordPermissionsConflictError();
        }
        if (operation === "revoke" && !current) {
          return { outcome: "unavailable" as const };
        }
        const nextRevision = currentRevision + 1;
        let stored: GrantRow;
        if (current) {
          const updated = await tx.discordRoleGrant.updateMany({
            where: { id: current.id, revision: currentRevision },
            data:
              operation === "revoke"
                ? {
                    status: DiscordRoleGrantStatus.REVOKED,
                    revokedAt: now,
                    revision: nextRevision,
                  }
                : {
                    actions: nextActions!,
                    status: DiscordRoleGrantStatus.ACTIVE,
                    revokedAt: null,
                    revision: nextRevision,
                  },
          });
          if (updated.count !== 1) {
            throw new DiscordPermissionsConflictError();
          }
          stored = await tx.discordRoleGrant.findUniqueOrThrow({
            where: { id: current.id },
            include: grantInclude,
          });
        } else {
          if (operation === "revoke") {
            return { outcome: "unavailable" as const };
          }
          stored = await tx.discordRoleGrant.create({
            data: {
              accountId: input.accountId,
              installationId: installation.id,
              guildRoleId: guildRole.id,
              actions: nextActions!,
            },
            include: grantInclude,
          });
        }

        await tx.securityAuditRecord.create({
          data: {
            scope: AuditScope.ACCOUNT,
            accountId: input.accountId,
            actorKind: actorKind(input.actor.actorKind),
            actorId: input.actor.actorId,
            actorUserId: input.actor.actorUserId,
            action: `discord.permissions.${operation}`,
            capability: input.actor.capability,
            targetType: "DiscordRoleGrant",
            targetId: stored.id,
            outcome: AuditOutcome.SUCCEEDED,
            ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}),
            metadata: {
              serverId: installation.externalId,
              roleId: guildRole.externalId,
              category: "permissions",
              before: auditState(current),
              after: auditState(stored),
            },
          },
        });
        return { outcome: "updated" as const, grant: grantView(stored) };
      });
    } catch (error) {
      if (
        error instanceof DiscordPermissionsConflictError ||
        (error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002")
      ) {
        throw new DiscordPermissionsConflictError();
      }
      throw error;
    }
  }

  async listAuditHistory(accountId: string, installationExternalId: string) {
    const installation = await this.prisma.discordInstallation.findUnique({
      where: {
        accountId_externalId: {
          accountId,
          externalId: installationExternalId,
        },
      },
      select: { externalId: true },
    });
    if (!installation) return null;
    const records = await this.prisma.securityAuditRecord.findMany({
      where: {
        accountId,
        targetType: "DiscordRoleGrant",
        action: { startsWith: "discord.permissions." },
        metadata: { path: ["serverId"], equals: installation.externalId },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return records.map((record) => {
      const metadata = safeMetadata(record.metadata);
      return {
        id: record.id,
        actor: { kind: record.actorKind, id: record.actorId },
        serverId: metadata?.serverId ?? installation.externalId,
        category: metadata?.category ?? "permissions",
        before: metadata?.before ?? null,
        after: metadata?.after ?? null,
        timestamp: record.createdAt,
        result: record.outcome,
        action: record.action,
        reasonCode: record.reasonCode,
      };
    });
  }
}
