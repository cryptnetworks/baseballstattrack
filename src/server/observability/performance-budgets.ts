export type WorkloadBudget = Readonly<{
  workflow: string;
  profile: string;
  samples: number;
  p95Milliseconds: number;
}>;

export const PRODUCTION_WORKLOAD_PROFILE = Object.freeze({
  scoringEvents: 75,
  seasonGames: 100,
  reportSamples: 10,
  dashboardSamples: 10,
});

export const PRODUCTION_WORKLOAD_BUDGETS = Object.freeze({
  scoringAcceptance: {
    workflow: "durable scoring-event acceptance",
    profile: "75 sequential accepted plate appearances in one game",
    samples: PRODUCTION_WORKLOAD_PROFILE.scoringEvents,
    p95Milliseconds: 1_000,
  },
  gameReport: {
    workflow: "game box-score generation",
    profile: "load and replay a 75-event accepted history",
    samples: PRODUCTION_WORKLOAD_PROFILE.reportSamples,
    p95Milliseconds: 3_000,
  },
  seasonDashboard: {
    workflow: "season dashboard source query",
    profile: "load the bounded 100-game season window",
    samples: PRODUCTION_WORKLOAD_PROFILE.dashboardSamples,
    p95Milliseconds: 1_500,
  },
} satisfies Record<string, WorkloadBudget>);

export const TRACKED_HIGH_COST_PATHS = Object.freeze([
  {
    id: "scoring-acceptance-replay-write",
    reason:
      "Every accepted event validates, locks, replays growing history, and commits authoritative rows.",
  },
  {
    id: "game-report-history-presentation-replay",
    reason:
      "A report loads accepted history and presentation data, verifies evidence, and derives statistics.",
  },
  {
    id: "season-dashboard-bounded-game-sources",
    reason:
      "The dashboard joins setup, team, lineup, and privacy data for as many as 100 games.",
  },
]);
