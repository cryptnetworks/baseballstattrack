import { describe, expect, it, vi } from "vitest";

import { SeasonDashboardService } from "@/server/app/season-dashboard-service";
import { createTrustedActorContext } from "@/server/auth/types";

describe("season dashboard service boundary", () => {
  it("denies cross-Account and wrong-team reads before persistence", async () => {
    const listChoices = vi.fn();
    const loadGameSources = vi.fn();
    const loadAcceptedHistories = vi.fn();
    const service = new SeasonDashboardService(
      { listChoices, loadGameSources },
      { loadAcceptedHistories },
    );
    const actor = createTrustedActorContext({
      accountId: "account-a",
      appUserId: "user-a",
      membershipId: "membership-a",
      actorKind: "USER",
      actorId: "user-a",
      actorUserId: "user-a",
      capability: "report.view",
      authorityReferenceIds: ["role-a"],
      target: {
        kind: "TEAM",
        accountId: "account-a",
        teamIds: ["team-a"],
        seasonId: null,
        gameId: null,
      },
      authorizedAt: "2026-07-30T22:30:00.000Z",
    });

    await expect(
      service.load(
        {
          accountId: "account-a",
          teamId: "team-other",
          seasonId: "season-a",
        },
        actor,
      ),
    ).rejects.toThrow(/team-season report authorization/u);
    expect(listChoices).not.toHaveBeenCalled();
    expect(loadGameSources).not.toHaveBeenCalled();
    expect(loadAcceptedHistories).not.toHaveBeenCalled();
  });
});
