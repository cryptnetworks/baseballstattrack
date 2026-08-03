# Performance and load budgets

This contract turns the production-shaped M4 workloads into repeatable release
evidence. It complements the browser, bundle, accessibility, and pure-domain
budgets in `RESPONSIVE_PERFORMANCE_AND_ACCESSIBILITY.md`; it does not replace
production telemetry or justify weakening correctness, replay, authorization,
privacy, or transaction guarantees to make a timing threshold green.

## Representative profiles and journeys

The executable definitions live in
`src/server/observability/performance-budgets.ts`. The database integration
harness seeds isolated synthetic Account data and exercises public repository
boundaries against PostgreSQL.

| Journey                       | Representative dataset                                                                                   | Samples and measured boundary                                                                                          | Release p95 budget |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -----------------: |
| Durable scoring acceptance    | A started game followed by 75 sequential strikeout plate appearances, alternating sides every three outs | All 75 growing-history acceptance transactions, including validation, lock, replay, and durable writes                 |           1,000 ms |
| Game box-score generation     | The same 75-event accepted history and its setup/presentation snapshots                                  | 10 warmed loads through accepted-history replay, presentation loading, evidence verification, and box-score derivation |           3,000 ms |
| Season dashboard source query | One Account/team season with the repository's bounded 100 ready games                                    | 10 warmed loads of setup, team, lineup, and privacy source data                                                        |           1,500 ms |

These are generous release regression thresholds, not claims about hosted-user
latency. Scoring matches the production reliability SLO's one-second good-event
boundary. Report and dashboard budgets account for a cold or shared CI database
while still catching query explosions and accidentally unbounded work. The
harness asserts the exact event and game cardinalities so a faster result caused
by silently dropping data fails.

Controlled release measurements use a migrated, isolated, production-shaped
PostgreSQL database and synthetic data. Store release/version, database
version, dataset cardinality, query count, and percentile output together.
Machine-specific timing snapshots are evidence for that environment, not
universal production baselines.

## Highest-cost paths

The tracked path identifiers are executable so changing or removing one is a
reviewed decision.

1. `scoring-acceptance-replay-write`: every accepted event validates the
   command, locks the game boundary, reloads/replays growing history, and writes
   authoritative transaction/event/audit state. This is the highest-risk write
   path and may not trade atomicity or evidence verification for speed.
2. `game-report-history-presentation-replay`: a report loads setup, events, and
   corrections plus presentation/privacy/checkpoint data, then replays and
   derives statistics. Batch exports must retain the existing batched source
   APIs rather than introduce per-game N+1 reads.
3. `season-dashboard-bounded-game-sources`: the dashboard verifies the current
   choice and loads privacy overlays plus nested setup/team/lineup data for at
   most 100 games. The bound is part of the performance contract; pagination is
   required before raising it.

The M3 controlled harness additionally tracks a 75-event pure evidence replay,
a 100-game many-candidate dashboard derivation, and near-limit import
validation. The live-scoring route remains the largest recorded client bundle.
Together these identify CPU, database, and delivery costs without conflating
them into one number.

## Production measurement and query review

Instrument server-boundary latency histograms for accepted scoring, report
generation, and dashboard loads with environment and release/version labels.
Record aggregate result cardinality and typed outcome, but never Account ids,
player data, event payloads, secrets, SQL parameters, or arbitrary error text.
Use the same p95 definitions as the release harness and the scoring SLO; alerting
and error-budget policy remain in `PRODUCTION_RELIABILITY.md`.

When a budget or production trend regresses:

1. reproduce against a disposable production-shaped dataset and preserve the
   query count, result cardinality, release SHA, database version, and timing;
2. capture sanitized `EXPLAIN (ANALYZE, BUFFERS)` evidence for the slow query on
   a non-production clone or equivalent safe environment;
3. decide whether the cause is an unbounded/N+1 call shape, missing pagination,
   unnecessary replay/derivation, or an evidenced index need;
4. review any index as a normal production migration with write/space cost and
   rollback notes; and
5. repeat the controlled measurement and compare it with hosted production
   telemetry.

Do not add speculative indexes, time only mocks, lower a threshold, reduce the
dataset, skip evidence verification, or cache across Account/privacy/source
revisions to manufacture a pass. Hosted p50/p95/p99 trends and safe query-plan
evidence remain operational evidence to collect after deployment; this
repository establishes the measurement contract and release guardrail.
