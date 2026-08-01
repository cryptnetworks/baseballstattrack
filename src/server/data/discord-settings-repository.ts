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
import {
  nextDiscordEvaluation,
  type DiscordSchedulePolicy,
} from "@/domain/discord-update-schedule";
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
              canView: true,
              canSend: true,
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
        available:
          route.destination.enabled &&
          route.destination.canView &&
          route.destination.canSend,
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
          cadenceMode: stored.cadenceMode,
          gameDayWindow: {
            enabled: stored.gameDayWindowEnabled,
            startMinute: stored.gameDayStartMinute,
            endMinute: stored.gameDayEndMinute,
          },
          digest: {
            enabled: stored.digestEnabled,
            minute: stored.digestMinute,
          },
          catchUpPolicy: stored.catchUpPolicy,
          triggers: [...stored.triggers],
          messageFormat: stored.messageFormat,
          quietHours: {
            enabled: stored.quietHoursEnabled,
            startMinute: stored.quietStartMinute,
            endMinute: stored.quietEndMinute,
            timeZone: stored.quietTimeZone,
          },
          pausedAt: stored.pausedAt,
          manualRefreshRequestedAt: stored.manualRefreshRequestedAt,
          nextScheduledEvaluationAt: stored.nextScheduledEvaluationAt,
          lastSuccessfulUpdateAt: stored.lastSuccessfulUpdateAt,
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
  cadenceMode: string;
  cadenceSeconds: number;
  gameDayWindow: { enabled: boolean };
  digest: { enabled: boolean; minute: number };
  catchUpPolicy: string;
  triggers: readonly string[];
  messageFormat: string;
  quietHours: { enabled: boolean; timeZone: string };
  trackedScopes: readonly unknown[];
  destinations: readonly unknown[];
}) {
  return {
    enabled: input.enabled,
    cadenceMode: input.cadenceMode,
    cadenceSeconds: input.cadenceSeconds,
    gameDayWindowEnabled: input.gameDayWindow.enabled,
    digestEnabled: input.digest.enabled,
    digestMinute: input.digest.minute,
    catchUpPolicy: input.catchUpPolicy,
    triggerCount: input.triggers.length,
    messageFormat: input.messageFormat,
    quietHoursEnabled: input.quietHours.enabled,
    quietTimeZone: input.quietHours.timeZone,
    trackedScopeCount: input.trackedScopes.length,
    destinationCount: input.destinations.length,
  };
}

function schedulePolicy(input: {
  cadenceMode: DiscordSchedulePolicy["cadenceMode"];
  cadenceSeconds: number;
  gameDayWindow: DiscordSchedulePolicy["gameDayWindow"];
  digest: DiscordSchedulePolicy["digest"];
  catchUpPolicy: DiscordSchedulePolicy["catchUpPolicy"];
}): DiscordSchedulePolicy {
  return {
    cadenceMode: input.cadenceMode,
    cadenceSeconds: input.cadenceSeconds,
    gameDayWindow: input.gameDayWindow,
    digest: input.digest,
    catchUpPolicy: input.catchUpPolicy,
  };
}

function storedSchedule(
  input: NonNullable<InstallationWithSettings["settings"]>,
) {
  return schedulePolicy({
    cadenceMode: input.cadenceMode,
    cadenceSeconds: input.cadenceSeconds,
    gameDayWindow: {
      enabled: input.gameDayWindowEnabled,
      startMinute: input.gameDayStartMinute,
      endMinute: input.gameDayEndMinute,
    },
    digest: { enabled: input.digestEnabled, minute: input.digestMinute },
    catchUpPolicy: input.catchUpPolicy,
  });
}

