# Immutable game-event model

Issue #10 implements the authoritative, Account-scoped scoring-transition boundary. One exact accepted setup snapshot plus ordered accepted source events and append-only correction relationships are the source of truth. Statistics, projections, current roster rows, display names, membership state, and privacy overlays are never replay inputs.

## Envelope, ordering, and versions

Every accepted event contains:

- stable event, Account, game, setup-snapshot, play-transaction, client-submission, and actor identifiers;
- accepted setup revision and baseball ruleset version;
- strict event type and typed payload;
- contiguous game sequence, expected source revision, and accepted source revision;
- deterministic component order when associated with a play transaction;
- `recordedAt`, the submitted recording time, and `acceptedAt`, the authoritative PostgreSQL transaction time;
- versioned SHA-256 pre-state and post-state evidence.

Sequence and source revision—not either timestamp—determine order. Sequence starts at one and each accepted transaction advances both sequence and source revision by one. The database prevents ties. Serializable acceptance and a `Game.revision` compare-and-swap ensure that one of two writers for the same expected revision wins.

`EVENT_SCHEMA_VERSION` is currently 2. Versions 1 and 2 have strict validation branches. Version 2 adds the explicit earned/unearned/pending judgment required for every counting run, including a successful steal of home; it does not rewrite version 1 rows. Version 1 remains replayable, but exact statistic derivation fails visibly when a v1 scoring run lacks that judgment. Unknown versions and event types fail closed, and type/payload mismatches are rejected. Future versions must preserve stored payloads through explicit parser/upcast branches. Baseball interpretation remains separately pinned by `rulesetVersionId`. The narrow issue #11 compatibility decision and behavior are documented in [STATISTIC_DERIVATION.md](STATISTIC_DERIVATION.md).

## Typed vocabulary and privacy

Version 1 supports:

- lifecycle: start, suspend, resume, complete, verify, reopen, abandon, and cancel;
- atomic plate appearances: walks, intentional walks, hit by pitch, strikeouts, hits by base value, batter outs, fielder's choice, reached on error, sacrifices, and interference;
- complete runner ledgers with origin, destination/out, cause, force judgment, pitcher responsibility, out order, run-counting judgment, and RBI eligibility;
- standalone runner advances/outs and stolen-base/caught-stealing attempts;
- defensive substitutions, defensive alignment, and pitching changes with inherited runners;
- append-only correction replacement, reversal, and correction-of-correction.

Plate-appearance payloads keep batter credit, movement, fielding credit, and scorer judgment distinct while accepting them as one all-or-nothing event. This prevents a run, out, or batter result from being accepted partially. Aggregated game/season/career statistics are intentionally absent.

Payloads are strict allowlists of stable IDs and baseball facts. They reject names, contacts, birth/age data, notes, medical/injury/family information, secrets, tokens, URLs, and generic metadata. Errors never echo payloads or raw database errors.

## Initial state and reducer

Initial state is built only from the named immutable `GameSetupSnapshot`, its two side snapshots, deterministically ordered lineup slots, defensive assignments, starting pitchers, scheduled innings, and ruleset version. Replay rejects incomplete sides, duplicate players or positions, noncontiguous batting orders, cross-side player reuse, invalid pitchers, and a mismatched setup snapshot.

The pure reducer tracks:

- Account, game, setup snapshot/revision, and ruleset identity;
- lifecycle, inning/half, outs, score, and bases;
- batting-order cursors, active lineup, participation/substitution lineage, and defense;
- active pitchers and per-runner pitcher responsibility;
- source revision and sequence.

It has no database, clock, random, locale, display, authorization, projection, or process-global dependency. Inputs are cloned before changes. Runner effects resolve simultaneously from pre-play occupancy, so client array order cannot make an otherwise identical play legal or illegal. The reducer validates unique runners/origins/destinations, occupied origins, freed destinations, forward movement, out order, run-counting judgments, batter outcome, active batter/pitcher, substitution reentry, defense uniqueness, inherited runners, and lifecycle.

Third outs immediately advance the half inning and clear bases. Scheduled innings come from the setup; extra innings are not hard-coded to nine. A walk-off completion requires a bottom-half home lead at or after the scheduled inning. Ruleset-specific mercy, time-limit, and forfeit endings remain explicit accepted ending reasons.

## Evidence and deterministic replay

Canonical state serialization recursively sorts object keys, preserves array order, uses JSON, and hashes UTF-8 bytes as `sha256:v1:<lowercase hex>`. Hashes are integrity/drift evidence, not a claim that the database is cryptographically tamper-proof.

For ordinary acceptance, the pre-state is strict replay of accepted history and the post-state is the reducer result. For a correction, the pre-state is history before the new correction; the post-state is rebuilt effective history after applying its supersession graph. Strict replay verifies each event against the effective prefix that existed when that event was accepted. This lets original events retain valid historical evidence while a later correction changes current effective state.

