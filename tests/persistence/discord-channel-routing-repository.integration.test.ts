import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaDiscordChannelRoutingRepository } from "@/server/data/discord-channel-routing-repository";
import { trustedActorForTest } from "../fixtures/trusted-actor";

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const prefix = `issue112-${process.pid}-${Date.now()}`;

integration("Discord channel routing persistence", () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl! }),
  });
  const repository = new PrismaDiscordChannelRoutingRepository(prisma);
  const accountA = `${prefix}-account-a`;
  const accountB = `${prefix}-account-b`;
  let installationA = "";
  let installationB = "";
  const actor = trustedActorForTest({
    accountId: accountA,
    actorId: `${prefix}-administrator`,
    actorKind: "SERVICE",
    actorUserId: null,
    membershipId: null,
    capability: "discord.settings.configure",
    scope: { kind: "ACCOUNT" },
    authorizedAt: "2026-08-01T04:00:00.000Z",
  });

  beforeAll(async () => {
    await prisma.account.createMany({
      data: [
        { id: accountA, slug: `${prefix}-a`, displayName: "Routing A" },
        { id: accountB, slug: `${prefix}-b`, displayName: "Routing B" },
      ],
    });
    const [a, b] = await Promise.all([
      prisma.discordInstallation.create({
        data: {
          accountId: accountA,
          guildId: `${Date.now()}601`,
          guildDisplayName: "Guild A",
          credentialReference: "discord/installations/routing-a",
          status: "ACTIVE",
          installedAt: new Date(),
        },
      }),
      prisma.discordInstallation.create({
        data: {
          accountId: accountB,
          guildId: `${Date.now()}602`,
          guildDisplayName: "Guild B",
          credentialReference: "discord/installations/routing-b",
          status: "ACTIVE",
          installedAt: new Date(),
        },
      }),
    ]);
    installationA = a.externalId;
    installationB = b.externalId;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("stores provider identities privately and returns only accessible channels", async () => {
    const workspace = await repository.syncChannels({
      accountId: accountA,
      installationExternalId: installationA,
      actor,
      channels: [
        {
          channelId: `${Date.now()}701`,
          displayName: "scores",
          canView: true,
          canSend: true,
        },
        {
          channelId: `${Date.now()}702`,
          displayName: "private",
          canView: false,
          canSend: false,
        },
        {
          channelId: `${Date.now()}703`,
          displayName: "read-only",
          canView: true,
          canSend: false,
        },
      ],
    });
    expect(workspace).toMatchObject({
      channels: [{ displayName: "scores", enabled: true }],
      missingPermissions: { viewChannel: 1, sendMessages: 1 },
    });
    expect(workspace?.lastVerifiedAt).toBeInstanceOf(Date);
    expect(JSON.stringify(workspace)).not.toMatch(
      /channelId|channelReference|discord\/channels/iu,
    );
    const audit = await prisma.securityAuditRecord.findFirstOrThrow({
      where: { accountId: accountA, action: "discord.channels.synchronized" },
    });
    expect(JSON.stringify(audit.metadata)).not.toMatch(
      /scores|private|read-only|discord\/channels/iu,
    );
  });

  it("disables a channel without deleting its installation and can re-enable it", async () => {
    const current = await repository.getWorkspace(accountA, installationA);
    const channel = current!.channels[0]!;
    await expect(
      repository.setChannelEnabled({
        accountId: accountA,
        installationExternalId: installationA,
        destinationExternalId: channel.id,
        enabled: false,
        actor,
      }),
    ).resolves.toEqual({ outcome: "updated" });
    expect(
      (await repository.getWorkspace(accountA, installationA))!.channels[0],
    ).toMatchObject({ enabled: false });
    expect(
      await prisma.discordInstallation.count({
        where: { accountId: accountA },
      }),
    ).toBe(1);
    await expect(
      repository.setChannelEnabled({
        accountId: accountA,
        installationExternalId: installationA,
        destinationExternalId: channel.id,
        enabled: true,
        actor,
      }),
    ).resolves.toEqual({ outcome: "updated" });
  });

  it("fails closed across Accounts and resolves a routable test destination privately", async () => {
    const channel = (await repository.getWorkspace(accountA, installationA))!
      .channels[0]!;
    await expect(
      repository.resolveTestDestination(accountB, installationB, channel.id),
    ).resolves.toBeNull();
    const resolved = await repository.resolveTestDestination(
      accountA,
      installationA,
      channel.id,
    );
    expect(resolved?.channelId).toBeTruthy();
    expect(
      JSON.stringify(await repository.getWorkspace(accountA, installationA)),
    ).not.toContain(resolved?.channelId);
  });
});
