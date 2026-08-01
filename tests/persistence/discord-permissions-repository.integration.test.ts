import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  DiscordPermissionsConflictError,
  PrismaDiscordPermissionsRepository,
} from "@/server/data/discord-permissions-repository";
import { trustedActorForTest } from "../fixtures/trusted-actor";

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const prefix = `issue117-${process.pid}-${Date.now()}`;

integration("Discord permissions persistence", () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl! }),
  });
  const repository = new PrismaDiscordPermissionsRepository(prisma);
  const accountA = `${prefix}-account-a`;
  const accountB = `${prefix}-account-b`;
  let installationA = "";
  let installationB = "";
  let roleA = "";
  let roleB = "";
  let roleAInternal = "";

  const actor = trustedActorForTest({
    accountId: accountA,
    actorId: `${prefix}-administrator`,
    actorKind: "SERVICE",
    actorUserId: null,
    membershipId: null,
    capability: "discord.settings.configure",
    scope: { kind: "ACCOUNT" },
    authorizedAt: new Date().toISOString(),
  });

  beforeAll(async () => {
    await prisma.account.createMany({
      data: [
        { id: accountA, slug: `${prefix}-a`, displayName: "Discord A" },
        { id: accountB, slug: `${prefix}-b`, displayName: "Discord B" },
      ],
    });
    const [createdInstallationA, createdInstallationB] = await Promise.all([
      prisma.discordInstallation.create({
        data: {
          accountId: accountA,
          guildId: "523456789012345601",
          guildDisplayName: "Guild A",
          credentialReference: "discord/installations/permissions-a",
          status: "ACTIVE",
          installedAt: new Date(),
        },
      }),
      prisma.discordInstallation.create({
        data: {
          accountId: accountB,
          guildId: "523456789012345602",
          guildDisplayName: "Guild B",
          credentialReference: "discord/installations/permissions-b",
          status: "ACTIVE",
          installedAt: new Date(),
        },
      }),
    ]);
    installationA = createdInstallationA.externalId;
    installationB = createdInstallationB.externalId;
    const [createdRoleA, createdRoleB] = await Promise.all([
      prisma.discordGuildRole.create({
        data: {
          accountId: accountA,
          installationId: createdInstallationA.id,
          roleId: "623456789012345601",
          roleReference: "discord/roles/scorekeeper-a",
          displayName: "Scorekeeper",
          lastVerifiedAt: new Date(),
        },
      }),
      prisma.discordGuildRole.create({
        data: {
          accountId: accountB,
          installationId: createdInstallationB.id,
          roleId: "623456789012345602",
          roleReference: "discord/roles/scorekeeper-b",
          displayName: "Scorekeeper",
          lastVerifiedAt: new Date(),
        },
      }),
    ]);
    roleA = createdRoleA.externalId;
    roleB = createdRoleB.externalId;
    roleAInternal = createdRoleA.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const input = () => ({
    accountId: accountA,
    installationId: installationA,
    roleId: roleA,
    expectedRevision: 0,
    actions: ["READ_ONLY" as const, "CONFIGURE" as const],
    reasonCode: "SERVER_ADMIN_POLICY",
    actor,
  });

  it("writes a tenant/server-scoped grant and secret-free audit history", async () => {
    await expect(repository.writeGrant(input())).resolves.toMatchObject({
      outcome: "updated",
      grant: {
        role: { id: roleA, displayName: "Scorekeeper" },
        actions: ["READ_ONLY", "CONFIGURE"],
        status: "ACTIVE",
        revision: 1,
      },
    });
    const history = await repository.listAuditHistory(accountA, installationA);
    expect(history).toMatchObject([
      {
        actor: { id: `${prefix}-administrator` },
        serverId: installationA,
        category: "permissions",
        before: null,
        after: { revision: 1, status: "ACTIVE" },
        result: "SUCCEEDED",
      },
    ]);
    expect(JSON.stringify(history)).not.toMatch(
      /523456789012345601|623456789012345601|credentialReference/iu,
    );
  });

  it("rejects stale revisions, cross-tenant roles, and immutable identities", async () => {
    await expect(repository.writeGrant(input())).rejects.toBeInstanceOf(
      DiscordPermissionsConflictError,
    );
    await expect(
      repository.writeGrant({ ...input(), roleId: roleB, expectedRevision: 0 }),
    ).resolves.toEqual({ outcome: "unavailable" });
    await expect(
      prisma.discordGuildRole.update({
        where: { id: roleAInternal },
        data: { roleId: "723456789012345601" },
      }),
    ).rejects.toBeTruthy();
  });

  it("fails closed when role evidence is stale and supports audited revoke", async () => {
    await prisma.discordGuildRole.update({
      where: { id: roleAInternal },
      data: { lastVerifiedAt: new Date(Date.now() - 10 * 60_000) },
    });
    await expect(
      repository.writeGrant({ ...input(), expectedRevision: 1 }),
    ).resolves.toEqual({ outcome: "membership_stale" });
    await prisma.discordGuildRole.update({
      where: { id: roleAInternal },
      data: { lastVerifiedAt: new Date() },
    });
    await expect(
      repository.revokeGrant({
        accountId: accountA,
        installationId: installationA,
        roleId: roleA,
        expectedRevision: 1,
        reasonCode: "ROLE_RETIRED",
        actor,
      }),
    ).resolves.toMatchObject({
      outcome: "updated",
      grant: { status: "REVOKED", revision: 2 },
    });
    expect(await repository.listGrants(accountA, installationB)).toBeNull();
  });
});
