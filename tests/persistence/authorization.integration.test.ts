import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AuthorizationService } from "@/server/auth/authorization-service";
import { PrismaAuthorizationStore } from "@/server/auth/store";
import { runAuthorizedTransaction } from "@/server/auth/transaction";
import { AUTH_PROVIDER, type AuthenticatedIdentity } from "@/server/auth/types";
import { seedPersistenceScoringFixture } from "../fixtures/persistence-scoring-fixture";

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const prefix = `issue28-auth-${process.pid}`;

integration("production database authorization", () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl! }),
  });
  const store = new PrismaAuthorizationStore(prisma);
  const service = new AuthorizationService(store);
  const identity: AuthenticatedIdentity = {
    provider: AUTH_PROVIDER,
    providerSubject: `${prefix}-subject`,
  };
  let ids: Awaited<ReturnType<typeof seedPersistenceScoringFixture>>;
  let appUserId: string;
  const membershipId = `${prefix}-membership`;
  const assignmentId = `${prefix}-role`;

  beforeAll(async () => {
    ids = await seedPersistenceScoringFixture(prisma, prefix);
    const concurrentUsers = await Promise.all(
      Array.from({ length: 20 }, () => store.resolveOrProvisionUser(identity)),
    );
    expect(new Set(concurrentUsers.map(({ id }) => id)).size).toBe(1);
    appUserId = concurrentUsers[0]!.id;
    await expect(
      prisma.appUser.count({
        where: {
          provider: identity.provider,
          providerSubject: identity.providerSubject,
        },
      }),
    ).resolves.toBe(1);
    await prisma.accountMembership.create({
      data: {
        id: membershipId,
        accountId: ids.account,
        userId: appUserId,
        status: "ACTIVE",
        activatedAt: new Date(),
      },
    });
    await prisma.membershipRoleAssignment.create({
      data: {
        id: assignmentId,
        accountId: ids.account,
        membershipId,
        role: "SCOREKEEPER",
        scope: "GAME",
        gameId: ids.game,
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("keeps existing, distinct, disabled, and immutable identities correct", async () => {
    const existing = await Promise.all(
      Array.from({ length: 10 }, () => store.resolveOrProvisionUser(identity)),
    );
    expect(new Set(existing.map(({ id }) => id))).toEqual(new Set([appUserId]));

    const distinctIdentities = Array.from({ length: 10 }, (_, index) => ({
      provider: AUTH_PROVIDER,
      providerSubject: `${prefix}-distinct-${index}`,
    })) satisfies AuthenticatedIdentity[];
    const distinctUsers = await Promise.all(
      distinctIdentities.map((subject) =>
        store.resolveOrProvisionUser(subject),
      ),
    );
    expect(new Set(distinctUsers.map(({ id }) => id)).size).toBe(10);
    await expect(
      prisma.appUser.count({
        where: {
          provider: AUTH_PROVIDER,
          providerSubject: { startsWith: `${prefix}-distinct-` },
        },
      }),
    ).resolves.toBe(10);

    const disabledIdentity = {
      provider: AUTH_PROVIDER,
      providerSubject: `${prefix}-disabled`,
    } satisfies AuthenticatedIdentity;
    const disabled = await store.resolveOrProvisionUser(disabledIdentity);
    await prisma.appUser.update({
      where: { id: disabled.id },
      data: { status: "DISABLED" },
    });
    const disabledResults = await Promise.all(
      Array.from({ length: 5 }, () =>
        store.resolveOrProvisionUser(disabledIdentity),
      ),
    );
    expect(disabledResults).toEqual(
      Array.from({ length: 5 }, () => ({
        id: disabled.id,
        active: false,
      })),
    );
    await expect(
      prisma.appUser.update({
        where: { id: disabled.id },
        data: { providerSubject: `${prefix}-reassigned` },
      }),
    ).rejects.toBeDefined();
    await expect(
      prisma.appUser.count({
        where: {
          provider: disabledIdentity.provider,
          providerSubject: disabledIdentity.providerSubject,
        },
      }),
    ).resolves.toBe(1);
  });

  it("rechecks the stable identity inside concurrent serializable authorization", async () => {
    const actorIds = await Promise.all(
      Array.from({ length: 5 }, () =>
        runAuthorizedTransaction(
          prisma,
          identity,
          { kind: "GAME", accountId: ids.account, gameId: ids.game },
          "game.score",
          async (_transaction, actor) => actor.appUserId,
        ),
      ),
    );
    expect(new Set(actorIds)).toEqual(new Set([appUserId]));
  });

  it("authorizes the exact account-scoped database target", async () => {
    await expect(
      service.authorize(
        identity,
        { kind: "GAME", accountId: ids.account, gameId: ids.game },
        "game.score",
      ),
    ).resolves.toMatchObject({
      accountId: ids.account,
      appUserId,
      membershipId,
      capability: "game.score",
    });
    await expect(
      service.authorize(
        identity,
        {
          kind: "GAME",
          accountId: `${prefix}-other-account`,
          gameId: ids.game,
        },
        "game.score",
      ),
    ).rejects.toMatchObject({ code: "NO_ACTIVE_MEMBERSHIP" });
  });

  it("observes membership and assignment changes without provider logout", async () => {
    const target = {
      kind: "GAME" as const,
      accountId: ids.account,
      gameId: ids.game,
    };
    await prisma.account.update({
      where: { id: ids.account },
      data: { status: "ARCHIVED", archivedAt: new Date() },
    });
    await expect(
      service.authorize(identity, target, "game.score"),
    ).rejects.toMatchObject({ code: "NO_ACTIVE_MEMBERSHIP" });
    await prisma.account.update({
      where: { id: ids.account },
      data: { status: "ACTIVE", archivedAt: null },
    });
    await prisma.accountMembership.update({
      where: { id: membershipId },
      data: { status: "DISABLED", disabledAt: new Date() },
    });
    await expect(
      service.authorize(identity, target, "game.score"),
    ).rejects.toMatchObject({ code: "NO_ACTIVE_MEMBERSHIP" });

    await prisma.accountMembership.update({
      where: { id: membershipId },
      data: { status: "INVITED", disabledAt: null },
    });
    await expect(
      service.authorize(identity, target, "game.score"),
    ).rejects.toMatchObject({ code: "NO_ACTIVE_MEMBERSHIP" });
    await prisma.accountMembership.update({
      where: { id: membershipId },
      data: { status: "REMOVED", removedAt: new Date() },
    });
    await expect(
      service.authorize(identity, target, "game.score"),
    ).rejects.toMatchObject({ code: "NO_ACTIVE_MEMBERSHIP" });
    await prisma.accountMembership.update({
      where: { id: membershipId },
      data: { status: "ACTIVE", removedAt: null },
    });
    await prisma.membershipRoleAssignment.update({
      where: { id: assignmentId },
      data: { revokedAt: new Date() },
    });
    await expect(
      service.authorize(identity, target, "game.score"),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_CAPABILITY" });

    const grant = await prisma.capabilityGrant.create({
      data: {
        id: `${prefix}-grant`,
        accountId: ids.account,
        membershipId,
        capability: "game.score",
        scope: "GAME",
        gameId: ids.game,
      },
    });
    await expect(
      service.authorize(identity, target, "game.score"),
    ).resolves.toBeDefined();
    await prisma.capabilityGrant.update({
      where: { id: grant.id },
      data: { revokedAt: new Date() },
    });
    await expect(
      service.authorize(identity, target, "game.score"),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_CAPABILITY" });
  });
});
