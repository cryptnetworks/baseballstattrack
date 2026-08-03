import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DEFAULT_APPLICATION_CONFIGURATION } from "@/domain/application-configuration";
import { PrismaApplicationConfigurationRepository } from "@/server/data/application-configuration-repository";
import { trustedActorForTest } from "../fixtures/trusted-actor";

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const prefix = `configuration-${process.pid}-${Date.now()}`;

integration("application configuration persistence boundary", () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl! }),
  });
  const repository = new PrismaApplicationConfigurationRepository(prisma);
  const accountA = `${prefix}-account-a`;
  const accountB = `${prefix}-account-b`;
  const userA = `${prefix}-user-a`;
  const membershipA = `${prefix}-membership-a`;
  const actor = trustedActorForTest({
    accountId: accountA,
    actorId: userA,
    actorKind: "USER",
    actorUserId: userA,
    membershipId: membershipA,
    capability: "configuration.manage",
    scope: { kind: "ACCOUNT" },
    authorizedAt: "2026-08-03T14:30:00.000Z",
  });

  beforeAll(async () => {
    await prisma.account.createMany({
      data: [
        { id: accountA, slug: `${prefix}-a`, displayName: "Configuration A" },
        { id: accountB, slug: `${prefix}-b`, displayName: "Configuration B" },
      ],
    });
    await prisma.appUser.create({
      data: {
        id: userA,
        provider: "supabase",
        providerSubject: `${prefix}-subject-a`,
      },
    });
    await prisma.accountMembership.create({
      data: {
        id: membershipA,
        accountId: accountA,
        userId: userA,
        status: "ACTIVE",
        activatedAt: new Date("2026-08-03T14:00:00.000Z"),
      },
    });
  });

  afterAll(async () => prisma.$disconnect());

  it("isolates Accounts, audits updates, and preserves rollback lineage", async () => {
    const seed = await repository.seed({
      accountId: accountA,
      values: DEFAULT_APPLICATION_CONFIGURATION,
      reason: "Initial reviewed environment migration",
      actor,
      seededAt: new Date("2026-08-03T14:30:00.000Z"),
    });
    expect(seed.created).toBe(true);
    await expect(
      repository.seed({
        accountId: accountA,
        values: DEFAULT_APPLICATION_CONFIGURATION,
        reason: "Repeated reviewed environment migration",
        actor,
        seededAt: new Date("2026-08-03T14:30:30.000Z"),
      }),
    ).resolves.toMatchObject({ created: false });
    await expect(repository.current(accountB)).resolves.toBeNull();

    const changed = {
      ...DEFAULT_APPLICATION_CONFIGURATION,
      features: {
        ...DEFAULT_APPLICATION_CONFIGURATION.features,
        calendarFeeds: true,
      },
    };
    const updated = await repository.save({
      accountId: accountA,
      expectedRevision: 1,
      values: changed,
      reason: "Enable reviewed calendar subscriptions",
      actor,
      savedAt: new Date("2026-08-03T14:31:00.000Z"),
    });
    expect(updated).toMatchObject({ currentRevision: 2 });

    const rolledBack = await repository.rollback({
      accountId: accountA,
      expectedRevision: 2,
      targetRevision: 1,
      reason: "Restore the prior reviewed configuration",
      actor,
      savedAt: new Date("2026-08-03T14:32:00.000Z"),
    });
    expect(rolledBack).toMatchObject({ currentRevision: 3 });
    const history = await repository.history(accountA);
    expect(history.map(({ revision }) => revision)).toEqual([3, 2, 1]);
    expect(history[0]).toMatchObject({
      source: "ROLLBACK",
      rolledBackFromRevision: 1,
    });

    const audit = await prisma.securityAuditRecord.findMany({
      where: {
        accountId: accountA,
        targetType: "ApplicationConfiguration",
      },
      orderBy: { createdAt: "asc" },
    });
    expect(audit.map(({ action }) => action)).toEqual([
      "application_configuration.seed",
      "application_configuration.update",
      "application_configuration.rollback",
    ]);
    expect(
      audit.every(
        ({ metadata }) => !JSON.stringify(metadata).includes("values"),
      ),
    ).toBe(true);
  });

  it("does not permit revision history mutation", async () => {
    const revision =
      await prisma.applicationConfigurationRevision.findFirstOrThrow({
        where: { accountId: accountA, revision: 1 },
      });
    await expect(
      prisma.applicationConfigurationRevision.update({
        where: { id: revision.id },
        data: { reason: "Attempted historical rewrite" },
      }),
    ).rejects.toThrow();
  });

  it("rejects secret-shaped revisions and a head without matching history", async () => {
    const configuration =
      await prisma.applicationConfiguration.findUniqueOrThrow({
        where: { accountId: accountA },
      });
    const previous =
      await prisma.applicationConfigurationRevision.findFirstOrThrow({
        where: { accountId: accountA, revision: 3 },
      });
    await expect(
      prisma.applicationConfigurationRevision.create({
        data: {
          id: `${prefix}-secret-revision`,
          accountId: accountA,
          configurationId: configuration.id,
          revision: 4,
          schemaVersion: 1,
          values: JSON.parse(
            JSON.stringify({
              ...DEFAULT_APPLICATION_CONFIGURATION,
              notifications: {
                ...DEFAULT_APPLICATION_CONFIGURATION.notifications,
                smtpPassword: "must-not-be-stored",
              },
            }),
          ),
          digest: configuration.digest,
          source: "ADMIN_UPDATE",
          reason: "Attempted secret persistence",
          actorId: userA,
          actorUserId: userA,
          previousRevisionId: previous.id,
        },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.$executeRaw`
        UPDATE "ApplicationConfiguration"
        SET "currentRevision" = "currentRevision" + 1,
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE "accountId" = ${accountA}
      `,
    ).rejects.toThrow();
    await expect(repository.current(accountA)).resolves.toMatchObject({
      currentRevision: 3,
    });
  });
});
