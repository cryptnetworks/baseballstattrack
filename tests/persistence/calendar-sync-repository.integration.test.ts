import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CalendarConnectionExistsError,
  PrismaCalendarSyncRepository,
} from "@/server/data/calendar-sync-repository";
import { trustedActorForTest } from "../fixtures/trusted-actor";

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const prefix = `issue98-${process.pid}-${Date.now()}`;

integration("calendar synchronization persistence", () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl! }),
  });
  const repository = new PrismaCalendarSyncRepository(prisma);
  const accountA = `${prefix}-account-a`;
  const accountB = `${prefix}-account-b`;
  let connectionExternalId = "";

  const actor = (accountId: string) =>
    trustedActorForTest({
      accountId,
      actorId: `${accountId}-calendar-service`,
      actorKind: "SERVICE",
      actorUserId: null,
      membershipId: null,
      capability: "account.manage",
      scope: { kind: "ACCOUNT" },
      authorizedAt: "2026-07-31T20:00:00.000Z",
    });

  beforeAll(async () => {
    await prisma.account.createMany({
      data: [
        { id: accountA, slug: `${prefix}-a`, displayName: "Calendar A" },
        { id: accountB, slug: `${prefix}-b`, displayName: "Calendar B" },
      ],
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates an Account-scoped connection without persisting a token", async () => {
    const connection = await repository.createConnection({
      accountId: accountA,
      provider: "GOOGLE",
      providerCalendarId: "primary@example.test",
      credentialReference: "calendar/prod-primary",
      timeZone: "America/New_York",
      detailLevel: "PRIVATE",
      actor: actor(accountA),
    });
    connectionExternalId = connection.externalId;
    expect(connection).toMatchObject({
      accountId: accountA,
      credentialReference: "calendar/prod-primary",
      status: "ACTIVE",
    });
    const audit = await prisma.securityAuditRecord.findFirstOrThrow({
      where: { accountId: accountA, action: "calendar.connection.create" },
    });
    expect(JSON.stringify(audit)).not.toContain("oauth-token");

    await expect(
      repository.createConnection({
        accountId: accountA,
        provider: "GOOGLE",
        providerCalendarId: "primary@example.test",
        credentialReference: "calendar/other",
        timeZone: "UTC",
        detailLevel: "FULL",
        actor: actor(accountA),
      }),
    ).rejects.toBeInstanceOf(CalendarConnectionExistsError);
  });

  it("leases work once and preserves Account isolation", async () => {
    const first = await repository.claimConnection({
      workerId: "worker-first",
      now: new Date("2026-07-31T21:00:00.000Z"),
      connectionExternalId,
    });
    expect(first).toMatchObject({ accountId: accountA });
    await expect(
      repository.claimConnection({
        workerId: "worker-second",
        now: new Date("2026-07-31T21:00:01.000Z"),
        connectionExternalId,
      }),
    ).resolves.toBeNull();
    await repository.finishConnection({
      connectionId: first!.id,
      workerId: "worker-first",
      now: new Date("2026-07-31T21:00:02.000Z"),
      failureCode: null,
      disconnected: false,
    });
    expect(await repository.listConnections(accountB)).toEqual([]);
  });

  it("disconnects and explicitly reconnects the same calendar", async () => {
    await repository.beginDisconnect({
      accountId: accountA,
      connectionExternalId,
      actor: actor(accountA),
    });
    const claimed = await repository.claimConnection({
      workerId: "worker-disconnect",
      now: new Date("2026-07-31T22:00:00.000Z"),
      connectionExternalId,
    });
    await repository.finishConnection({
      connectionId: claimed!.id,
      workerId: "worker-disconnect",
      now: new Date("2026-07-31T22:00:01.000Z"),
      failureCode: null,
      disconnected: true,
    });

    const reconnected = await repository.createConnection({
      accountId: accountA,
      provider: "GOOGLE",
      providerCalendarId: "primary@example.test",
      credentialReference: "calendar/prod-rotated",
      timeZone: "UTC",
      detailLevel: "OPPONENT",
      actor: actor(accountA),
    });
    expect(reconnected).toMatchObject({
      externalId: connectionExternalId,
      status: "ACTIVE",
      timeZone: "UTC",
      detailLevel: "OPPONENT",
      disconnectedAt: null,
    });
  });
});
