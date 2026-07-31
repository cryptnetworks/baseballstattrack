import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PRIVACY_CONFIRMATION } from "@/domain/privacy-lifecycle";
import { PortableDataService } from "@/server/app/portable-data-service";
import { PrivacyLifecycleService } from "@/server/app/privacy-lifecycle-service";
import { PrismaGameBoxScoreRepository } from "@/server/data/game-box-score-repository";
import { PrismaGameEventRepository } from "@/server/data/game-event-repository";
import { PrismaPortableDataRepository } from "@/server/data/portable-data-repository";
import { PrismaPrivacyLifecycleRepository } from "@/server/data/privacy-lifecycle-repository";
import { seedPersistenceScoringFixture } from "../fixtures/persistence-scoring-fixture";
import { trustedActorForTest } from "../fixtures/trusted-actor";

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const prefix = `issue88-${process.pid}-${Date.now()}`;

integration("privacy lifecycle persistence boundary", () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl! }),
  });
  const repository = new PrismaPrivacyLifecycleRepository(prisma);
  const events = new PrismaGameEventRepository(prisma);
  const portable = new PortableDataService(
    new PrismaPortableDataRepository(prisma),
    events,
    new PrismaGameBoxScoreRepository(prisma),
  );
  let current = new Date("2026-08-01T00:00:00.000Z");
  const service = new PrivacyLifecycleService(
    repository,
    portable,
    () => current,
  );
  let ids: Awaited<ReturnType<typeof seedPersistenceScoringFixture>>;
  const userId = `${prefix}-user`;
  const membershipId = `${prefix}-membership`;
  const detachedUserId = `${prefix}-detached-user`;
  const detachedMembershipId = `${prefix}-detached-membership`;

  beforeAll(async () => {
    ids = await seedPersistenceScoringFixture(prisma, prefix);
    await prisma.appUser.createMany({
      data: [
        {
          id: userId,
          provider: "supabase",
          providerSubject: `${prefix}-subject`,
        },
        {
          id: detachedUserId,
          provider: "supabase",
          providerSubject: `${prefix}-detached-subject`,
        },
      ],
    });
    await prisma.accountMembership.createMany({
      data: [
        {
          id: membershipId,
          accountId: ids.account,
          userId,
          status: "ACTIVE",
          activatedAt: current,
        },
        {
          id: detachedMembershipId,
          accountId: ids.account,
          userId: detachedUserId,
          status: "ACTIVE",
          activatedAt: current,
        },
      ],
    });
    await events.accept({
      accountId: ids.account,
      gameId: ids.game,
      setupSnapshotId: ids.setup,
      expectedRevision: 0,
      eventId: `${prefix}-start-event`,
      playTransactionId: `${prefix}-start-transaction`,
      clientSubmissionId: `${prefix}-start-submission`,
      recordedAt: current.toISOString(),
      actor: {
        accountId: ids.account,
        actorId: `${prefix}-scoring-service`,
        actorKind: "SERVICE",
        actorUserId: null,
        capability: "game.start",
        scope: { kind: "GAME", gameId: ids.game },
        authorizedAt: current.toISOString(),
      },
      body: { eventType: "GameStarted", payload: {} },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  function actor(
    capability: Parameters<typeof trustedActorForTest>[0]["capability"],
  ) {
    return trustedActorForTest({
      accountId: ids.account,
      actorId: userId,
      actorKind: "USER",
      actorUserId: userId,
      membershipId,
      capability,
      scope: { kind: "ACCOUNT" },
      authorizedAt: current.toISOString(),
    });
  }

  function worker() {
    return trustedActorForTest({
      accountId: ids.account,
      actorId: `${prefix}-privacy-worker`,
      actorKind: "SERVICE",
      actorUserId: null,
      membershipId: null,
      capability: "privacy.manage",
      scope: { kind: "ACCOUNT" },
      authorizedAt: current.toISOString(),
    });
  }

  it("prepares a short-lived one-time export and reauthorizes token access", async () => {
    const first = await service.prepareExport(
      { accountId: ids.account, clientRequestId: `${prefix}-export-request` },
      actor("report.export"),
    );
    const retry = await service.prepareExport(
      { accountId: ids.account, clientRequestId: `${prefix}-export-request` },
      actor("report.export"),
    );
    expect(retry.artifactId).toBe(first.artifactId);
    expect(retry.token).not.toBe(first.token);
    expect(Date.parse(retry.expiresAt) - current.getTime()).toBe(
      5 * 60 * 1_000,
    );

    const otherAccountActor = trustedActorForTest({
      accountId: `${prefix}-other-account`,
      actorId: userId,
      actorKind: "USER",
      actorUserId: userId,
      membershipId: `${prefix}-other-membership`,
      capability: "report.export",
      scope: { kind: "ACCOUNT" },
      authorizedAt: current.toISOString(),
    });
    await expect(
      service.downloadExport(
        {
          accountId: ids.account,
          artifactId: retry.artifactId,
          token: retry.token,
        },
        otherAccountActor,
      ),
    ).rejects.toBeDefined();

    await expect(
      service.downloadExport(
        {
          accountId: ids.account,
          artifactId: first.artifactId,
          token: first.token,
        },
        actor("report.export"),
      ),
    ).rejects.toMatchObject({ code: "EXPORT_UNAVAILABLE" });
    const downloaded = await service.downloadExport(
      {
        accountId: ids.account,
        artifactId: retry.artifactId,
        token: retry.token,
      },
      actor("report.export"),
    );
    expect(downloaded.checksum).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(new TextDecoder().decode(downloaded.bytes)).not.toContain(
      ids.account,
    );
    await expect(
      service.downloadExport(
        {
          accountId: ids.account,
          artifactId: retry.artifactId,
          token: retry.token,
        },
        actor("report.export"),
      ),
    ).rejects.toMatchObject({ code: "EXPORT_UNAVAILABLE" });

    const row = await prisma.dataExportArtifact.findUniqueOrThrow({
      where: { id: retry.artifactId },
    });
    expect(row).toMatchObject({
      status: "DOWNLOADED",
      tokenVerifier: null,
    });
    const audits = await prisma.securityAuditRecord.findMany({
      where: {
        accountId: ids.account,
        targetId: retry.artifactId,
      },
    });
    expect(audits.map(({ outcome }) => outcome)).toEqual(
      expect.arrayContaining(["SUCCEEDED", "DENIED"]),
    );
    expect(JSON.stringify(audits)).not.toMatch(
      new RegExp(`${retry.token}|displayName|payload`, "u"),
    );

    const expiring = await service.prepareExport(
      { accountId: ids.account, clientRequestId: `${prefix}-expiring-export` },
      actor("report.export"),
    );
    current = new Date("2026-08-01T00:06:00.000Z");
    await expect(
      service.downloadExport(
        {
          accountId: ids.account,
          artifactId: expiring.artifactId,
          token: expiring.token,
        },
        actor("report.export"),
      ),
    ).rejects.toMatchObject({ code: "EXPORT_UNAVAILABLE" });
    expect(
      await prisma.dataExportArtifact.findUniqueOrThrow({
        where: { id: expiring.artifactId },
      }),
    ).toMatchObject({ status: "EXPIRED", tokenVerifier: null });

    const cancellable = await service.prepareExport(
      { accountId: ids.account, clientRequestId: `${prefix}-cancel-export` },
      actor("report.export"),
    );
    await expect(
      service.cancelExport(
        {
          accountId: ids.account,
          artifactId: cancellable.artifactId,
          token: cancellable.token,
        },
        actor("report.export"),
      ),
    ).resolves.toEqual({ cancelled: true });
    expect(
      await prisma.dataExportArtifact.findUniqueOrThrow({
        where: { id: cancellable.artifactId },
      }),
    ).toMatchObject({ status: "CANCELLED", tokenVerifier: null });
  });

  it("requires confirmation, supports exact retry and cancellation, and rolls back when audit evidence cannot be written", async () => {
    const input = {
      accountId: ids.account,
      target: "ACCOUNT" as const,
      targetId: ids.account,
      clientRequestId: `${prefix}-cancel-request`,
      confirmation: PRIVACY_CONFIRMATION.ACCOUNT,
      reasonCode: "ACCOUNT_CLOSURE",
    };
    await expect(
      service.createRequest(
        { ...input, confirmation: "delete it" },
        actor("account.delete_request"),
      ),
    ).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
    const created = await service.createRequest(
      input,
      actor("account.delete_request"),
    );
    const retry = await service.createRequest(
      input,
      actor("account.delete_request"),
    );
    expect(retry.request.id).toBe(created.request.id);
    expect(retry.idempotentRetry).toBe(true);
    await expect(
      service.createRequest(
        { ...input, reasonCode: "DIFFERENT_REASON" },
        actor("account.delete_request"),
      ),
    ).rejects.toMatchObject({ code: "LIFECYCLE_CONFLICT" });
    const cancelled = await service.cancelRequest(
      {
        accountId: ids.account,
        requestId: created.request.id,
        target: "ACCOUNT",
      },
      actor("account.delete_request"),
    );
    expect(cancelled.status).toBe("CANCELLED");
    expect(
      (await prisma.account.findUniqueOrThrow({ where: { id: ids.account } }))
        .status,
    ).toBe("ACTIVE");

    const unauditable = trustedActorForTest({
      accountId: ids.account,
      actorId: `${prefix}-missing-user`,
      actorKind: "USER",
      actorUserId: `${prefix}-missing-user`,
      capability: "account.delete_request",
      scope: { kind: "ACCOUNT" },
      authorizedAt: current.toISOString(),
    });
    await expect(
      service.createRequest(
        { ...input, clientRequestId: `${prefix}-audit-failure` },
        unauditable,
      ),
    ).rejects.toBeDefined();
    expect(
      await prisma.privacyLifecycleRequest.count({
        where: { clientRequestId: `${prefix}-audit-failure` },
      }),
    ).toBe(0);
  });

  it("detaches only the requesting user while retaining opaque attribution", async () => {
    current = new Date("2026-08-01T01:00:00.000Z");
    const requestingUser = trustedActorForTest({
      accountId: ids.account,
      actorId: detachedUserId,
      actorKind: "USER",
      actorUserId: detachedUserId,
      membershipId: detachedMembershipId,
      capability: "privacy.request",
      scope: { kind: "ACCOUNT" },
      authorizedAt: current.toISOString(),
    });
    await expect(
      service.createRequest(
        {
          accountId: ids.account,
          target: "USER",
          targetId: userId,
          clientRequestId: `${prefix}-wrong-user-request`,
          confirmation: PRIVACY_CONFIRMATION.USER,
          reasonCode: "USER_REQUEST",
        },
        requestingUser,
      ),
    ).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
    const created = await service.createRequest(
      {
        accountId: ids.account,
        target: "USER",
        targetId: detachedUserId,
        clientRequestId: `${prefix}-user-request`,
        confirmation: PRIVACY_CONFIRMATION.USER,
        reasonCode: "USER_REQUEST",
      },
      requestingUser,
    );
    current = new Date("2026-08-09T01:00:00.000Z");
    await service.executeRequest(
      { accountId: ids.account, requestId: created.request.id },
      worker(),
    );
    expect(
      await prisma.appUser.findUniqueOrThrow({
        where: { id: detachedUserId },
      }),
    ).toMatchObject({
      status: "DELETED",
      detachedAt: current,
      providerSubject: `${prefix}-detached-subject`,
    });
    expect(
      await prisma.accountMembership.findUniqueOrThrow({
        where: { id: detachedMembershipId },
      }),
    ).toMatchObject({ status: "DISABLED", disabledAt: current });
    expect(
      await prisma.appUser.findUniqueOrThrow({ where: { id: userId } }),
    ).toMatchObject({ status: "ACTIVE", detachedAt: null });
  });

  it("honors holds and performs Account deletion without mutating accepted history", async () => {
    current = new Date("2026-08-02T00:00:00.000Z");
    const prepared = await service.prepareExport(
      { accountId: ids.account, clientRequestId: `${prefix}-revoked-export` },
      actor("report.export"),
    );
    await prisma.projectionCheckpoint.create({
      data: {
        id: `${prefix}-projection`,
        accountId: ids.account,
        scope: "GAME",
        gameId: ids.game,
        sourceRevision: 1,
        privacyOverlayRevision: 0,
        derivationVersion: 1,
        status: "CURRENT",
      },
    });
    const created = await service.createRequest(
      {
        accountId: ids.account,
        target: "ACCOUNT",
        targetId: ids.account,
        clientRequestId: `${prefix}-deletion-request`,
        confirmation: PRIVACY_CONFIRMATION.ACCOUNT,
        reasonCode: "ACCOUNT_CLOSURE",
      },
      actor("account.delete_request"),
    );
    await expect(
      service.executeRequest(
        { accountId: ids.account, requestId: created.request.id },
        worker(),
      ),
    ).rejects.toMatchObject({ code: "NOT_READY" });
    const hold = await service.placeHold(
      {
        accountId: ids.account,
        requestId: created.request.id,
        reasonCode: "LEGAL_REVIEW",
        expiresAt: null,
      },
      worker(),
    );
    current = new Date("2026-08-10T00:00:00.000Z");
    await expect(
      service.executeRequest(
        { accountId: ids.account, requestId: created.request.id },
        worker(),
      ),
    ).rejects.toMatchObject({ code: "HOLD_ACTIVE" });

    await expect(
      service.releaseHold(
        { accountId: ids.account, holdId: hold.id },
        worker(),
      ),
    ).resolves.toMatchObject({ status: "RELEASED", releasedAt: current });
    current = new Date("2026-08-12T00:00:00.000Z");
    await expect(
      service.executeRequest(
        { accountId: ids.account, requestId: created.request.id },
        worker(),
      ),
    ).resolves.toEqual({ completed: true });

    expect(
      await prisma.sourceEvent.count({
        where: { accountId: ids.account, gameId: ids.game },
      }),
    ).toBe(1);
    expect(
      await prisma.game.findUnique({ where: { id: ids.game } }),
    ).not.toBeNull();
    expect(
      await prisma.projectionCheckpoint.count({
        where: { accountId: ids.account },
      }),
    ).toBe(0);
    expect(
      await prisma.player.findMany({
        where: { accountId: ids.account },
        select: { displayName: true, archivedAt: true },
      }),
    ).toEqual(
      expect.arrayContaining([
        { displayName: "Deleted player", archivedAt: current },
      ]),
    );
    expect(
      await prisma.privacyOverlay.count({
        where: { accountId: ids.account },
      }),
    ).toBe(1);
    expect(
      await prisma.account.findUniqueOrThrow({ where: { id: ids.account } }),
    ).toMatchObject({
      status: "ARCHIVED",
      displayName: "Deleted Account",
      archivedAt: current,
    });
    expect(
      await prisma.accountMembership.findUniqueOrThrow({
        where: { id: membershipId },
      }),
    ).toMatchObject({ status: "DISABLED", disabledAt: current });
    expect(
      await prisma.dataExportArtifact.findUniqueOrThrow({
        where: { id: prepared.artifactId },
      }),
    ).toMatchObject({
      status: "REVOKED",
      tokenVerifier: null,
    });
    const completionAudit = await prisma.securityAuditRecord.findFirstOrThrow({
      where: {
        accountId: ids.account,
        action: "privacy.lifecycle.execute",
        outcome: "SUCCEEDED",
      },
      orderBy: { createdAt: "desc" },
    });
    expect(completionAudit.metadata).toMatchObject({
      immutableHistoryRetained: true,
      projectionsDeleted: true,
    });
  });
});