Replay:

1. sorts by explicit sequence;
2. validates contiguous sequence/revision and Account/game/setup/ruleset identity;
3. parses every stored versioned payload;
4. resolves active corrections newest-to-oldest;
5. suppresses reversed/superseded rows without deleting them;
6. inserts typed replacement bodies at the earliest corrected target;
7. revalidates every later effective transition;
8. verifies prefix pre/post evidence in strict mode;
9. returns state plus source, setup, ruleset, reducer, correction, and verification metadata.

Missing/future/cross-game targets, non-reversal correction-to-correction, duplicate replacement IDs, ambiguous multiple active corrections, and invalid replacement replay all fail closed. Prior-only target ordering makes cycles impossible; a forward edge is rejected before it can create one. Reversing a correction reactivates the original history deterministically.

Live corrections preserve `IN_PROGRESS`. A completed correction enters `CORRECTED`. A verified game must append `GameReopened` before correction, which invalidates verification until another `GameVerified`.

## Persistence, idempotency, and concurrency

`PrismaGameEventRepository.accept` requires explicit Account, game, setup snapshot, expected revision, stable IDs, submitted recording time, typed body, and a previously validated actor context containing Account, game scope, stable identity, capability, and authorization-check time. The caller must perform real current-database authorization; the repository does not invent membership.

Capabilities are fail-closed at the boundary: scoring/lifecycle uses `game.score`, correction/reopen uses `game.correct`, and verification uses `game.verify`.

Acceptance runs at PostgreSQL `SERIALIZABLE` isolation:

1. resolve Account/game/actor-scoped idempotency and compare a canonical fingerprint of setup, expected revision, and body;
2. load the Account-scoped game and exact immutable setup;
3. load and strict-replay ordered history;
4. validate the complete event and derive authoritative evidence;
5. compare-and-swap `Game.revision`;
6. insert the play transaction, source event, and correction edges atomically.

The database supplies `acceptedAt`. Failed transactions reserve no idempotency key. Exact retries—including concurrent and post-lifecycle retries—return the previously accepted event. Changed input under the same key is rejected. Unique/serialization errors become safe domain errors; no SQL details are public.

`SourceEvent` and `PlayTransaction` both reference the exact setup snapshot. A composite foreign key also guarantees that an event and its play transaction use the same Account, game, and setup. Correction edges either point to a legacy replacement event or carry the stable ID of the typed replacement body embedded in the immutable correction event. Ordinary repository update/delete methods do not exist, and PostgreSQL triggers reject direct accepted-history mutation.

## Error contract

`GameEventError` exposes stable codes for invalid payload/type/version, setup, lifecycle, baseball state, lineup, runner movement, pitcher, stale revision, sequence, idempotency, duplicate accepted IDs, correction target/graph, Account/game mismatch, immutable-history evidence, persistence conflicts, and internal invariants. Messages are safe and structured context is limited to non-sensitive values.

## Migration and operations

`20260729170000_event_setup_reference` is a forward-only issue #10 expansion. It adds exact setup references, the event-to-transaction setup composite key, replay index, and embedded replacement-body relationship ID. Existing history is backfilled only when setup attribution is unambiguous: source events require exactly one setup matching game and ruleset; transactions inherit one consistent component setup or the sole game setup when empty. Ambiguous or missing history aborts visibly.

Issue #14 adds a separate pregame setup revision and `Game.readySetupSnapshotId`. Event acceptance now requires the command to name that exact current ready snapshot and confirms its revision, preventing an older immutable pregame revision from starting the game. This does not consume or reinterpret the source-event revision.

Deployment preflight must find games with multiple setup snapshots sharing a ruleset, events with no matching setup, and transactions whose components resolve to different setups. The migration is additive before making setup references non-null. Operational rollback is roll-forward repair; dropping constraints would re-admit nondeterministic history.

## Testing and extension boundary

Focused domain tests cover strict payload/privacy validation, setup validation, simultaneous forced movement, walks, hits, runs, errors, sacrifices, strikeouts, steals/caught stealing, inning and extra-inning transitions, walk-off, substitutions, alignment, pitching, lifecycle, identity/revision failures, evidence tampering, deterministic serialization, correction replacement/reversal, ambiguity, verification invalidation, and repeated serialized replay.

Disposable PostgreSQL tests cover clean migration, schema/catalog/representability checks, atomic acceptance/replay, exact and changed idempotency, concurrent revision writers, append-only rejection, persisted correction edges, strict corrected replay, concurrent exact retry, and failed-transaction retry.

Issue #11 consumes effective events/state to derive versioned statistics and adds only the v2 earned-run source judgment needed for exact ERA. Issue #12 adds broad representative game fixtures. UI, HTTP mapping, authentication middleware, projection workers, reports, exports, sharing, administrative repair, and uncommon ruleset extensions remain deferred.
