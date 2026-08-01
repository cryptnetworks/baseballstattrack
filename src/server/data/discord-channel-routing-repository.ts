import { randomUUID } from "node:crypto";

import {
  ActorKind,
  AuditOutcome,
  AuditScope,
  DiscordInstallationStatus,
  type PrismaClient,
} from "@prisma/client";

import type { DiscordMessageFormat } from "@/domain/discord-settings";
import type { TrustedActorContext } from "@/server/auth/types";
import type { VerifiedDiscordChannel } from "@/server/providers/discord-channels";

function actorKind(value: "USER" | "SERVICE") {
  return value === "USER" ? ActorKind.USER : ActorKind.SERVICE;
}

const channelSelection = {
  externalId: true,
  displayName: true,
  enabled: true,
  canView: true,
  canSend: true,
  lastVerifiedAt: true,
  updatedAt: true,
} as const;

export class PrismaDiscordChannelRoutingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getWorkspace(accountId: string, installationExternalId: string) {
    const installation = await this.prisma.discordInstallation.findUnique({
      where: {
        accountId_externalId: {
          accountId,
          externalId: installationExternalId,
        },
      },
      select: {
        externalId: true,
        status: true,
        destinations: {
          select: channelSelection,
          orderBy: [{ displayName: "asc" }, { externalId: "asc" }],
        },
      },
    });
    if (!installation) return null;
    const accessible = installation.destinations.filter(
      ({ canView, canSend }) => canView && canSend,
    );
    const verified = installation.destinations
      .map(({ lastVerifiedAt }) => lastVerifiedAt)
      .filter((value) => value !== null)
      .sort((left, right) => right.getTime() - left.getTime());
    return {
      installation: {
        id: installation.externalId,
        status: installation.status,
      },
      channels: accessible.map((channel) => ({
        id: channel.externalId,
        displayName: channel.displayName ?? "Discord channel",
        enabled: channel.enabled,
        lastVerifiedAt: channel.lastVerifiedAt,
        updatedAt: channel.updatedAt,
      })),
      missingPermissions: {
        viewChannel: installation.destinations.filter(({ canView }) => !canView)
          .length,
        sendMessages: installation.destinations.filter(
          ({ canView, canSend }) => canView && !canSend,
        ).length,
      },
      lastVerifiedAt: verified[0] ?? null,
    };
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

