# Scoring Fixtures

## Purpose and authority

The issue #12 fixtures exercise ordinary games and difficult scoring decisions
through the production event validators, deterministic reducer, statistic
deriver, and Prisma event repository. They are executable examples of the
contracts in `SCORING_SEMANTICS.md`, `IMMUTABLE_GAME_EVENT_MODEL.md`, and
`STATISTIC_DERIVATION.md`; they do not create new scoring rules.

Accepted setup snapshots and accepted events remain authoritative. Expected
states and statistics are assertions over replay, not stored source data or a
second implementation.

## Structure

`tests/fixtures/scoring-fixture-builder.ts` owns the pure-domain fixture
vocabulary:

1. `createScoringSetup` creates a fresh Account-scoped accepted setup, ruleset
   reference, five-player batting orders, starting pitchers, eligible
   relievers, and inactive substitutes.
2. `ScoringFixtureBuilder.append` parses the body with the production Zod
   schema, constructs a versioned accepted envelope, derives pre/post evidence
   through production replay, parses the completed envelope, and appends it to
   private history.
3. Named checkpoints preserve independently inspectable intermediate states.
4. `statistics` sends a fresh setup/history copy through the production
   statistic deriver.

The builder returns structured copies and never exposes mutable shared history.
IDs, timestamps, revisions, event order, and expected values are stable.

`tests/fixtures/persistence-scoring-fixture.ts` creates the minimum relational
Account, teams, season, players, rosters, ruleset, game, setup, sides, and lineup
slots for the PostgreSQL pipeline test. The data is isolated by a test-process
prefix and contains synthetic labels only.

The Prisma repository exposes `loadAcceptedHistory(accountId, gameId,
setupSnapshotId)` so replay and the full-pipeline fixture use the same
Account-scoped persisted setup/event mapping and correction-integrity checks.
The public history read verifies stored state evidence before returning;
`replay` uses the same internal loader and strict verification path.

## Coverage matrix

| Fixture group        | State and scoring coverage                                                                                                                                                                    | Statistic coverage                                                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Regulation           | Two innings, hits, outs, runs, lineup continuation, regulation completion                                                                                                                     | Inning lines, final box score, batting and pitching lines, team reconciliation                                                           |
| Walk and strikeout   | Walk to first, strikeout out, next batter, source revision                                                                                                                                    | PA/AB, BB, SO, OBP, pitcher batters faced and outs                                                                                       |
| Error                | Reach on error followed by a scoring advance                                                                                                                                                  | Hit exclusion, ROE, fielding error, unearned run, no RBI                                                                                 |
| Sacrifice            | Triple/SF and single/SH with explicit movements                                                                                                                                               | PA without AB, SF, SH, RBI, run, pitcher out                                                                                             |
| Running              | Two steals and caught stealing                                                                                                                                                                | SB, CS, base clearing, pitcher out, putout                                                                                               |
| Double play          | One atomic two-out PA ending the inning                                                                                                                                                       | Putouts, assist, double-play participation, pitching outs                                                                                |
| Pitching change      | Mid-inning change with occupied first base                                                                                                                                                    | Appearance, inherited runner, inherited runner scored, responsibility to removed pitcher, zero-out reliever                              |
| Extra innings        | Tied one-inning regulation, continued lineups, extra-inning run                                                                                                                               | Extra inning line, final score, no nine-inning assumption                                                                                |
| Correction           | Accepted single replaced by reached-on-error judgment                                                                                                                                         | Original event immutability, hit/error rebuild, source revision, repeated deterministic output                                           |
| Lifecycle            | Suspend/resume, substitution, alignment, abandonment, cancellation, walk-off, verify/reopen/reverify                                                                                          | Lifecycle and season-eligibility metadata                                                                                                |
| Invalid domain input | Wrong batter, occupied destination/partial play, impossible out order, invalid substitution, terminal-state scoring, Account/game/version/revision mismatch, invalid correction targets/graph | Stable `GameEventError` codes                                                                                                            |
| Persistence pipeline | Setup, acceptance, append-only persistence, reload, strict replay, derivation, box score                                                                                                      | Final score, inning lines, player/team counters, exact idempotency retry, changed idempotency rejection, stale write, tenant-denied read |

The existing focused event, replay, correction, statistic formula, projection,
concurrency, migration, and schema tests remain the lower-level regression
suite. These representative fixtures compose those capabilities; they do not
duplicate every focused permutation.

