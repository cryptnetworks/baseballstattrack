# Game setup and lineups

Issue #14 implements the editable, Account-scoped pre-scoring setup workflow. `GameSetupService` is the public application boundary, backed by strict Zod commands and serializable PostgreSQL transactions. It creates draft games, appends immutable setup revisions, validates readiness, loads the current revision, and lists bounded eligible roster candidates.

Issue #16's responsive scorekeeper workflow is documented in
[GAME_SETUP_WORKFLOW.md](GAME_SETUP_WORKFLOW.md). It is a UI and
application-query layer over this contract; it does not replace setup
persistence or make browser state authoritative.

## Draft game lifecycle

A game is created in `DRAFT` for one selected `Season` and one required managed `TeamSeason`. The season, team, and participation must share the Account and remain open and active. `Game.revision` remains the accepted source-event revision and starts at zero. Pregame editing uses the separate `Game.setupRevision`.

Saving a setup proposal inserts a new immutable `GameSetupSnapshot` and its side/lineup rows, then advances `Game.setupRevision` with compare-and-swap. Saving over a ready-but-unstarted game returns it to `DRAFT` and clears the ready pointer; the prior ready snapshot remains unchanged. Once scoring starts (`Game.revision > 0` or a live status), setup edits fail with `IMMUTABLE_SETUP`.

`markSetupReady` is the `GameSetupReady` boundary. It validates the exact current snapshot, sets `Game.readySetupSnapshotId`, and moves the game to `READY` atomically. An exact retry is idempotent. Event acceptance requires both the ready snapshot ID and setup revision to match, so an older revision cannot start the game.

## Participants

Exactly two sides are required for readiness:

- A managed side snapshots the exact Account `TeamSeason`, its stable team label, and stable roster/player lineage.
- An external side stores only bounded display, jersey, lineup, position, and pitcher snapshot values. It does not create a fake stable `Team` or `Player`.

Either or both sides may be managed, but managed participants must belong to the game season, the game's primary managed team must appear, and one team-season cannot occupy both sides. Home and away labels/identities must be distinct.

## Bounded metadata

Each revision snapshots:

- an ISO game date/time;
- a normalized location up to 120 characters;
- optional structured weather condition (`CLEAR`, `PARTLY_CLOUDY`, `CLOUDY`, `LIGHT_RAIN`, `RAIN`, `WINDY`, or `INDOOR`);
- optional integer Fahrenheit temperature from -20 through 130;
- the exact active ruleset and its scheduled innings.

Free-form notes, generic metadata, coordinates, travel details, contact data, and private player data are rejected.

## Lineup, defense, and pitchers

Managed slots must match one exact active roster period for the selected team-season and scheduled game time. The player must be active, Account-aligned, and identical to the roster row. External slots carry no Account player or roster ID.

At readiness:

- active batting orders are unique and contiguous from 1;
- one player or roster row cannot be repeated;
- a player cannot appear on both sides;
- conventional defensive positions are unique per side;
- designated/extra hitters remain batting roles rather than conventional fielding positions;
- defensive-only players are allowed only when the ruleset permits them;
- inactive bench slots may be snapshotted for later legal substitution events;
- lineup size is bounded by the ruleset (and never above 30);
- each side has exactly one starting pitcher assigned to `PITCHER`.

Starting-pitcher appearances are derived from the accepted setup and later pitching-change events. Setup never stores mutable appearance totals.

## Concurrency and history

Setup writes use serializable transactions, a setup-revision compare-and-swap, immutable-row constraints, relational lineage triggers, unique lineup/position indexes, and submission hashes. These make stale editors, duplicate submissions, competing readiness attempts, readiness versus roster changes, season closure versus game creation, and start versus supersession fail closed.

A roster period referenced by a currently ready game cannot be ended or replaced until the setup is superseded or the game starts. After start, later roster/player changes remain allowed because the game reads its immutable snapshot. Replay uses the exact ready snapshot plus ordered events; substitutions, alignments, and pitching changes after start are events rather than snapshot edits.

## Authorization and errors

Every operation requires a validated actor Account, identity shape, exact capability, scope, and authorization timestamp:

- `game.create` at Account, matching Team, or matching Season scope;
- `game.setup` at exact Game scope for revisions, readiness, and roster candidates;
- `game.view` at exact Game scope for current setup reads.

Successful mutations append an Account-scoped `SecurityAuditRecord` in the same transaction. Stable error codes cover invalid input, authorization, Account mismatch, lifecycle, stale revisions, duplicate submissions, participants, lineups, pitchers, roster eligibility, incomplete setup, immutable setup, and persistence conflicts. Field issues expose bounded paths/codes without raw SQL or Prisma diagnostics.

## Migration and operations

`20260729220000_game_lineup_pitching_setup` adds structured weather, a setup revision counter, the exact ready-snapshot foreign key, setup submission evidence, readiness/state checks, and idempotency uniqueness. Existing operational games are backfilled to their highest setup revision; deployment aborts when an operational game has no attributable setup snapshot.

Preflight must identify operational games without snapshots and confirm the highest revision is the intended ready setup. The migration is forward-only. A bad attribution requires a reviewed repair migration; dropping the ready foreign key or rewriting accepted snapshots is not a safe rollback.

The application/container readiness pin advances to this migration. CI validates a clean migration chain, catalog objects, representability, schema drift, the inherited event/statistic/scoring suites, PostgreSQL setup and concurrency tests, production build, and container restart/reset behavior.

## Correction boundary

After `GameStarted`, a lineup, participant, pitcher, or setup mistake cannot be repaired by editing the snapshot. Legal operational changes are accepted events. A historical scoring/setup mistake that requires replacement or reversal crosses into issue #15's authorized correction, audit, replay, and report-version workflow.
