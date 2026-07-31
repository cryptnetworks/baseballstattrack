import { describe, expect, it, vi } from "vitest";

import { StatisticsApiService } from "@/server/app/statistics-api-service";
import type { GameBoxScoreService } from "@/server/app/game-box-score-service";
import type { SeasonDashboardService } from "@/server/app/season-dashboard-service";
import type { PrismaStatisticsApiRepository } from "@/server/data/statistics-api-repository";
import { trustedActorForTest } from "../fixtures/trusted-actor";

const accountId = "account-internal";
const externalAccount = "00000000-0000-4000-8000-000000000091";

function actor(
  capability: "account.view" | "game.view" | "roster.view",
  account = accountId,
) {
  return trustedActorForTest({
    accountId: account,
    actorId: "viewer",
    actorKind: "USER",
    actorUserId: "viewer",
    capability,
    scope: { kind: "ACCOUNT" },
    authorizedAt: "2026-07-31T18:00:00.000Z",
  });
}

function service(repository: Partial<PrismaStatisticsApiRepository>) {
  return new StatisticsApiService(
    repository as PrismaStatisticsApiRepository,
    {} as GameBoxScoreService,
    {} as SeasonDashboardService,
  );
}

describe("statistics API service boundary", () => {
  it("returns an external Account contract without internal keys", async () => {
    const api = service({
      resolveAccountByInternalId: vi.fn().mockResolvedValue({
        id: accountId,
        externalId: externalAccount,
        displayName: "Stars",
        status: "ACTIVE",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      }),
    });
    const result = await api.account(accountId, actor("account.view"));
    expect(result).toEqual({
      apiVersion: "v1",
      data: {
        id: externalAccount,
        displayName: "Stars",
        status: "ACTIVE",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    });
    expect(JSON.stringify(result)).not.toContain(accountId);
  });

  it("paginates empty results and exposes corrected, incomplete, and stale games", async () => {
    const gameIds = [1, 2, 3].map(
      (value) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`,
    );
    const listGames = vi.fn().mockResolvedValue({
      data: [
        {
          externalId: gameIds[0],
          status: "CORRECTED",
          revision: 4,
          scheduledAt: null,
          season: { externalId: externalAccount },
          teamSeason: { team: { externalId: externalAccount } },
          sourceEvents: [{ id: "private-correction" }],
          projectionCheckpoints: [
            {
              status: "CURRENT",
              sourceRevision: 3,
              privacyOverlayRevision: 1,
              derivationVersion: 2,
            },
          ],
        },
        {
          externalId: gameIds[1],
          status: "IN_PROGRESS",
          revision: 2,
          scheduledAt: null,
          season: { externalId: externalAccount },
          teamSeason: { team: { externalId: externalAccount } },
          sourceEvents: [],
          projectionCheckpoints: [],
        },
      ],
      nextCursor: null,
    });
    const api = service({ listGames });
    const result = await api.directory(
      "games",
      accountId,
      new URLSearchParams("limit=2&direction=asc"),
      actor("game.view"),
    );
    expect(result.data).toEqual([
      expect.objectContaining({
        id: gameIds[0],
        correctionState: "CORRECTED",
        verificationState: "UNVERIFIED",
        freshness: "STALE",
      }),
      expect.objectContaining({
        id: gameIds[1],
        reportStatus: "IN_PROGRESS",
        freshness: "INCOMPLETE",
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain("private-correction");

    listGames.mockResolvedValueOnce({ data: [], nextCursor: null });
    await expect(
      api.directory(
        "games",
        accountId,
        new URLSearchParams(),
        actor("game.view"),
      ),
    ).resolves.toMatchObject({ data: [], page: { nextCursor: null } });
  });

  it("rejects wrong-Account actors and malformed pagination before reads", async () => {
    const listGames = vi.fn();
    const api = service({ listGames });
    await expect(
      api.directory(
        "games",
        accountId,
        new URLSearchParams(),
        actor("game.view", "other-account"),
      ),
    ).rejects.toThrow();
    await expect(
      api.directory(
        "games",
        accountId,
        new URLSearchParams("limit=1000"),
        actor("game.view"),
      ),
    ).rejects.toMatchObject({
      code: "INVALID_QUERY",
    });
    await expect(
      api.directory(
        "games",
        accountId,
        new URLSearchParams("seasonId=not-a-uuid"),
        actor("game.view"),
      ),
    ).rejects.toMatchObject({ code: "INVALID_QUERY" });
    await expect(
      api.directory(
        "games",
        accountId,
        new URLSearchParams("unknown=value"),
        actor("game.view"),
      ),
    ).rejects.toMatchObject({ code: "INVALID_QUERY" });
    expect(listGames).not.toHaveBeenCalled();
  });

  it("maps directory records to stable public fields", async () => {
    const api = service({
      listPlayers: vi.fn().mockResolvedValue({
        data: [
          {
            externalId: externalAccount,
            displayName: "Jordan",
            battingSide: "RIGHT",
            throwingHand: "RIGHT",
            archivedAt: new Date("2026-01-01T00:00:00.000Z"),
            revision: 3,
          },
        ],
        nextCursor: null,
      }),
    });
    const result = await api.directory(
      "players",
      accountId,
      new URLSearchParams(),
      actor("roster.view"),
    );
    expect(result.data).toEqual([
      {
        id: externalAccount,
        displayName: "Jordan",
        battingSide: "RIGHT",
        throwingHand: "RIGHT",
        archived: true,
        revision: 3,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("archivedAt");
    expect(JSON.stringify(result)).not.toContain("externalId");
  });
});