## Expected-value review

Expected values are written as small, reviewable baseball facts rather than
captured whole-object snapshots. For each scenario:

- inning, half, outs, score, bases, batting-order index/current batter, active
  pitcher, lineup/defense, lifecycle, and source revision are counted from the
  ordered actions;
- PA, AB, hit, walk, strikeout, sacrifice, steal, error, out, and run counters
  are tallied manually using `STATISTIC_DERIVATION.md`;
- pitcher responsibility follows the runner's responsible pitcher, including
  inherited runners;
- every statistical out has an explicit putout path or fielding credit;
- inning lines and team/player totals are reconciled independently;
- exact rates are asserted as reduced numerator/denominator pairs, never copied
  from formatted implementation output.

Review changes action-by-action. Do not update expectations by serializing the
current projection.

## Correction pattern

The correction fixture accepts a single, saves an independent copy of that
source event, then appends `CorrectionApplied` with a stable replacement ID and
an explicit reached-on-error body. Assertions prove:

- the original accepted event is byte-for-byte unchanged;
- accepted history contains the appended correction;
- effective replay changes the hit to an error;
- batting, pitching, and fielding totals rebuild from effective history;
- metadata advances to the correction's source revision; and
- repeated replay and derivation are identical.

Corrections never update or delete accepted source events.

## Pure and persistence layers

Pure-domain fixtures run on every `npm test` invocation without network,
database, clock, locale, or random dependencies. They are the fast source for
scoring failures and meaningful intermediate-state output.

The focused PostgreSQL fixture runs only when `DATABASE_URL` points to the
explicit disposable test database, as in CI. It accepts events through
`PrismaGameEventRepository`, reloads the accepted setup and events through the
same repository, verifies replay evidence, derives statistics from reloaded
history, and checks the final box score. It does not contact Supabase or any
production service. Vitest executes test files serially because independent
integration files use serializable event-acceptance transactions against the
same disposable database; file-level concurrency can create unrelated
serialization pivots and obscure the behavior under test. Domain assertions
remain fast, and concurrency is exercised explicitly inside the focused
repository test.

## Synthetic-data and privacy policy

Fixtures may contain only obvious synthetic identifiers and labels. They must
not contain real names, contact data, dates of birth, birth years, free-form
notes, production exports, or copied youth-player records. Account context must
be explicit in every setup, command, read, and persistence relationship.
Database fixtures are disposable test data; no reusable development or
production seed is created.

## Adding a fixture

1. Confirm the scoring fact is defined by the canonical contracts and supported
   event vocabulary. If not, defer it to the issue that owns the vocabulary or
   ruleset change.
2. Start with a fresh `createScoringSetup` or a purpose-specific override. Never
   mutate exported constants or another fixture's setup/history.
3. Express each action as a typed event body with explicit runner movements,
   pitcher responsibility, earned-run judgment, and fielding attribution.
4. Add named checkpoints at decisions a scorekeeper would inspect.
5. Assert the smallest useful state, player, team, and box-score facts.
6. Hand-check expected values and explain non-obvious scoring in the test name
   or local assertion structure.
7. Add a persistence case only when relational acceptance/reload behavior is
   material; keep ordinary scoring permutations pure and fast.
8. Run the fixture file independently, repeated deterministic runs, the full
   suite, database migration/representability checks, and `npm run verify`.

## Deferred cases

Issue #12 does not expand the event vocabulary or ruleset implementation.
League-specific tiebreak runners, interference subtypes, detailed earned-run
reconstruction, balks, appeals, protests, pitch-level scoring, uncommon
pickoff rules, and additional substitution rules remain deferred until their
governing contracts and issue scope support them. Issue #18 fixtures cover the
schema-v3 atomic runner-play subset for errors, steals/caught stealing,
pickoffs, wild pitches, and passed balls. The fixture builder should be
extended only after additional production semantics exist.

## Acceptance mapping

The representative domain suite covers every issue #12 scoring and lifecycle
group, intermediate state, player/team statistic, correction, and invalid-domain
criterion. The PostgreSQL suite covers the required end-to-end pipeline plus
idempotency, stale revision, and tenant isolation. This document records the
architecture, coverage, manual expected-value method, correction model,
synthetic-data controls, extension procedure, and explicitly deferred scoring
cases.
