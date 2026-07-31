import { describe, expect, it } from "vitest";

import {
  PRODUCTION_WORKLOAD_BUDGETS,
  PRODUCTION_WORKLOAD_PROFILE,
  TRACKED_HIGH_COST_PATHS,
} from "@/server/observability/performance-budgets";

describe("production workload budgets", () => {
  it("keeps the representative datasets and release thresholds explicit", () => {
    expect(PRODUCTION_WORKLOAD_PROFILE).toEqual({
      scoringEvents: 75,
      seasonGames: 100,
      reportSamples: 10,
      dashboardSamples: 10,
    });
    expect(PRODUCTION_WORKLOAD_BUDGETS).toMatchObject({
      scoringAcceptance: { samples: 75, p95Milliseconds: 1_000 },
      gameReport: { samples: 10, p95Milliseconds: 3_000 },
      seasonDashboard: { samples: 10, p95Milliseconds: 1_500 },
    });
    expect(TRACKED_HIGH_COST_PATHS.map(({ id }) => id)).toEqual([
      "scoring-acceptance-replay-write",
      "game-report-history-presentation-replay",
      "season-dashboard-bounded-game-sources",
    ]);
  });
});
