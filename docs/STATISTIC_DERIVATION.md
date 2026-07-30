# Deterministic statistic derivation

Issue #11 implements versioned batting, pitching, fielding, team, game, and supported season derivation from the immutable issue #10 event boundary. Source events remain authoritative. Statistic results and `ProjectionCheckpoint` rows are rebuildable outputs and are never replay inputs or authorization evidence.

## Authoritative inputs and pipeline

A game projection uses only:

1. one exact accepted setup snapshot;
2. accepted source events explicitly ordered by sequence;
3. the effective replacement/reversal graph produced by append-only corrections;
4. the setup and event `rulesetVersionId`;
5. event schema versions;
6. `STATISTIC_RULES_VERSION`;
7. `STATISTIC_DERIVATION_VERSION`; and
8. a privacy-overlay revision used only for projection freshness.

`replayGameTimeline` resolves corrections, validates authoritative replay, and exposes each effective body with its deterministic pre-event state. The statistic pipeline then extracts integer facts, aggregates players and sides, computes exact rates, verifies reconciliation, and returns sorted arrays plus version metadata. It does not read current rosters, names, membership, wall-clock time, locale, random state, previously stored totals, or database row order.

`STATISTIC_DERIVATION_VERSION` is currently `2`; version 2 adds the schema-v3 runner-play interpretations documented below. It changes when a formula, event interpretation, earned-run rule, fielding rule, or display-independent numeric behavior changes. `STATISTIC_RULES_VERSION` remains `1`; unknown versions fail with `UNSUPPORTED_RULESET`. Database ruleset identity remains separately present as `rulesetVersionId`.

## Event schema v2 and earned runs

Issue #10 event schema v1 omitted the earned/unearned fact that the scoring contract requires for exact ERA. Error-only reconstruction was not safe: v1 cannot always distinguish every error-enabled base from later discretionary advancement, and approximating earned runs would make ERA look authoritative when it is not.

Event schema v2 is therefore a narrow, durable compatibility correction:

- every counting movement to home records `earnedRun` as `EARNED`, `UNEARNED`, or `PENDING`;
- a successful steal of home records the same judgment;
- non-counting runs and non-scoring movements cannot carry the field;
- v2 acceptance requires the field for every counting run;
- v1 events remain replayable without rewriting stored history;
- statistic derivation fails with `UNSUPPORTED_EVENT_VERSION` when a v1 counting run lacks the fact; and
- a `PENDING` judgment fails with `INCOMPLETE_REPLAY_STATE` until an append-only correction supplies a final classification.

Earned runs are summed from the explicit effective scoring judgments and charged to each movement's `responsiblePitcherId`. This implementation deliberately does not simulate or guess an error-free inning.

## Event schema v3 runner plays

Event schema v3 adds `RunnerPlayRecorded`, an atomic movement ledger for
standalone optional advances, errors, steals, caught stealing, pickoffs, wild
pitches, and passed balls. Statistic derivation applies every counting movement
to runs and responsible-pitcher totals, successful steal movements to `SB`,
caught-stealing outs to `CS`, out paths to pitcher/fielding outs, and explicit
error credits to fielding errors. Runner-only scoring remains RBI-ineligible.
Versions 1 and 2 remain replayable and cannot contain this event type.

## Raw batting counters

The raw line contains `PA`, `AB`, `R`, `H`, `1B`, `2B`, `3B`, `HR`, `RBI`, `BB`, `IBB`, `HBP`, `SO`, `SF`, `SH`, `ROE`, `FC`, `TB`, `SB`, and `CS`.

| Recorded outcome                 |  PA |  AB | Other effects                                         |
| -------------------------------- | --: | --: | ----------------------------------------------------- |
| Single, double, triple, home run |   1 |   1 | `H` plus the matching hit type; `TB` is 1, 2, 3, or 4 |
| Walk, intentional walk           |   1 |   0 | `BB`; intentional walk also increments `IBB`          |
| Hit by pitch                     |   1 |   0 | `HBP`                                                 |
| Swinging or looking strikeout    |   1 |   1 | `SO`                                                  |
| Batter out                       |   1 |   1 | no hit                                                |
| Fielder's choice                 |   1 |   1 | `FC`, no hit                                          |
| Reached on error                 |   1 |   1 | `ROE`, no hit                                         |
| Sacrifice fly                    |   1 |   0 | `SF`                                                  |
| Sacrifice bunt                   |   1 |   0 | `SH`                                                  |

