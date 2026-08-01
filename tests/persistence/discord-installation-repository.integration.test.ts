import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaDiscordInstallationRepository } from "@/server/data/discord-installation-repository";
import { trustedActorForTest } from "../fixtures/trusted-actor";

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const prefix = `issue110-${process.pid}-${Date.now()}`;
const snowflakeSeed = `${Date.now()}${process.pid}`;

integration("Discord installation persistence", () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl! }),
  });
  const repository = new PrismaDiscordInstallationRepository(prisma);
  const accountA = `${prefix}-account-a`;
  const accountB = `${prefix}-account-b`;
  const guildA = `8${snowflakeSeed}`;
  let installationId = "";
  let installationInternalId = "";

  const configureActor = trustedActorForTest({
    accountId: accountA,
    actorId: `${prefix}-administrator`,
    actorKind: "SERVICE",
    actorUserId: null,
    membershipId: null,
    capability: "discord.settings.configure",
    scope: { kind: "ACCOUNT" },
    authorizedAt: new Date().toISOString(),
  });
  const operateActor = trustedActorForTest({
    accountId: accountA,
    actorId: `${prefix}-operator`,
    actorKind: "SERVICE",
    actorUserId: null,
    membershipId: null,
    capability: "discord.settings.operate",
    scope: { kind: "ACCOUNT" },
    authorizedAt: new Date().toISOString(),
  });

  beforeAll(async () => {
    await prisma.account.createMany({
      data: [
        { id: accountA, slug: `${prefix}-a`, displayName: "Account A" },
        { id: accountB, slug: `${prefix}-b`, displayName: "Account B" },
      ],
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("connects and idempotently reauthorizes one Account/guild binding", async () => {
    const first = await repository.connect({
      accountId: accountA,
      guildId: guildA,
      guildDisplayName: "First display name",
      credentialReference: "discord/bot/production",
      installerFingerprint: "a".repeat(64),
      actor: configureActor,
      correlationId: `${prefix}-connect`,
    });
    expect(first).toMatchObject({
      outcome: "connected",
      installation: { displayName: "First display name", status: "ACTIVE" },
    });
    if (first.outcome === "unavailable") throw new Error("connect unavailable");
    installationId = first.installation.id;
    const internal = await prisma.discordInstallation.findUniqueOrThrow({
      where: {
        accountId_externalId: {
          accountId: accountA,
          externalId: installationId,
        },
      },
    });
    installationInternalId = internal.id;

    const replay = await repository.connect({
      accountId: accountA,
      guildId: guildA,
      guildDisplayName: "Updated display name",
      credentialReference: "discord/bot/rotated",
      installerFingerprint: "b".repeat(64),
      actor: configureActor,
    });
    expect(replay).toMatchObject({
      outcome: "reauthorized",
      installation: {
        id: installationId,
        displayName: "Updated display name",
        status: "ACTIVE",
      },
    });
    expect(await repository.list(accountA)).toHaveLength(1);
    expect(JSON.stringify(await repository.list(accountA))).not.toContain(
      guildA,
    );
    expect(JSON.stringify(await repository.list(accountA))).not.toMatch(
      /credentialReference|discord\/bot/iu,
    );
  });

  it("does not enumerate or move a guild across Accounts", async () => {
    await expect(
      repository.connect({
        accountId: accountB,
        guildId: guildA,
        guildDisplayName: "Cross-account",
        credentialReference: "discord/bot/other",
        installerFingerprint: "c".repeat(64),
        actor: trustedActorForTest({
          accountId: accountB,
          actorId: `${prefix}-other-admin`,
          actorKind: "SERVICE",
          actorUserId: null,
          membershipId: null,
          capability: "discord.settings.configure",
          scope: { kind: "ACCOUNT" },
          authorizedAt: new Date().toISOString(),
        }),
      }),
    ).resolves.toEqual({ outcome: "unavailable" });
    expect(
      await repository.providerIdentity(accountB, installationId),
    ).toBeNull();
  });

  it("disconnects transactionally and idempotently revokes dependent access", async () => {
    const role = await prisma.discordGuildRole.create({
      data: {
        accountId: accountA,
        installationId: installationInternalId,
        roleId: `9${snowflakeSeed}`,
        roleReference: "discord/roles/operator",
        lastVerifiedAt: new Date(),
      },
    });
    await prisma.discordRoleGrant.create({
      data: {
        accountId: accountA,
        installationId: installationInternalId,
        guildRoleId: role.id,
        actions: ["READ_ONLY"],
      },
    });
    const team = await prisma.team.create({
      data: {
        id: `${prefix}-team`,
        accountId: accountA,
        displayName: "Integration team",
      },
    });
    const season = await prisma.season.create({
      data: {
        id: `${prefix}-season`,
        accountId: accountA,
        displayName: "Integration season",
      },
    });
    const teamSeason = await prisma.teamSeason.create({
      data: {
        id: `${prefix}-team-season`,
        accountId: accountA,
        teamId: team.id,
        seasonId: season.id,
      },
    });
    const destination = await prisma.discordChannelDestination.create({
      data: {
        accountId: accountA,
        installationId: installationInternalId,
        channelId: `7${snowflakeSeed}`,
        channelReference: "discord/channels/live",
      },
    });
    const settings = await prisma.discordIntegrationSettings.create({
      data: {
        accountId: accountA,
        installationId: installationInternalId,
      },
    });
    await prisma.discordSettingsScope.create({
      data: {
        accountId: accountA,
        settingsId: settings.id,
        teamSeasonId: teamSeason.id,
      },
    });
    await prisma.discordSettingsDestination.create({
      data: {
        accountId: accountA,
        settingsId: settings.id,
        destinationId: destination.id,
        purpose: "LIVE_UPDATES",
      },
    });
    await prisma.discordIntegrationSettings.update({
      where: { id: settings.id },
      data: { enabled: true },
    });

    await expect(
      repository.disconnect({
        accountId: accountA,
        installationExternalId: installationId,
        actor: operateActor,
        correlationId: `${prefix}-disconnect`,
      }),
    ).resolves.toMatchObject({
      outcome: "disconnected",
      installation: { id: installationId, status: "DISCONNECTED" },
    });
    await expect(
      repository.disconnect({
        accountId: accountA,
        installationExternalId: installationId,
        actor: operateActor,
      }),
    ).resolves.toMatchObject({ outcome: "unchanged" });

    expect(
      await prisma.discordIntegrationSettings.findFirstOrThrow({
        where: { installationId: installationInternalId },
      }),
    ).toMatchObject({ enabled: false, revision: 2 });
    expect(
      await prisma.discordRoleGrant.findFirstOrThrow({
        where: { installationId: installationInternalId },
      }),
    ).toMatchObject({ status: "REVOKED", revision: 2 });
    expect(
      await prisma.discordGuildRole.findFirstOrThrow({
        where: { installationId: installationInternalId },
      }),
    ).toMatchObject({ enabled: false });

    const audits = await prisma.securityAuditRecord.findMany({
      where: {
        accountId: accountA,
        action: { startsWith: "discord.installation." },
      },
    });
    expect(audits.map(({ action }) => action)).toEqual(
      expect.arrayContaining([
        "discord.installation.connected",
        "discord.installation.reauthorized",
        "discord.installation.disconnected",
      ]),
    );
    expect(JSON.stringify(audits)).not.toContain(guildA);
    expect(JSON.stringify(audits)).not.toMatch(
      /discord\/bot\/|credentialReference/iu,
    );

    await expect(
      repository.connect({
        accountId: accountA,
        guildId: guildA,
        guildDisplayName: "Reconnected guild",
        credentialReference: "discord/bot/rotated",
        installerFingerprint: "e".repeat(64),
        actor: configureActor,
      }),
    ).resolves.toMatchObject({
      outcome: "reauthorized",
      installation: { id: installationId, status: "ACTIVE" },
    });
  });

  it("normalizes a partial installation into a safe disconnected state", async () => {
    const partial = await prisma.discordInstallation.create({
      data: {
        accountId: accountA,
        guildId: `6${snowflakeSeed}`,
        credentialReference: "discord/bot/partial",
      },
    });
    await expect(
      repository.disconnect({
        accountId: accountA,
        installationExternalId: partial.externalId,
        actor: operateActor,
      }),
    ).resolves.toMatchObject({
      outcome: "disconnected",
      installation: {
        id: partial.externalId,
        status: "DISCONNECTED",
        installedAt: expect.any(Date),
        disconnectedAt: expect.any(Date),
      },
    });
  });

  it("does not reactivate a revoked guild", async () => {
    await prisma.discordInstallation.update({
      where: { id: installationInternalId },
      data: {
        status: "REVOKED",
        revokedAt: new Date(),
      },
    });
    await expect(
      repository.connect({
        accountId: accountA,
        guildId: guildA,
        guildDisplayName: "Revoked",
        credentialReference: "discord/bot/production",
        installerFingerprint: "d".repeat(64),
        actor: configureActor,
      }),
    ).resolves.toEqual({ outcome: "unavailable" });
  });
});
