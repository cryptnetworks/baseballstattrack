import {
  ActorKind,
  AuditOutcome,
  AuditScope,
  DiscordInstallationStatus,
  Prisma,
  type PrismaClient,
} from "@prisma/client";

import {
  DISCORD_SETTINGS_SCHEMA_VERSION,
  discordSettingsDefaults,
  type DiscordSettingsUpdateInput,
} from "@/domain/discord-settings";
import type { TrustedActorContext } from "@/server/auth/types";

export class DiscordSettingsConflictError extends Error {
  constructor() {
    super("Discord settings revision conflict.");
    this.name = "DiscordSettingsConflictError";
  }
}

const installationInclude = {
  settings: {
    include: {
      trackedScopes: {
        include: {
          teamSeason: {
            select: {
              team: { select: { externalId: true } },
              season: { select: { externalId: true } },
            },
          },
        },
      },
      destinations: {
        include: {
          destination: {
            select: {
              externalId: true,
              channelReference: true,
              displayName: true,
              enabled: true,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.DiscordInstallationInclude;

type InstallationWithSettings = Prisma.DiscordInstallationGetPayload<{
  include: typeof installationInclude;
}>;

function actorKind(value: "USER" | "SERVICE") {
  return value === "USER" ? ActorKind.USER : ActorKind.SERVICE;
}

function settingsView(installation: InstallationWithSettings) {
  const stored = installation.settings;
  const destinationMap = new Map<
    string,
    {
      destinationId: string;
      channelReference: string;
      displayName: string | null;
      available: boolean;
      purposes: string[];
    }
  >();
  for (const route of stored?.destinations ?? []) {
    const key = route.destination.externalId;
    const existing = destinationMap.get(key);
    if (existing) {
      existing.purposes.push(route.purpose);
    } else {
      destinationMap.set(key, {
        destinationId: key,
        channelReference: route.destination.channelReference,
        displayName: route.destination.displayName,
        available: route.destination.enabled,
        purposes: [route.purpose],
      });
    }
  }
  return {
    installation: {
      id: installation.externalId,
      guildId: installation.guildId,
      guildDisplayName: installation.guildDisplayName,
      status: installation.status,
    },
    settings: stored
      ? {
          id: stored.externalId,
          schemaVersion: stored.schemaVersion,
          revision: stored.revision,
          enabled: stored.enabled,
          trackedScopes: stored.trackedScopes
            .map(({ teamSeason }) => ({
              teamId: teamSeason.team.externalId,
              seasonId: teamSeason.season.externalId,
            }))
            .sort((left, right) =>
              `${left.teamId}:${left.seasonId}`.localeCompare(
                `${right.teamId}:${right.seasonId}`,
              ),
            ),
          destinations: [...destinationMap.values()]
            .map((destination) => ({
              ...destination,
              purposes: destination.purposes.sort(),
            }))
            .sort((left, right) =>
              left.destinationId.localeCompare(right.destinationId),
            ),
          cadenceSeconds: stored.cadenceSeconds,
          triggers: [...stored.triggers],
          messageFormat: stored.messageFormat,
          quietHours: {
            enabled: stored.quietHoursEnabled,
            startMinute: stored.quietStartMinute,
            endMinute: stored.quietEndMinute,
            timeZone: stored.quietTimeZone,
          },
          createdAt: stored.createdAt,
          updatedAt: stored.updatedAt,
        }
      : {
          ...discordSettingsDefaults,
          id: null,
          createdAt: null,
          updatedAt: null,
        },
  };
}

function auditSummary(input: {
  enabled: boolean;
  cadenceSeconds: number;
  triggers: readonly string[];
  messageFormat: string;
  quietHours: { enabled: boolean; timeZone: string };
  trackedScopes: readonly unknown[];
  destinations: readonly unknown[];
}) {
  return {
    enabled: input.enabled,
    cadenceSeconds: input.cadenceSeconds,
    triggerCount: input.triggers.length,
    messageFormat: input.messageFormat,
    quietHoursEnabled: input.quietHours.enabled,
    quietTimeZone: input.quietHours.timeZone,
    trackedScopeCount: input.trackedScopes.length,
    destinationCount: input.destinations.length,
  };
}

export class PrismaDiscordSettingsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getConfiguration(accountId: string, installationExternalId: string) {
    const installation = await this.prisma.discordInstallation.findUnique({
      where: {
        accountId_externalId: {
          accountId,
          externalId: installationExternalId,
        },
      },
      include: installationInclude,
    });
    return installation ? settingsView(installation) : null;
  }

  async writeConfiguration(
    input: DiscordSettingsUpdateInput & {
      actor: TrustedActorContext;
      auditAction: "update" | "reset";
      reasonCode?: string;
    },
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const installation = await tx.discordInstallation.findUnique({
          where: {
            accountId_externalId: {
              accountId: input.accountId,
              externalId: input.installationId,
            },
          },
          include: installationInclude,
        });
        if (!installation) return { outcome: "unavailable" as const };
        if (
          input.enabled &&
          installation.status !== DiscordInstallationStatus.ACTIVE
        ) {
          return { outcome: "installation_inactive" as const };
        }

        const scopes = input.trackedScopes.length
          ? await tx.teamSeason.findMany({
              where: {
                accountId: input.accountId,
                OR: input.trackedScopes.map(({ teamId, seasonId }) => ({
                  team: { externalId: teamId },
                  season: { externalId: seasonId },
                })),
              },
              select: {
                id: true,
                team: { select: { externalId: true } },
                season: { select: { externalId: true } },
              },
            })
          : [];
        if (scopes.length !== input.trackedScopes.length) {
          return { outcome: "unavailable" as const };
        }

        const destinationIds = input.destinations.map(
          ({ destinationId }) => destinationId,
        );
        const destinations = destinationIds.length
          ? await tx.discordChannelDestination.findMany({
              where: {
                accountId: input.accountId,
                installationId: installation.id,
                externalId: { in: destinationIds },
                enabled: true,
              },
              select: { id: true, externalId: true },
            })
          : [];
        if (destinations.length !== destinationIds.length) {
          return { outcome: "unavailable" as const };
        }

        const current = installation.settings;
        const currentRevision = current?.revision ?? 0;
        if (currentRevision !== input.expectedRevision) {
          throw new DiscordSettingsConflictError();
        }
        const nextRevision = currentRevision + 1;
        const storedData = {
          enabled: input.enabled,
          cadenceSeconds: input.cadenceSeconds,
          triggers: input.triggers,
          messageFormat: input.messageFormat,
          quietHoursEnabled: input.quietHours.enabled,
          quietStartMinute: input.quietHours.startMinute,
          quietEndMinute: input.quietHours.endMinute,
          quietTimeZone: input.quietHours.timeZone,
        };
        let settingsId: string;
        if (current) {
          const updated = await tx.discordIntegrationSettings.updateMany({
            where: { id: current.id, revision: currentRevision },
            data: { ...storedData, revision: nextRevision },
          });
          if (updated.count !== 1) throw new DiscordSettingsConflictError();
          settingsId = current.id;
          await tx.discordSettingsScope.deleteMany({ where: { settingsId } });
          await tx.discordSettingsDestination.deleteMany({
            where: { settingsId },
          });
        } else {
          const created = await tx.discordIntegrationSettings.create({
            data: {
              accountId: input.accountId,
              installationId: installation.id,
              schemaVersion: DISCORD_SETTINGS_SCHEMA_VERSION,
              revision: nextRevision,
              ...storedData,
            },
          });
          settingsId = created.id;
        }

        if (scopes.length) {
          await tx.discordSettingsScope.createMany({
            data: scopes.map(({ id: teamSeasonId }) => ({
              accountId: input.accountId,
              settingsId,
              teamSeasonId,
            })),
          });
        }
        if (destinations.length) {
          const byExternalId = new Map(
            destinations.map((destination) => [
              destination.externalId,
              destination.id,
            ]),
          );
          await tx.discordSettingsDestination.createMany({
            data: input.destinations.flatMap(({ destinationId, purposes }) =>
              purposes.map((purpose) => ({
                accountId: input.accountId,
                settingsId,
                destinationId: byExternalId.get(destinationId)!,
                purpose,
              })),
            ),
          });
        }

        await tx.securityAuditRecord.create({
          data: {
            scope: AuditScope.ACCOUNT,
            accountId: input.accountId,
            actorKind: actorKind(input.actor.actorKind),
            actorId: input.actor.actorId,
            actorUserId: input.actor.actorUserId,
            action: `discord.settings.${input.auditAction}`,
            capability: input.actor.capability,
            targetType: "DiscordIntegrationSettings",
            targetId: settingsId,
            outcome: AuditOutcome.SUCCEEDED,
            ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}),
            metadata: {
              schemaVersion: DISCORD_SETTINGS_SCHEMA_VERSION,
              beforeRevision: currentRevision,
              afterRevision: nextRevision,
              before: current
                ? auditSummary({
                    enabled: current.enabled,
                    cadenceSeconds: current.cadenceSeconds,
                    triggers: current.triggers,
                    messageFormat: current.messageFormat,
                    quietHours: {
                      enabled: current.quietHoursEnabled,
                      timeZone: current.quietTimeZone,
                    },
                    trackedScopes: current.trackedScopes,
                    destinations: [
                      ...new Set(
                        current.destinations.map(
                          ({ destinationId }) => destinationId,
                        ),
                      ),
                    ],
                  })
                : auditSummary(discordSettingsDefaults),
              after: auditSummary(input),
            },
          },
        });

        const refreshed = await tx.discordInstallation.findUniqueOrThrow({
          where: { id: installation.id },
          include: installationInclude,
        });
        return {
          outcome: "updated" as const,
          configuration: settingsView(refreshed),
        };
      });
    } catch (error) {
      if (
        error instanceof DiscordSettingsConflictError ||
        (error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002")
      ) {
        throw new DiscordSettingsConflictError();
      }
      throw error;
    }
  }
}