  async syncChannels(input: {
    accountId: string;
    installationExternalId: string;
    channels: readonly VerifiedDiscordChannel[];
    actor: TrustedActorContext;
  }) {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const installation = await tx.discordInstallation.findUnique({
        where: {
          accountId_externalId: {
            accountId: input.accountId,
            externalId: input.installationExternalId,
          },
        },
        select: { id: true, status: true },
      });
      if (
        !installation ||
        installation.status !== DiscordInstallationStatus.ACTIVE
      ) {
        return { outcome: "unavailable" as const };
      }
      const rows = await tx.$queryRaw<Array<{ now: Date }>>`
        SELECT clock_timestamp() AS now
      `;
      const now = rows[0]?.now;
      if (!now) return { outcome: "unavailable" as const };

      const providerIds = input.channels.map(({ channelId }) => channelId);
      for (const channel of input.channels) {
        await tx.discordChannelDestination.upsert({
          where: {
            installationId_channelId: {
              installationId: installation.id,
              channelId: channel.channelId,
            },
          },
          update: {
            displayName: channel.displayName,
            canView: channel.canView,
            canSend: channel.canSend,
            lastVerifiedAt: now,
          },
          create: {
            accountId: input.accountId,
            installationId: installation.id,
            channelId: channel.channelId,
            channelReference: `discord/channels/${randomUUID()}`,
            displayName: channel.displayName,
            enabled: true,
            canView: channel.canView,
            canSend: channel.canSend,
            lastVerifiedAt: now,
          },
        });
      }
      await tx.discordChannelDestination.updateMany({
        where: {
          accountId: input.accountId,
          installationId: installation.id,
          ...(providerIds.length ? { channelId: { notIn: providerIds } } : {}),
        },
        data: { canView: false, canSend: false, lastVerifiedAt: now },
      });

      const settings = await tx.discordIntegrationSettings.findUnique({
        where: {
          accountId_installationId: {
            accountId: input.accountId,
            installationId: installation.id,
          },
        },
        select: { id: true, enabled: true },
      });
      let invalidatedRouteCount = 0;
      if (settings) {
        const invalid = await tx.discordSettingsDestination.findMany({
          where: {
            accountId: input.accountId,
            settingsId: settings.id,
            destination: {
              OR: [{ enabled: false }, { canView: false }, { canSend: false }],
            },
          },
          select: { id: true },
        });
        invalidatedRouteCount = invalid.length;
        if (invalid.length) {
          await tx.discordSettingsDestination.deleteMany({
            where: { id: { in: invalid.map(({ id }) => id) } },
          });
          const remaining = await tx.discordSettingsDestination.count({
            where: { settingsId: settings.id },
          });
          await tx.discordIntegrationSettings.update({
            where: { id: settings.id },
            data: {
              revision: { increment: 1 },
              ...(settings.enabled && remaining === 0
                ? { enabled: false }
                : {}),
            },
          });
        }
      }

      await tx.securityAuditRecord.create({
        data: {
          scope: AuditScope.ACCOUNT,
          accountId: input.accountId,
          actorKind: actorKind(input.actor.actorKind),
          actorId: input.actor.actorId,
          actorUserId: input.actor.actorUserId,
          action: "discord.channels.synchronized",
          capability: input.actor.capability,
          targetType: "DiscordInstallation",
          targetId: installation.id,
          outcome: AuditOutcome.SUCCEEDED,
          metadata: {
            category: "channel-routing",
            discoveredCount: input.channels.length,
            routableCount: input.channels.filter(
              ({ canView, canSend }) => canView && canSend,
            ).length,
            missingViewCount: input.channels.filter(({ canView }) => !canView)
              .length,
            missingSendCount: input.channels.filter(
              ({ canView, canSend }) => canView && !canSend,
            ).length,
            invalidatedRouteCount,
          },
        },
      });
      return { outcome: "synchronized" as const };
    });
    return outcome.outcome === "synchronized"
      ? this.getWorkspace(input.accountId, input.installationExternalId)
      : null;
  }

  async setChannelEnabled(input: {
    accountId: string;
    installationExternalId: string;
    destinationExternalId: string;
    enabled: boolean;
    actor: TrustedActorContext;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const destination = await tx.discordChannelDestination.findUnique({
        where: {
          accountId_externalId: {
            accountId: input.accountId,
            externalId: input.destinationExternalId,
          },
        },
        select: {
          id: true,
          enabled: true,
          canView: true,
          canSend: true,
          installation: { select: { id: true, externalId: true } },
        },
      });
      if (
        !destination ||
        destination.installation.externalId !== input.installationExternalId ||
        (input.enabled && (!destination.canView || !destination.canSend))
      ) {
        return { outcome: "unavailable" as const };
      }
      if (destination.enabled === input.enabled) {
        return { outcome: "unchanged" as const };
      }
      let removedRouteCount = 0;
      if (!input.enabled) {
        const settings = await tx.discordIntegrationSettings.findUnique({
          where: {
            accountId_installationId: {
              accountId: input.accountId,
              installationId: destination.installation.id,
            },
          },
          select: { id: true, enabled: true },
        });
        if (settings) {
          const removed = await tx.discordSettingsDestination.deleteMany({
            where: {
              accountId: input.accountId,
              settingsId: settings.id,
              destinationId: destination.id,
            },
          });
          removedRouteCount = removed.count;
          if (removed.count) {
            const remaining = await tx.discordSettingsDestination.count({
              where: { settingsId: settings.id },
            });
            await tx.discordIntegrationSettings.update({
              where: { id: settings.id },
              data: {
                revision: { increment: 1 },
                ...(settings.enabled && remaining === 0
                  ? { enabled: false }
                  : {}),
              },
            });
          }
        }
      }
      await tx.discordChannelDestination.update({
        where: { id: destination.id },
        data: { enabled: input.enabled },
      });
      await tx.securityAuditRecord.create({
        data: {
          scope: AuditScope.ACCOUNT,
          accountId: input.accountId,
          actorKind: actorKind(input.actor.actorKind),
          actorId: input.actor.actorId,
          actorUserId: input.actor.actorUserId,
          action: input.enabled
            ? "discord.channel.enabled"
            : "discord.channel.disabled",
          capability: input.actor.capability,
          targetType: "DiscordChannelDestination",
          targetId: destination.id,
          outcome: AuditOutcome.SUCCEEDED,
          metadata: {
            category: "channel-routing",
            removedRouteCount,
          },
        },
      });
      return { outcome: "updated" as const };
    });
  }

  async resolveTestDestination(
    accountId: string,
    installationExternalId: string,
    destinationExternalId: string,
  ) {
    const destination = await this.prisma.discordChannelDestination.findUnique({
      where: {
        accountId_externalId: {
          accountId,
          externalId: destinationExternalId,
        },
      },
      select: {
        id: true,
        channelId: true,
        enabled: true,
        canView: true,
        canSend: true,
        installation: {
          select: { externalId: true, guildId: true, status: true },
        },
      },
    });
    if (
      !destination ||
      destination.installation.externalId !== installationExternalId ||
      destination.installation.status !== DiscordInstallationStatus.ACTIVE ||
      !destination.enabled ||
      !destination.canView ||
      !destination.canSend
    ) {
      return null;
    }
    return {
      internalId: destination.id,
      channelId: destination.channelId,
      guildId: destination.installation.guildId,
    };
  }

  async recordTestDelivery(input: {
    accountId: string;
    destinationInternalId: string;
    messageFormat: DiscordMessageFormat;
    actor: TrustedActorContext;
    succeeded: boolean;
    failureCode?: string;
  }) {
    await this.prisma.securityAuditRecord.create({
      data: {
        scope: AuditScope.ACCOUNT,
        accountId: input.accountId,
        actorKind: actorKind(input.actor.actorKind),
        actorId: input.actor.actorId,
        actorUserId: input.actor.actorUserId,
        action: "discord.channel.test_delivery",
        capability: input.actor.capability,
        targetType: "DiscordChannelDestination",
        targetId: input.destinationInternalId,
        outcome: input.succeeded ? AuditOutcome.SUCCEEDED : AuditOutcome.FAILED,
        ...(input.failureCode ? { reasonCode: input.failureCode } : {}),
        metadata: {
          category: "channel-routing",
          messageFormat: input.messageFormat,
        },
      },
    });
  }

  async recordConfigurationPreview(input: {
    accountId: string;
    installationInternalId: string;
    settingsRevision: number;
    errorCount: number;
    warningCount: number;
    actor: TrustedActorContext;
  }) {
    await this.prisma.securityAuditRecord.create({
      data: {
        scope: AuditScope.ACCOUNT,
        accountId: input.accountId,
        actorKind: actorKind(input.actor.actorKind),
        actorId: input.actor.actorId,
        actorUserId: input.actor.actorUserId,
        action: "discord.settings.preview",
        capability: input.actor.capability,
        targetType: "DiscordInstallation",
        targetId: input.installationInternalId,
        outcome: AuditOutcome.SUCCEEDED,
        metadata: {
          category: "configuration-preview",
          settingsRevision: input.settingsRevision,
          errorCount: input.errorCount,
          warningCount: input.warningCount,
          syntheticDataOnly: true,
        },
      },
    });
  }
}