Runs come only from effective runner movements to home whose `runCounts` judgment is true. The runner receives `R`. A scoring movement with `rbiEligible: true` awards one RBI to the enclosing plate-appearance batter. A standalone movement cannot award an RBI because schema v2 has no batter/play reference at that boundary; it fails rather than guessing. Walk-off plays use their recorded movements and therefore need no separate statistic exception.

Successful `StolenBaseAttemptRecorded` events increment `SB`; failed attempts increment `CS`. A `RunnerOutRecorded` explicitly classified as caught stealing also increments `CS`. Runner-only events never alter a batter's PA or AB.

## Batting formulas

Rates are represented as reduced `{ numerator, denominator }` pairs. A zero denominator produces `null`.

- `AVG = H / AB`
- `OBP = (H + BB + HBP) / (AB + BB + HBP + SF)`
- `SLG = TB / AB`
- `OPS = OBP + SLG`, as an exact rational sum
- `TB = 1B + 2×2B + 3×3B + 4×HR`

`BB` includes intentional walks. Sacrifice bunts are excluded from the OBP denominator; sacrifice flies are included. Reached-on-error and fielder's-choice outcomes count as AB but not H or times on base in the numerator.

The current `INTERFERENCE` outcome does not distinguish catcher interference from other ruleset-specific interference. Because the canonical contract makes its OBP treatment ruleset-dependent, derivation fails with `UNSUPPORTED_RULESET` if it encounters this outcome. Dropped-third-strike, generic award, balk, defensive-indifference, and special-runner source types are not present in the accepted vocabulary and are not fabricated. Schema v3 accepts wild-pitch and passed-ball runner plays, but no pitch-level facts are inferred.

## Pitching counters and formulas

The pitching line contains appearances, starts, batters faced, outs, hits allowed, runs allowed, earned runs, walks, strikeouts, hit batters, home runs allowed, inherited runners, and inherited runners scored.

- A started game gives each setup starting pitcher one appearance and one start.
- `PitchingChangeMade` gives the incoming pitcher one appearance and records its explicit inherited-runner count.
- Each PA is charged to its recorded pitcher.
- Hits, walks, strikeouts, HBP, and home runs allowed follow the PA outcome.
- All outs made during a PA are charged to that PA's pitcher. Standalone runner outs and caught stealing are charged to the active pitcher in the deterministic pre-event state.
- Runs and earned runs are charged to `responsiblePitcherId`, including after a pitching change.
- If a counting run's responsible pitcher differs from the active pitcher, the active pitcher receives one inherited runner scored.

Pitching arithmetic always uses outs:

- `IP display = floor(outs / 3) + "." + (outs mod 3)`; `20` outs displays as `6.2` baseball notation.
- `ERA = earnedRuns × 27 / outs`
- `WHIP = (walks + hitsAllowed) × 3 / outs`

ERA and WHIP are `null` at zero outs. Winning/losing pitcher, save, hold, wild pitch, balk, and pitcher-of-record decisions are unsupported.

## Fielding counters and formulas

Supported counters are putouts, assists, errors, double plays participated in, and triple plays participated in.

- PA `fieldingCredits` are authoritative when present.
- A standalone out path uses the final listed fielder as the putout and unique earlier fielders as assists.
- Missing attribution for an out fails with `MISSING_ATTRIBUTION`; the current lineup is never substituted for scorer evidence.
- A two- or three-out PA awards one DP or TP participation to each unique explicitly credited putout/assist participant.
- `chances = putouts + assists + errors`
- `fielding percentage = (putouts + assists) / chances`

Fielding percentage is `null` at zero chances. Schema v3 records passed-ball
responsibility for replay and audit, but passed-ball counting statistics and
position-specific appearances are not emitted by the current projection.

## Team, inning, game, and season results