function sameSchedule(
  current: NonNullable<InstallationWithSettings["settings"]>,
  input: DiscordSettingsUpdateInput,
) {
  return (
    JSON.stringify(storedSchedule(current)) ===
    JSON.stringify(schedulePolicy(input))
  );
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
                canView: true,
                canSend: true,
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
        const now = new Date();
        const pausing = Boolean(current?.enabled && !input.enabled);
        const resuming = Boolean(
          current &&
          !current.enabled &&
          input.enabled &&
          current.pausedAt &&
          input.catchUpPolicy === "LATEST_ONLY",
        );
        const manualRefreshRequestedAt = input.enabled
          ? (current?.manualRefreshRequestedAt ?? null)
          : null;
        const nextScheduledEvaluationAt =
          current &&
          current.enabled === input.enabled &&
          sameSchedule(current, input) &&
          current.quietHoursEnabled === input.quietHours.enabled &&
          current.quietStartMinute === input.quietHours.startMinute &&
          current.quietEndMinute === input.quietHours.endMinute &&
          current.quietTimeZone === input.quietHours.timeZone
            ? current.nextScheduledEvaluationAt
            : nextDiscordEvaluation({
                enabled: input.enabled,
                policy: schedulePolicy(input),
                quietHours: input.quietHours,
                now,
                manualRefreshRequestedAt,
                resumeCatchUp: resuming,
              });
        const storedData = {
          enabled: input.enabled,
          cadenceMode: input.cadenceMode,
          cadenceSeconds: input.cadenceSeconds,
          gameDayWindowEnabled: input.gameDayWindow.enabled,
          gameDayStartMinute: input.gameDayWindow.startMinute,
          gameDayEndMinute: input.gameDayWindow.endMinute,
          digestEnabled: input.digest.enabled,
          digestMinute: input.digest.minute,
          catchUpPolicy: input.catchUpPolicy,
          triggers: input.triggers,
          messageFormat: input.messageFormat,
          quietHoursEnabled: input.quietHours.enabled,
          quietStartMinute: input.quietHours.startMinute,
          quietEndMinute: input.quietHours.endMinute,
          quietTimeZone: input.quietHours.timeZone,
          pausedAt: input.enabled
            ? null
            : input.auditAction === "reset"
              ? null
              : pausing
                ? now
                : (current?.pausedAt ?? null),
          manualRefreshRequestedAt,
          nextScheduledEvaluationAt,
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
                    cadenceMode: current.cadenceMode,
                    cadenceSeconds: current.cadenceSeconds,
                    gameDayWindow: {
                      enabled: current.gameDayWindowEnabled,
                    },
                    digest: {
                      enabled: current.digestEnabled,
                      minute: current.digestMinute,
                    },
                    catchUpPolicy: current.catchUpPolicy,
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

  async requestManualRefresh(input: {
    accountId: string;
    installationId: string;
    expectedRevision: number;
    actor: TrustedActorContext;
    now: Date;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const installation = await tx.discordInstallation.findUnique({
        where: {
          accountId_externalId: {
            accountId: input.accountId,
            externalId: input.installationId,
          },
        },
        include: installationInclude,
      });
      const settings = installation?.settings;
      if (!installation || !settings)
        return { outcome: "unavailable" as const };
      if (
        installation.status !== DiscordInstallationStatus.ACTIVE ||
        !settings.enabled
      ) {
        return { outcome: "inactive" as const };
      }
      if (settings.revision !== input.expectedRevision) {
        throw new DiscordSettingsConflictError();
      }
      let coalesced = settings.manualRefreshRequestedAt !== null;
      if (!coalesced) {
        const requestedAt = input.now;
        const next = nextDiscordEvaluation({
          enabled: true,
          policy: storedSchedule(settings),
          quietHours: {
            enabled: settings.quietHoursEnabled,
            startMinute: settings.quietStartMinute,
            endMinute: settings.quietEndMinute,
            timeZone: settings.quietTimeZone,
          },
          now: input.now,
          manualRefreshRequestedAt: requestedAt,
        });
        const updated = await tx.discordIntegrationSettings.updateMany({
          where: {
            id: settings.id,
            revision: settings.revision,
            manualRefreshRequestedAt: null,
          },
          data: {
            manualRefreshRequestedAt: requestedAt,
            nextScheduledEvaluationAt: next,
          },
        });
        if (updated.count !== 1) {
          const concurrent = await tx.discordIntegrationSettings.findUnique({
            where: { id: settings.id },
            select: { revision: true, manualRefreshRequestedAt: true },
          });
          if (
            concurrent?.revision !== settings.revision ||
            !concurrent.manualRefreshRequestedAt
          ) {
            throw new DiscordSettingsConflictError();
          }
          coalesced = true;
        }
      }
      await tx.securityAuditRecord.create({
        data: {
          scope: AuditScope.ACCOUNT,
          accountId: input.accountId,
          actorKind: actorKind(input.actor.actorKind),
          actorId: input.actor.actorId,
          actorUserId: input.actor.actorUserId,
          action: "discord.settings.manual_refresh",
          capability: input.actor.capability,
          targetType: "DiscordIntegrationSettings",
          targetId: settings.id,
          outcome: AuditOutcome.SUCCEEDED,
          metadata: { revision: settings.revision, coalesced },
        },
      });
      const refreshed = await tx.discordInstallation.findUniqueOrThrow({
        where: { id: installation.id },
        include: installationInclude,
      });
      return {
        outcome: "requested" as const,
        coalesced,
        configuration: settingsView(refreshed),
      };
    });
  }
}
