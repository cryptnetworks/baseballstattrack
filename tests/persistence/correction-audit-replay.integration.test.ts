import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { deriveGameStatistics } from "@/domain/statistics";
import { CorrectionAuditReplayService } from "@/server/app/correction-audit-replay-service";
import {
  PrismaGameEventRepository,
  type AcceptEventCommand,
  type ValidatedActorContext,
} from "@/server/data/game-event-repository";
import { PrismaStatisticProjectionRepository } from "@/server/data/statistic-projection-repository";
import { seedPersistenceScoringFixture } from "../fixtures/persistence-scoring-fixture";
import { trustedActorForTest } from "../fixtures/trusted-actor";

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const prefix = `issue15-${process.pid}`;

integration("correction audit and replay workflow", () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl! }),
  });
  const events = new PrismaGameEventRepository(prisma);
  const service = new CorrectionAuditReplayService(events);
  const projections = new PrismaStatisticProjectionRepository(prisma);
  let ids: Awaited<ReturnType<typeof seedPersistenceScoringFixture>>;

  const actor = (
    capability: ValidatedActorContext["capability"],
  ): ValidatedActorContext => ({
    accountId: ids.account,
    actorId: `${prefix}-${capability}`,
    actorKind: "SERVICE",
    actorUserId: null,
    capability,
    scope: { kind: "GAME", gameId: ids.game },
    authorizedAt: "2026-07-29T17:59:00.000Z",
  });

  const accept = (
    revision: number,
    suffix: string,
    body: AcceptEventCommand["body"],
    capability: ValidatedActorContext["capability"] = "game.score",
  ) =>
    events.accept({
      accountId: ids.account,
      gameId: ids.game,
      setupSnapshotId: ids.setup,
      expectedRevision: revision,
      eventId: `${prefix}-event-${suffix}`,
      playTransactionId: `${prefix}-transaction-${suffix}`,
      clientSubmissionId: `${prefix}-submission-${suffix}`,
      recordedAt: `2026-07-29T18:0${revision}:00.000Z`,
      actor: actor(capability),
      body,
    });

  beforeAll(async () => {
    ids = await seedPersistenceScoringFixture(prisma, prefix);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("runs setup through score, verify, reopen, correction, replay, audit, and reverify", async () => {
    await accept(0, "start", { eventType: "GameStarted", payload: {} });
    const original = await accept(1, "single", {
      eventType: "PlateAppearanceRecorded",
      payload: {
        batterId: ids.away.batter,
        pitcherId: ids.home.pitcher,
        outcome: "SINGLE",
        battedBall: "LINE_DRIVE",
        movements: [
          {
            runnerId: ids.away.batter,
            from: "BATTER",
            to: "FIRST",
            cause: "HIT",
            forced: false,
            responsiblePitcherId: ids.home.pitcher,
          },
        ],
        fieldingCredits: [],
      },
    });
    await accept(2, "complete", {
      eventType: "GameCompleted",
      payload: { reasonCode: "TIME_LIMIT", ending: "TIME_LIMIT" },
    });
    await accept(
      3,
      "verify",
      { eventType: "GameVerified", payload: {} },
      "game.verify",
    );
    await accept(
      4,
      "reopen",
      {
        eventType: "GameReopened",
        payload: { reasonCode: "SCORER_REVIEW" },
      },
      "game.reopen",
    );

    const historyBefore = await events.loadAcceptedHistory(
      ids.account,
      ids.game,
      ids.setup,
    );
    expect(
      deriveGameStatistics(historyBefore).batting.find(
        ({ playerId }) => playerId === ids.away.batter,
      )?.counters,
    ).toMatchObject({ hits: 1, walks: 0 });

    const correctionCommand = (suffix: string) => ({
      action: "APPLY_CORRECTION" as const,
      accountId: ids.account,
      gameId: ids.game,
      setupSnapshotId: ids.setup,
      expectedSourceRevision: 5,
      eventId: `${prefix}-correction-${suffix}`,
      playTransactionId: `${prefix}-correction-transaction-${suffix}`,
      idempotencyKey: `${prefix}-correction-submission-${suffix}`,
      correlationId: `${prefix}-correlation-${suffix}`,
      recordedAt: "2026-07-29T18:06:00.000Z",
      correction: {
        policy: "REPLACE_JUDGMENT" as const,
        targetEventIds: [original.event.id],
        replacements: [
          {
            id: `${prefix}-replacement-${suffix}`,
            order: 0,
            targetEventId: original.event.id,
            body: {
              eventType: "PlateAppearanceRecorded" as const,
              payload: {
                batterId: ids.away.batter,
                pitcherId: ids.home.pitcher,
                outcome: "WALK" as const,
                battedBall: null,
                movements: [
                  {
                    runnerId: ids.away.batter,
                    from: "BATTER" as const,
                    to: "FIRST" as const,
                    cause: "CORRECTION" as const,
                    forced: false,
                    responsiblePitcherId: ids.home.pitcher,
                  },
                ],
                fieldingCredits: [],
              },
            },
          },
        ],
        reasonCode: "SCORER_REVIEW",
      },
    });
    const correctionActor = trustedActorForTest({
      ...actor("game.correct"),
      actorKind: "SERVICE",
      membershipId: null,
    });
    const raced = await Promise.allSettled([
      service.applyCorrection(correctionCommand("a"), correctionActor),
      service.applyCorrection(correctionCommand("b"), correctionActor),
    ]);
    const accepted = raced.find(
      (
        result,
      ): result is PromiseFulfilledResult<
        Awaited<ReturnType<typeof service.applyCorrection>>
      > => result.status === "fulfilled",
    );
    expect(accepted).toBeDefined();
    expect(raced.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    expect(raced.filter(({ status }) => status === "rejected")).toHaveLength(1);

    const result = accepted!.value;
    expect(result.replay.lifecycleStatus).toBe("CORRECTED");
    expect(result.statistics.batting).toContainEqual(
      expect.objectContaining({
        playerId: ids.away.batter,
        plateAppearances: 1,
        hits: 0,
        walks: 1,
      }),
    );
    expect(result.version).toMatchObject({
      sourceRevision: 6,
      correctionRevision: 6,
      verificationStatus: "UNVERIFIED",
      freshness: "CURRENT",
    });
    expect(result.audit).toMatchObject({
      action: "game.correction.apply",
      reasonCode: "SCORER_REVIEW",
      verificationImpact: "INVALIDATED_REQUIRES_REVERIFICATION",
      sourceRevision: { before: 5, after: 6 },
    });
    expect(result.auditHistory).toEqual([result.audit]);
    expect(
      await prisma.securityAuditRecord.count({
        where: {
          accountId: ids.account,
          action: "game.correction.apply",
          targetId: result.correction.id,
        },
      }),
    ).toBe(1);
    expect(
      JSON.stringify(
        (
          await prisma.securityAuditRecord.findFirstOrThrow({
            where: { targetId: result.correction.id },
          })
        ).metadata,
      ),
    ).not.toMatch(/payload|displayName|batterId|pitcherId/);
    expect(
      (
        await prisma.sourceEvent.findUniqueOrThrow({
          where: { id: original.event.id },
        })
      ).payload,
    ).toEqual(original.event.payload);
    expect(
      await projections.findCurrentGameCheckpoint(ids.account, ids.game, {
        sourceRevision: 6,
        privacyOverlayRevision: 0,
        derivationVersion: result.version.statisticDerivationVersion,
      }),
    ).not.toBeNull();

    const winningSuffix = result.correction.id.endsWith("-a") ? "a" : "b";
    const retry = await service.applyCorrection(
      correctionCommand(winningSuffix),
      correctionActor,
    );
    expect(retry.idempotentReplay).toBe(true);
    expect(retry.audit.id).toBe(result.audit.id);
    await expect(
      service.applyCorrection(
        {
          ...correctionCommand(winningSuffix),
          correlationId: `${prefix}-changed-correlation`,
        },
        correctionActor,
      ),
    ).rejects.toMatchObject({ code: "DUPLICATE_SUBMISSION" });

    await accept(
      6,
      "reverify",
      { eventType: "GameVerified", payload: {} },
      "game.reverify",
    );
    expect(
      (await events.replay(ids.account, ids.game, ids.setup)).state.status,
    ).toBe("VERIFIED");
    expect(
      await prisma.securityAuditRecord.count({
        where: {
          accountId: ids.account,
          action: { in: ["game.verify", "game.reopen", "game.reverify"] },
          targetId: ids.game,
        },
      }),
    ).toBe(3);
    expect(
      await projections.findCurrentGameCheckpoint(ids.account, ids.game, {
        sourceRevision: 6,
        privacyOverlayRevision: 0,
        derivationVersion: result.version.statisticDerivationVersion,
      }),
    ).toBeNull();
    await projections.publishGameCheckpoint({
      accountId: ids.account,
      gameId: ids.game,
      sourceRevision: 7,
      privacyOverlayRevision: 0,
      derivationVersion: result.version.statisticDerivationVersion,
    });
    expect(
      await projections.findCurrentGameCheckpoint(ids.account, ids.game, {
        sourceRevision: 7,
        privacyOverlayRevision: 0,
        derivationVersion: result.version.statisticDerivationVersion,
      }),
    ).not.toBeNull();
  });
});