Game output includes sorted player lines, side totals, inning runs, final score, lifecycle/verification metadata, and `HOME_WIN`, `AWAY_WIN`, `TIE`, or `UNDECIDED`. Win/tie outcome is returned only for completed, corrected, or verified lifecycle states. Ready, live, suspended, abandoned, and cancelled projections may describe deterministic partial facts but are unverified and excluded from official season aggregation.

Reconciliation checks prove:

- player batting totals sum to side batting totals;
- total bases equal the hit-component formula;
- player runs and inning runs equal replay's final score;
- pitching outs equal explicitly credited defensive putouts; and
- player fielding errors sum to side errors.

Any mismatch fails with `RECONCILIATION_FAILURE`; counters are never coerced to zero. Exact left-on-base is not emitted because schema v2 does not preserve every source fact needed by the canonical LOB definition.

`deriveSeasonStatistics` is a pure one-team rollup interface. The caller supplies an Account, season, team, and explicit game-side selections. It rejects mixed Accounts, duplicate game sides, and incompatible derivation semantics. Verified games are included by default; unverified games are listed as excluded unless an explicitly provisional caller opts in. Raw counters are summed first and rates are recomputed from season totals rather than averaging game rates. The current `AcceptedSetup` has side snapshots but no stable team id, so the persistence/service adapter must supply the selected team id and side; issue #11 does not invent a current-roster lookup.

## Exact values and display

Integer counters are the only aggregation inputs. `exactRate` reduces safe nonnegative integer numerator/denominator pairs by greatest common divisor. `addExactRates` performs exact rational addition. Formatted strings never feed another calculation.

`formatExactRate` uses locale-independent integer half-up rounding at the requested precision. Batting display convention is three digits with an omitted leading zero when requested (`.333`); ERA/WHIP callers may retain the leading zero and select their report precision. Undefined machine values remain `null`; presentation may render an em dash, but the core result does not store one. `formatInningsPitched` renders baseball notation and is never used for arithmetic.

## Corrections and deterministic guarantees

Replacement bodies are materialized at the original target location during effective replay, while the accepted correction still advances source revision and lifecycle at its append position. Superseded events contribute no facts. Reversing a correction deterministically restores the prior effective path. Rebuilding the same setup and history, reading rows in a different retrieval order, or JSON round-tripping the typed input produces the same sorted result and exact rational values.

Structured derivation errors cover unsupported event/rules versions, incomplete replay or run classification, missing attribution, impossible counters, reconciliation failure, Account mismatch, stale projection publication, invalid correction graphs, and internal invariants. Unknown events are never silently skipped.

## Projection freshness and concurrency

The schema stores checkpoint metadata, not statistic payload rows. `PrismaStatisticProjectionRepository` therefore publishes only replaceable game freshness checkpoints:

- exact Account and game;
- source revision equal to current `Game.revision`;
- Account privacy-overlay revision;
- derivation version; and
- `CURRENT` or superseded `STALE` status.

Publication runs in a serializable transaction. The exact same identity is idempotent. A correction or newer accepted event advances `Game.revision`, so an older worker fails with `STALE_PROJECTION_WRITE`. A newer Account privacy overlay likewise prevents an older display projection from becoming current. Publishing one current checkpoint marks older current checkpoints stale. The checkpoint contains no authoritative aggregate and grants no report access. Season checkpoint publication, worker scheduling, payload persistence, caching, and authorization remain future service work.

Privacy overlays can change display resolution but not baseball calculation. No statistic result contains names, contact information, birth/age data, notes, medical data, secrets, raw audit data, or full event payloads.

## Acceptance mapping and issue #12 boundary

- AVG, OBP, SLG, OPS, PA, AB, hits and extra-base hits, RBI, runs, walks, strikeouts, HBP, SB, CS, ERA, WHIP, IP, and supported fielding metrics have explicit counters, formulas, zero-denominator behavior, and focused tests.
- Correction-aware effective replay, explicit versions, exact values, stable ordering, reconciliation, JSON round trips, shuffled retrieval, repeated rebuilds, Account isolation, and checkpoint compare-and-set tests establish reproducibility.
- Issue #11 tests cover formula and event mappings plus focused correction, pitching-change, inherited-runner, fielding, lifecycle, and season cases. Issue #12 remains responsible for the broad representative multi-game fixture catalog and uncommon scoring combinations.
