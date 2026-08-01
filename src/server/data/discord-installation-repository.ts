import {
  ActorKind,
  AuditOutcome,
  AuditScope,
  DiscordInstallationStatus,
  DiscordRoleGrantStatus,
  Prisma,
  type PrismaClient,
} from "@prisma/client";

import type { TrustedActorContext } from "@/server/auth/types";

function actorKind(value: "USER" | "SERVICE") {
  return value === "USER" ? ActorKind.USER : ActorKind.SERVICE;
}

const safeSelection = {
  id: true,
  externalId: true,
  guildDisplayName: true,
  status: true,
  installedAt: true,
  disconnectedAt: true,
  revokedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.DiscordInstallationSelect;

type SafeInstallation = Prisma.DiscordInstallationGetPayload<{
  select: typeof safeSelection;
}>;

function installationView(installation: SafeInstallation) {
  return {
    id: installation.externalId,
    displayName: installation.guildDisplayName,
    status: installation.status,
    installedAt: installation.installedAt,
    disconnectedAt: installation.disconnectedAt,
    revokedAt: installation.revokedAt,
    createdAt: installation.createdAt,
    updatedAt: installation.updatedAt,
  };
}

export class PrismaDiscordInstallationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(accountId: string) {
    const installations = await this.prisma.discordInstallation.findMany({
      where: { accountId },
      select: safeSelection,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return installations.map(installationView);
  }

  async providerIdentity(accountId: string, installationExternalId: string) {
    return this.prisma.discordInstallation.findUnique({
      where: {
        accountId_externalId: {
          accountId,
          externalId: installationExternalId,
        },
      },
      select: { id: true, guildId: true, status: true },
    });
  }

  async connect(input: {
    accountId: string;
    guildId: string;
    guildDisplayName: string;
    credentialReference: string;
    installerFingerprint: string;
    actor: TrustedActorContext;
    correlationId?: string;
  }) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<Array<{ now: Date }>>`
          SELECT clock_timestamp() AS now
        `;
        const now = rows[0]?.now;
        if (!now) return { outcome: "unavailable" as const };
        const existing = await tx.discordInstallation.findUnique({
          where: { guildId: input.guildId },
          select: {
            ...safeSelection,
            accountId: true,
          },
        });
        if (
          (existing && existing.accountId !== input.accountId) ||
          existing?.status === DiscordInstallationStatus.REVOKED
        ) {
          return { outcome: "unavailable" as const };
        }

        const stored = existing
          ? await tx.discordInstallation.update({
              where: { id: existing.id },
              data: {
                guildDisplayName: input.guildDisplayName,
                credentialReference: input.credentialReference,
                status: DiscordInstallationStatus.ACTIVE,
                installedAt: existing.installedAt ?? now,
                disconnectedAt: null,
              },
              select: safeSelection,
            })
          : await tx.discordInstallation.create({
              data: {
                accountId: input.accountId,
                guildId: input.guildId,
                guildDisplayName: input.guildDisplayName,
                credentialReference: input.credentialReference,
                status: DiscordInstallationStatus.ACTIVE,
                installedAt: now,
              },
              select: safeSelection,
            });

        await tx.securityAuditRecord.create({
          data: {
            scope: AuditScope.ACCOUNT,
            accountId: input.accountId,
            actorKind: actorKind(input.actor.actorKind),
            actorId: input.actor.actorId,
            actorUserId: input.actor.actorUserId,
            action: existing
              ? "discord.installation.reauthorized"
              : "discord.installation.connected",
            capability: input.actor.capability,
            targetType: "DiscordInstallation",
            targetId: stored.id,
            outcome: AuditOutcome.SUCCEEDED,
            ...(input.correlationId
              ? { correlationId: input.correlationId }
              : {}),
            metadata: {
              serverId: stored.externalId,
              category: "installation",
              installerFingerprint: input.installerFingerprint,
              before: existing ? { status: existing.status } : null,
              after: { status: stored.status },
            },
          },
        });
        return {
          outcome: existing
            ? ("reauthorized" as const)
            : ("connected" as const),
          installation: installationView(stored),
        };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return { outcome: "unavailable" as const };
      }
      throw error;
    }
  }

  async disconnect(input: {
    accountId: string;
    installationExternalId: string;
    actor: TrustedActorContext;
    correlationId?: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ now: Date }>>`
        SELECT clock_timestamp() AS now
      `;
      const now = rows[0]?.now;
      if (!now) return { outcome: "unavailable" as const };
      const installation = await tx.discordInstallation.findUnique({
        where: {
          accountId_externalId: {
            accountId: input.accountId,
            externalId: input.installationExternalId,
          },
        },
        select: { ...safeSelection, accountId: true },
      });
      if (
        !installation ||
        installation.status === DiscordInstallationStatus.REVOKED
      ) {
        return { outcome: "unavailable" as const };
      }

      await tx.discordIntegrationSettings.updateMany({
        where: {
          accountId: input.accountId,
          installationId: installation.id,
          enabled: true,
        },
        data: { enabled: false, revision: { increment: 1 } },
      });
      await tx.discordRoleGrant.updateMany({
        where: {
          accountId: input.accountId,
          installationId: installation.id,
          status: DiscordRoleGrantStatus.ACTIVE,
        },
        data: {
          status: DiscordRoleGrantStatus.REVOKED,
          revokedAt: now,
          revision: { increment: 1 },
        },
      });
      await tx.discordGuildRole.updateMany({
        where: {
          accountId: input.accountId,
          installationId: installation.id,
          enabled: true,
        },
        data: { enabled: false },
      });
      const stored = await tx.discordInstallation.update({
        where: { id: installation.id },
        data: {
          status: DiscordInstallationStatus.DISCONNECTED,
          installedAt: installation.installedAt ?? now,
          disconnectedAt: installation.disconnectedAt ?? now,
        },
        select: safeSelection,
      });
      await tx.securityAuditRecord.create({
        data: {
          scope: AuditScope.ACCOUNT,
          accountId: input.accountId,
          actorKind: actorKind(input.actor.actorKind),
          actorId: input.actor.actorId,
          actorUserId: input.actor.actorUserId,
          action: "discord.installation.disconnected",
          capability: input.actor.capability,
          targetType: "DiscordInstallation",
          targetId: stored.id,
          outcome: AuditOutcome.SUCCEEDED,
          ...(input.correlationId
            ? { correlationId: input.correlationId }
            : {}),
          metadata: {
            serverId: stored.externalId,
            category: "installation",
            before: { status: installation.status },
            after: { status: stored.status },
          },
        },
      });
      return {
        outcome:
          installation.status === DiscordInstallationStatus.DISCONNECTED
            ? ("unchanged" as const)
            : ("disconnected" as const),
        installation: installationView(stored),
      };
    });
  }
}
