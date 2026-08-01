import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  DiscordSettingsConflictError,
  PrismaDiscordSettingsRepository,
} from "@/server/data/discord-settings-repository";
import { trustedActorForTest } from "../fixtures/trusted-actor";

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const prefix = `issue109-${process.pid}-${Date.now()}`;
const identitySuffix = String(Date.now()).padStart(13, "0").slice(-13);
const guildA = `11${identitySuffix}01`;
const guildB = `11${identitySuffix}02`;
const channelA = `22${identitySuffix}01`;
const channelB = `22${identitySuffix}02`;

integration("Discord settings persistence", () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl! }),
  });
  const repository = new PrismaDiscordSettingsRepository(prisma);
  const accountA = `${prefix}-account-a`;
  const accountB = `${prefix}-account-b`;
  const teamA = `${prefix}-team-a`;
  const teamB = `${prefix}-team-b`;
  const seasonA = `${prefix}-season-a`;
  const seasonB = `${prefix}-season-b`;
  const teamSeasonA = `${prefix}-team-season-a`;
  const teamSeasonB = `${prefix}-team-season-b`;
  let installationA = "";
  let installationB = "";
  let destinationA = "";
  let destinationB = "";
  let teamAExternal = "";
  let teamBExternal = "";
  let seasonAExternal = "";
  let seasonBExternal = "";

  const actor = trustedActorForTest({
    accountId: accountA,
    actorId: `${prefix}-administrator`,
    actorKind: "SERVICE",
    actorUserId: null,
    membershipId: null,
    capability: "discord.settings.configure",
    scope: { kind: "ACCOUNT" },
    authorizedAt: "2026-07-31T23:00:00.000Z",
  });
  const operator = trustedActorForTest({
    accountId: accountA,
    actorId: `${prefix}-operator`,
    actorKind: "SERVICE",
    actorUserId: null,
    membershipId: null,
    capability: "discord.settings.operate",
    scope: { kind: "ACCOUNT" },
    authorizedAt: "2026-08-01T05:00:00.000Z",
  });

  beforeAll(async () => {
    await prisma.account.createMany({
      data: [
        { id: accountA, slug: `${prefix}-a`, displayName: "Discord A" },
        { id: accountB, slug: `${prefix}-b`, displayName: "Discord B" },
      ],
    });
    const [createdTeamA, createdTeamB, createdSeasonA, createdSeasonB] =
      await Promise.all([
        prisma.team.create({
          data: { id: teamA, accountId: accountA, displayName: "Team A" },
        }),
        prisma.team.create({
          data: { id: teamB, accountId: accountB, displayName: "Team B" },
        }),
        prisma.season.create({
          data: {
            id: seasonA,
            accountId: accountA,
            displayName: "Season A",
          },
        }),
        prisma.season.create({
          data: {
            id: seasonB,
            accountId: accountB,
            displayName: "Season B",
          },
        }),
      ]);
    teamAExternal = createdTeamA.externalId;
    teamBExternal = createdTeamB.externalId;
    seasonAExternal = createdSeasonA.externalId;
    seasonBExternal = createdSeasonB.externalId;
    await prisma.teamSeason.createMany({
      data: [
        {
          id: teamSeasonA,
          accountId: accountA,
          teamId: teamA,
          seasonId: seasonA,
        },
        {
          id: teamSeasonB,
          accountId: accountB,
          teamId: teamB,
          seasonId: seasonB,
        },
      ],
    });
    const [createdInstallationA, createdInstallationB] = await Promise.all([
      prisma.discordInstallation.create({
        data: {
          accountId: accountA,
          guildId: guildA,
          guildDisplayName: "Guild A",
          credentialReference: "discord/installations/a",
          status: "ACTIVE",
          installedAt: new Date(),
        },
      }),
      prisma.discordInstallation.create({
        data: {
          accountId: accountB,
          guildId: guildB,
          guildDisplayName: "Guild B",
          credentialReference: "discord/installations/b",
          status: "ACTIVE",
          installedAt: new Date(),
        },
      }),
    ]);
    installationA = createdInstallationA.externalId;
    installationB = createdInstallationB.externalId;
    const [createdDestinationA, createdDestinationB] = await Promise.all([
      prisma.discordChannelDestination.create({
        data: {
          accountId: accountA,
          installationId: createdInstallationA.id,
          channelId: channelA,
          channelReference: "discord/channels/a-live",
          displayName: "Live scores",
        },
      }),
      prisma.discordChannelDestination.create({
        data: {
          accountId: accountB,
          installationId: createdInstallationB.id,
          channelId: channelB,
          channelReference: "discord/channels/b-live",
          displayName: "Other live scores",
        },
      }),
    ]);
    destinationA = createdDestinationA.externalId;
    destinationB = createdDestinationB.externalId;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const input = () => ({
    accountId: accountA,
    installationId: installationA,
    expectedRevision: 0,
    enabled: true,
    trackedScopes: [{ teamId: teamAExternal, seasonId: seasonAExternal }],
    destinations: [
      {
        destinationId: destinationA,
        purposes: ["LIVE_UPDATES" as const, "SUMMARIES" as const],
      },
    ],
    cadenceMode: "FIXED_INTERVAL" as const,
    cadenceSeconds: 60,
    gameDayWindow: {
      enabled: true,
      startMinute: 480,
      endMinute: 1_380,
    },
    digest: { enabled: true, minute: 540 },
    catchUpPolicy: "LATEST_ONLY" as const,
    triggers: ["SCORE_CHANGED" as const, "GAME_COMPLETED" as const],
    messageFormat: "COMPACT" as const,
    quietHours: {
      enabled: true,
      startMinute: 1_320,
      endMinute: 420,
      timeZone: "America/New_York",
    },
    actor,
    auditAction: "update" as const,
  });

  it("reads safe defaults and writes an exact tenant/server-scoped revision", async () => {
    const defaults = await repository.getConfiguration(accountA, installationA);
    expect(defaults).toMatchObject({
      installation: {
        id: installationA,
        guildId: guildA,
        status: "ACTIVE",
      },
      settings: { revision: 0, enabled: false, trackedScopes: [] },
    });
    expect(JSON.stringify(defaults)).not.toContain(channelA);
    expect(JSON.stringify(defaults)).not.toMatch(/credentialReference/iu);

    const result = await repository.writeConfiguration(input());
    expect(result).toMatchObject({
      outcome: "updated",
      configuration: {
        settings: {
          revision: 1,
          enabled: true,
          trackedScopes: [{ teamId: teamAExternal, seasonId: seasonAExternal }],
          destinations: [
            {
              destinationId: destinationA,
              channelReference: "discord/channels/a-live",
              purposes: ["LIVE_UPDATES", "SUMMARIES"],
            },
          ],
          cadenceMode: "FIXED_INTERVAL",
          gameDayWindow: { enabled: true },
          digest: { enabled: true, minute: 540 },
          catchUpPolicy: "LATEST_ONLY",
          nextScheduledEvaluationAt: expect.any(Date),
        },
      },
    });
    const audit = await prisma.securityAuditRecord.findFirstOrThrow({
      where: { accountId: accountA, action: "discord.settings.update" },
    });
    expect(JSON.stringify(audit.metadata)).not.toContain(guildA);
    expect(JSON.stringify(audit.metadata)).not.toContain(channelA);
    expect(JSON.stringify(audit.metadata)).not.toMatch(
      /discord\/installations|discord\/channels|credential/iu,
    );
    const stored = await prisma.discordIntegrationSettings.findUniqueOrThrow({
      where: {
        accountId_installationId: {
          accountId: accountA,
          installationId: (
            await prisma.discordInstallation.findUniqueOrThrow({
              where: {
                accountId_externalId: {
                  accountId: accountA,
                  externalId: installationA,
                },
              },
            })
          ).id,
        },
      },
    });
    await expect(
      prisma.discordIntegrationSettings.update({
        where: { id: stored.id },
        data: { triggers: ["GAME_COMPLETED", "GAME_COMPLETED"] },
      }),
    ).rejects.toBeTruthy();
    await expect(
      prisma.discordIntegrationSettings.update({
        where: { id: stored.id },
        data: { cadenceSeconds: 59 },
      }),
    ).rejects.toBeTruthy();
    await expect(
      prisma.discordIntegrationSettings.update({
        where: { id: stored.id },
        data: { pausedAt: new Date() },
      }),
    ).rejects.toBeTruthy();
    await expect(
      prisma.discordChannelDestination.update({
        where: {
          accountId_externalId: {
            accountId: accountA,
            externalId: destinationA,
          },
        },
        data: { enabled: false },
      }),
    ).rejects.toBeTruthy();
  });

  it("coalesces manual evaluations and records secret-free operational audits", async () => {
    const current = await repository.getConfiguration(accountA, installationA);
    const now = new Date("2026-08-01T12:00:00.000Z");
    const request = {
      accountId: accountA,
      installationId: installationA,
      expectedRevision: current!.settings.revision,
      actor: operator,
      now,
    };
    const first = await repository.requestManualRefresh(request);
    const retry = await repository.requestManualRefresh({
      ...request,
      now: new Date("2026-08-01T12:00:01.000Z"),
    });
    expect(first).toMatchObject({ outcome: "requested", coalesced: false });
    expect(retry).toMatchObject({ outcome: "requested", coalesced: true });
    expect(
      retry.outcome === "requested"
        ? retry.configuration.settings.manualRefreshRequestedAt
        : null,
    ).toEqual(now);
    const audits = await prisma.securityAuditRecord.findMany({
      where: {
        accountId: accountA,
        action: "discord.settings.manual_refresh",
      },
      orderBy: { createdAt: "asc" },
    });
    expect(audits.map(({ metadata }) => metadata)).toEqual([
      { revision: current!.settings.revision, coalesced: false },
      { revision: current!.settings.revision, coalesced: true },
    ]);
    expect(JSON.stringify(audits)).not.toContain(guildA);
    expect(JSON.stringify(audits)).not.toMatch(/guild|channel|credential/iu);
  });

  it("rejects stale revisions and cross-Account scopes or destinations", async () => {
    await expect(repository.writeConfiguration(input())).rejects.toBeInstanceOf(
      DiscordSettingsConflictError,
    );
    await expect(
      repository.writeConfiguration({
        ...input(),
        expectedRevision: 1,
        trackedScopes: [{ teamId: teamBExternal, seasonId: seasonBExternal }],
      }),
    ).resolves.toEqual({ outcome: "unavailable" });
    await expect(
      repository.writeConfiguration({
        ...input(),
        expectedRevision: 1,
        destinations: [
          { destinationId: destinationB, purposes: ["LIVE_UPDATES"] },
        ],
      }),
    ).resolves.toEqual({ outcome: "unavailable" });
    expect(
      await repository.getConfiguration(accountA, installationB),
    ).toBeNull();
  });

  it("allows one optimistic writer and resets all editable categories safely", async () => {
    const writes = await Promise.allSettled([
      repository.writeConfiguration({
        ...input(),
        expectedRevision: 1,
        cadenceSeconds: 120,
      }),
      repository.writeConfiguration({
        ...input(),
        expectedRevision: 1,
        cadenceSeconds: 180,
      }),
    ]);
    expect(writes.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    expect(writes.filter(({ status }) => status === "rejected")).toHaveLength(
      1,
    );
    const current = await repository.getConfiguration(accountA, installationA);
    const revision = current!.settings.revision;
    const reset = await repository.writeConfiguration({
      ...input(),
      expectedRevision: revision,
      enabled: false,
      trackedScopes: [],
      destinations: [],
      cadenceSeconds: 300,
      triggers: ["GAME_COMPLETED", "GAME_VERIFIED", "GAME_CORRECTED"],
      messageFormat: "STANDARD",
      quietHours: {
        enabled: false,
        startMinute: 1_320,
        endMinute: 420,
        timeZone: "UTC",
      },
      auditAction: "reset",
      reasonCode: "OPERATOR_RESET",
    });
    expect(reset).toMatchObject({
      outcome: "updated",
      configuration: {
        settings: {
          revision: revision + 1,
          enabled: false,
          trackedScopes: [],
          destinations: [],
          cadenceSeconds: 300,
          pausedAt: null,
          manualRefreshRequestedAt: null,
          nextScheduledEvaluationAt: null,
        },
      },
    });
  });
});
