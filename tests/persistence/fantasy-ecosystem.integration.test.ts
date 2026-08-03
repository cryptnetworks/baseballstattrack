import { createHash, randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { provisionFantasyWorkspace } from "@/domain/fantasy-experience";
import { canonicalJson } from "@/domain/events/event-log";
import type {
  FantasyDomainAuthority,
  FantasyDomainCapability,
} from "@/domain/fantasy-domain";
import type { FantasyStandingsResult } from "@/domain/fantasy-scoring";
import { PrismaFantasyExperienceRepository } from "@/server/data/fantasy-experience-repository";
import { trustedActorForTest } from "../fixtures/trusted-actor";

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const prefix = `fantasy-ecosystem-${process.pid}-${Date.now()}`;
const createdAt = "2026-08-03T12:00:00.000Z";
const accountA = `${prefix}-account-a`;
const accountB = `${prefix}-account-b`;
const ownerUser = `${prefix}-owner-user`;
const viewerUser = `${prefix}-viewer-user`;
const ownerMembership = `${prefix}-owner-membership`;
const viewerMembership = `${prefix}-viewer-membership`;
const seasonId = `${prefix}-season`;
const fantasyLeagueId = randomUUID();
const fantasyTeamId = randomUUID();
const firstEntryId = `${prefix}-entry-a`;
const secondEntryId = `${prefix}-entry-b`;

function digest(value: unknown): string {
  return `sha256:v1:${createHash("sha256")
    .update(canonicalJson(value))
    .digest("hex")}`;
}

function authority(
  capability: FantasyDomainCapability,
  scope: FantasyDomainAuthority["scope"],
): FantasyDomainAuthority {
  return Object.freeze({
    accountId: accountA,
    actorId: ownerUser,
    source: "ACCOUNT_PERMISSION",
    capability,
    scope,
    authorityReferenceIds: Object.freeze(
      capability === "fantasy.league.activate"
        ? [ownerMembership, `${prefix}-activation-review`]
        : [ownerMembership],
    ),
    authorizedAt: createdAt,
  });
}

integration("fantasy ecosystem persistence integration", () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl! }),
  });
  const repository = new PrismaFantasyExperienceRepository(prisma);
  const ownerRosterActor = trustedActorForTest({
    accountId: accountA,
    actorId: ownerUser,
    actorKind: "USER",
    actorUserId: ownerUser,
    membershipId: ownerMembership,
    capability: "fantasy.roster.manage",
    scope: { kind: "ACCOUNT" },
    authorizedAt: createdAt,
  });
  const viewerRosterActor = trustedActorForTest({
    accountId: accountA,
    actorId: viewerUser,
    actorKind: "USER",
    actorUserId: viewerUser,
    membershipId: viewerMembership,
    capability: "fantasy.roster.manage",
    scope: { kind: "ACCOUNT" },
    authorizedAt: createdAt,
  });
  const scoringActor = trustedActorForTest({
    accountId: accountA,
    actorId: ownerUser,
    actorKind: "USER",
    actorUserId: ownerUser,
    membershipId: ownerMembership,
    capability: "fantasy.scoring.calculate",
    scope: { kind: "ACCOUNT" },
    authorizedAt: createdAt,
  });
  const workspace = provisionFantasyWorkspace({
    accountId: accountA,
    seasonId,
    fantasyLeagueId,
    fantasyTeamId,
    ownerMembershipId: ownerMembership,
    leagueName: "Integration league",
    teamName: "Integration team",
    createdAt,
    playerIds: [
      {
        fantasyPlayerEntryId: firstEntryId,
        baseballPlayerId: `${prefix}-player-a`,
        rosterRevision: 1,
      },
      {
        fantasyPlayerEntryId: secondEntryId,
        baseballPlayerId: `${prefix}-player-b`,
        rosterRevision: 1,
      },
    ],
    manageLeagueAuthority: authority("fantasy.league.manage", {
      kind: "ACCOUNT",
    }),
    activateLeagueAuthority: authority("fantasy.league.activate", {
      kind: "FANTASY_LEAGUE",
      fantasyLeagueId,
    }),
    manageTeamAuthority: authority("fantasy.team.manage", {
      kind: "FANTASY_LEAGUE",
      fantasyLeagueId,
    }),
    manageRosterAuthority: authority("fantasy.roster.manage", {
      kind: "FANTASY_LEAGUE",
      fantasyLeagueId,
    }),
    policy: {
      initialAssignmentMethod: "COMMISSIONER_ASSIGNMENT",
      initialAssignmentDeadline: "2026-08-04T12:00:00.000Z",
      acquisitionMethod: "DAILY_WAIVERS",
      waiverProcessingInstants: ["2026-08-05T12:00:00.000Z"],
      initialWaiverPriority: [fantasyTeamId],
      tradeProcessingInstants: ["2026-08-05T12:00:00.000Z"],
      tradeDeadline: "2026-09-05T12:00:00.000Z",
      tradeAcceptance: "ALL_PARTICIPATING_MANAGERS",
      commissionerVeto: "NONE",
      lineupLocks: [],
    },
  });

  beforeAll(async () => {
    await prisma.account.createMany({
      data: [
        { id: accountA, slug: `${prefix}-a`, displayName: "Fantasy A" },
        { id: accountB, slug: `${prefix}-b`, displayName: "Fantasy B" },
      ],
    });
    await prisma.appUser.createMany({
      data: [
        {
          id: ownerUser,
          provider: "google",
          providerSubject: `${prefix}-owner-subject`,
        },
        {
          id: viewerUser,
          provider: "google",
          providerSubject: `${prefix}-viewer-subject`,
        },
      ],
    });
    await prisma.accountMembership.createMany({
      data: [
        {
          id: ownerMembership,
          accountId: accountA,
          userId: ownerUser,
          status: "ACTIVE",
          activatedAt: new Date(createdAt),
        },
        {
          id: viewerMembership,
          accountId: accountA,
          userId: viewerUser,
          status: "ACTIVE",
          activatedAt: new Date(createdAt),
        },
      ],
    });
    await prisma.season.create({
      data: {
        id: seasonId,
        accountId: accountA,
        displayName: "Fantasy integration season",
      },
    });
    await repository.createWorkspace({
      accountId: accountA,
      seasonId,
      ownerMembershipId: ownerMembership,
      leagueExternalId: fantasyLeagueId,
      lineupDeadlineAt: new Date("2026-08-04T12:00:00.000Z"),
      snapshot: workspace,
      actor: trustedActorForTest({
        accountId: accountA,
        actorId: ownerUser,
        actorKind: "USER",
        actorUserId: ownerUser,
        membershipId: ownerMembership,
        capability: "fantasy.league.manage",
        scope: { kind: "ACCOUNT" },
        authorizedAt: createdAt,
      }),
      operationId: randomUUID(),
    });
  });

  afterAll(async () => prisma.$disconnect());

  it("allows the team owner, denies another viewer, and replays duplicates", async () => {
    const operationId = randomUUID();
    const transaction = {
      accountId: accountA,
      leagueId: fantasyLeagueId,
      operationId,
      fantasyTeamId,
      expectedRevision: 0,
      action: "ADD_PLAYER" as const,
      playerEntryId: firstEntryId,
      targetSlotId: "active-1",
    };
    await expect(
      repository.applyUiTransaction({
        accountId: accountA,
        leagueExternalId: fantasyLeagueId,
        transaction,
        actor: ownerRosterActor,
        commissioner: false,
        acceptedAt: new Date("2026-08-03T13:00:00.000Z"),
      }),
    ).resolves.toMatchObject({ duplicate: false });
    await expect(
      repository.applyUiTransaction({
        accountId: accountA,
        leagueExternalId: fantasyLeagueId,
        transaction,
        actor: ownerRosterActor,
        commissioner: false,
        acceptedAt: new Date("2026-08-03T13:00:01.000Z"),
      }),
    ).resolves.toMatchObject({ duplicate: true });
    await expect(
      repository.applyUiTransaction({
        accountId: accountA,
        leagueExternalId: fantasyLeagueId,
        transaction: {
          ...transaction,
          operationId: randomUUID(),
          expectedRevision: 1,
          playerEntryId: secondEntryId,
          targetSlotId: "active-2",
        },
        actor: viewerRosterActor,
        commissioner: false,
        acceptedAt: new Date("2026-08-03T13:01:00.000Z"),
      }),
    ).rejects.toThrow("Fantasy team is unavailable.");
    await expect(
      repository.loadWorkspace(accountB, fantasyLeagueId, viewerMembership),
    ).resolves.toBeNull();
  });

  function standingsResult(
    revision: number,
    id: string,
    previousResultId: string | null,
    previousResultDigest: string | null,
    digestCharacter: string,
    modelVersionId = workspace.model.modelVersionId,
  ): FantasyStandingsResult {
    const sourceDigest = `sha256:v1:${digestCharacter.repeat(64)}`;
    const semanticResult = {
      contractVersion: 1,
      calculationVersion: 1,
      id,
      accountId: accountA,
      fantasyLeagueId,
      status: "FINAL",
      throughPeriodSequence: 1,
      playoffTeamCount: 1,
      completedMatchupCount: 1,
      pendingMatchupCount: 0,
      records: [
        {
          rank: 1,
          fantasyTeamId,
          predeclaredSeed: 1,
          gamesPlayed: 1,
          wins: 1,
          losses: 0,
          ties: 0,
          standingPoints: 2,
          pointsForMilli: 1_000,
          pointsAgainstMilli: 0,
          pointsDifferentialMilli: 1_000,
          categoryTotals: [],
          currentStreak: "W1",
          playoffQualification: "QUALIFIED",
        },
      ],
      sourceMatchups: [
        {
          id: `${prefix}-matchup-${revision}`,
          revision,
          digest: `sha256:v1:${String.fromCharCode(
            digestCharacter.charCodeAt(0) + 1,
          ).repeat(64)}`,
        },
      ],
      lineage: {
        fantasyModelId: workspace.model.modelId,
        fantasyModelVersionId: modelVersionId,
        fantasyModelVersion: workspace.model.version,
        fantasyModelDigest: workspace.model.contentDigest,
        baseballRulesetVersionIds: ["baseball-rules-v1"],
        statisticDerivationVersions: [1],
        statisticRulesVersions: [1],
        sourceRevisions: [revision + 1],
        correctionRevisions: [revision],
      },
      calculatedAt: new Date(
        Date.parse("2026-08-03T14:00:00.000Z") + revision * 60_000,
      ).toISOString(),
      revision,
      previousResultId,
      correction:
        previousResultId && previousResultDigest
          ? {
              reason: `Verified correction ${revision}`,
              previousResultId,
              previousResultDigest,
            }
          : null,
      sourceDigest,
      audit: {
        id: `${prefix}-audit-${revision}-${id}`,
        actorId: ownerUser,
        authoritySource: "ACCOUNT_PERMISSION",
        authorityReferenceIds: [ownerMembership],
        capability: "fantasy.scoring.calculate",
        accountId: accountA,
        fantasyLeagueId,
        targetKind: "STANDINGS",
        targetId: id,
        teamIds: [fantasyTeamId],
        periodId: null,
        action: revision === 0 ? "FINALIZE" : "RECALCULATE",
        acceptedAt: new Date(
          Date.parse("2026-08-03T14:00:00.000Z") + revision * 60_000,
        ).toISOString(),
        revision,
        previousResultId,
        correctionReason:
          previousResultId === null ? null : `Verified correction ${revision}`,
      },
    } satisfies Omit<FantasyStandingsResult, "resultDigest">;
    return { ...semanticResult, resultDigest: digest(semanticResult) };
  }

  it("persists repeatable scoring corrections through more than one revision", async () => {
    const first = standingsResult(0, `${prefix}-result-0`, null, null, "a");
    const second = standingsResult(
      1,
      `${prefix}-result-1`,
      first.id,
      first.resultDigest,
      "b",
    );
    const third = standingsResult(
      2,
      `${prefix}-result-2`,
      second.id,
      second.resultDigest,
      "c",
    );
    for (const payload of [first, second, third]) {
      await repository.appendResult({
        accountId: accountA,
        leagueExternalId: fantasyLeagueId,
        result: { kind: "STANDINGS", payload },
        actor: scoringActor,
      });
    }
    const storedWorkspace =
      await prisma.fantasyLeagueWorkspace.findUniqueOrThrow({
        where: {
          accountId_externalId: {
            accountId: accountA,
            externalId: fantasyLeagueId,
          },
        },
        select: { id: true },
      });
    const persisted = await prisma.fantasyResultSnapshot.findMany({
      where: { accountId: accountA, fantasyLeagueId: storedWorkspace.id },
      orderBy: { revision: "asc" },
      select: {
        id: true,
        logicalId: true,
        revision: true,
        previousSnapshotId: true,
      },
    });
    expect(persisted.map(({ revision }) => revision)).toEqual([0, 1, 2]);
    expect(new Set(persisted.map(({ logicalId }) => logicalId))).toEqual(
      new Set([first.id]),
    );
    expect(
      persisted.map(({ previousSnapshotId }) => previousSnapshotId),
    ).toEqual([null, persisted[0]!.id, persisted[1]!.id]);
    await expect(
      prisma.fantasyResultSnapshot.update({
        where: { id: persisted[0]!.id },
        data: { resultStatus: "REWRITTEN" },
      }),
    ).rejects.toThrow();
  });

  it("rejects scoring results with incompatible models or sibling teams", async () => {
    await expect(
      repository.appendResult({
        accountId: accountA,
        leagueExternalId: fantasyLeagueId,
        result: {
          kind: "STANDINGS",
          payload: standingsResult(
            0,
            `${prefix}-wrong-model`,
            null,
            null,
            "d",
            "other-fantasy-model-v2",
          ),
        },
        actor: scoringActor,
      }),
    ).rejects.toThrow("sealed scoring model");
    const invalidDigest = standingsResult(
      0,
      `${prefix}-invalid-digest`,
      null,
      null,
      "e",
    );
    await expect(
      repository.appendResult({
        accountId: accountA,
        leagueExternalId: fantasyLeagueId,
        result: {
          kind: "STANDINGS",
          payload: {
            ...invalidDigest,
            resultDigest: `sha256:v1:${"0".repeat(64)}`,
          },
        },
        actor: scoringActor,
      }),
    ).rejects.toThrow("digest verification");
    const siblingTeam = standingsResult(
      0,
      `${prefix}-sibling-team`,
      null,
      null,
      "f",
    ) as unknown as { records: Array<{ fantasyTeamId: string }> };
    siblingTeam.records = [{ fantasyTeamId: `${prefix}-other-team` }];
    await expect(
      repository.appendResult({
        accountId: accountA,
        leagueExternalId: fantasyLeagueId,
        result: {
          kind: "STANDINGS",
          payload: siblingTeam as unknown as FantasyStandingsResult,
        },
        actor: scoringActor,
      }),
    ).rejects.toThrow("outside its league");
  });
});
