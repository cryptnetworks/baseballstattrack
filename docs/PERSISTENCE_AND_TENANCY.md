# Persistence and tenancy

This document defines the M0 persistence, tenancy, migration, and projection contract for Baseball Stat Track. It is a decision baseline for M1 schema, replay, statistic derivation, fixtures, and authorization work. It does not add production tables, Prisma models, migrations, API routes, row-level-security policies, workers, or UI.

The primary rule is the same as the scoring contract: accepted source events and atomic play transactions are authoritative. Derived game state, box scores, player totals, team totals, and season reports are rebuildable projections.

## Tenancy Boundary

The canonical tenant is an `Account`.

An account is a neutral ownership container for one independent scorekeeping domain. It may represent a single-team family account, one coach managing several teams, a school or club program, or a future league/organization. The name intentionally avoids `League` because league administration is not an MVP requirement and many MVP users will not belong to a league.

### Options Evaluated

| Option                       | Fit                                                                                                                | Decision                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| User-owned resources         | Simple for a solo scorekeeper but weak for collaboration, ownership transfer, and multiple coaches.                | Rejected as primary boundary. A user is an actor, not the owner of team history. |
| Team-owned resources         | Fits a single team but complicates one account with multiple teams, shared staff, and future club administration.  | Rejected as primary boundary; teams are account-owned resources.                 |
| Account-owned resources      | Supports solo users, multiple teams, shared staff, ownership transfer, youth privacy, and simple M1 authorization. | Accepted.                                                                        |
| League-owned resources       | Useful later, but too specific for families, independent teams, clubs, and MVP scorekeeping.                       | Deferred as a future account type or parent account concept.                     |
| Hybrid ownership by resource | Flexible but increases risk of cross-tenant leaks and hard-to-review authorization.                                | Rejected for M1; scoped grants may narrow access inside one account.             |

### Ownership Rules

- `Account` is the tenant and primary authorization boundary.
- Users authenticate as identities, then act through account memberships or scoped grants.
- Teams, seasons, player identities, roster entries, games, source events, play transactions, corrections, projections, and audit records are account-owned.
- Team membership for players is not the same as administrative membership for users.
- A user may belong to multiple accounts.
- Cross-account references are forbidden unless a future explicit sharing feature creates a constrained share record.
- Ownership transfer is allowed by changing account owner membership, not by rewriting historical event actors.
- Teams may move between accounts only through an explicit administrative transfer workflow that audits the transfer and proves no cross-account references remain. This is not required for M1.
- Games and seasons cannot silently change accounts after creation. If a future transfer exists, the game, season, snapshots, source events, corrections, and projections move together in one reviewed operation.
- Public or shareable data is out of MVP scope. Until issue #7/#8 decide otherwise, reports remain private to authorized account/team users.
- Account deletion must not hard-delete accepted historical baseball source events until retention/privacy policy is accepted. Prefer archival, transfer, or pseudonymization.

## Authorization Model

Authentication identity and authorization membership are separate:

- Authentication identity: the Supabase-authenticated user or future identity provider subject.
- Authorization membership: database records that grant a user capabilities within an account and optional team/season/game scope.

M1 should use a small role model plus scoped grants. Roles are account-wide by default unless a grant narrows them to one team, season, or game.

| Capability                      | Owner    | Administrator | Coach/Manager       | Scorekeeper    | Viewer         |
| ------------------------------- | -------- | ------------- | ------------------- | -------------- | -------------- |
| Manage account membership       | Yes      | Yes           | No                  | No             | No             |
| Manage teams and seasons        | Yes      | Yes           | Scoped              | No             | No             |
| Manage rosters                  | Yes      | Yes           | Scoped              | No             | No             |
| Create games                    | Yes      | Yes           | Scoped              | Scoped         | No             |
| Score games                     | Yes      | Yes           | Scoped              | Scoped         | No             |
| Correct games                   | Yes      | Yes           | Scoped              | Scoped         | No             |
| Verify games                    | Yes      | Yes           | Scoped              | No by default  | No             |
| View private player information | Yes      | Yes           | Scoped              | Scoped minimum | Scoped reports |
| Publish or share reports        | Deferred | Deferred      | Deferred            | No             | No             |
| Delete or archive resources     | Yes      | Yes           | Scoped archive only | No             | No             |

Role notes:

- `Owner` is accountable for the account and may transfer ownership if another owner or administrator remains.
- `Administrator` manages account resources but is not the legal/account owner unless also owner.
- `Coach/Manager` is normally team-scoped and can manage roster/game workflows for assigned teams.
- `Scorekeeper` can create or score assigned games and propose corrections but does not manage account membership.
- `Viewer` can view approved reports or assigned private data only when explicitly granted.
- M1 authorization must check database memberships on every protected server operation. Session claims may cache hints, but they are not authoritative.

## Core Persistence Boundaries

These are conceptual records for M1 design. They are not final Prisma model names or columns.

| Record                            | Purpose                                                         | Ownership and Relationships                                                                               | Lifecycle and Mutability                                                                    | Integrity and Audit                                                                                     |
| --------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| User                              | Authenticated human or service actor.                           | Linked to identity provider subject; may have memberships in many accounts.                               | Profile fields mutable; identity subject immutable.                                         | Do not use email as foreign key. Retain actor id on historical actions after deletion/pseudonymization. |
| Account                           | Tenant boundary and ownership container.                        | Parent of teams, seasons, players, games, events, projections.                                            | Active, archived, suspended, pending deletion.                                              | Stable id; unique account slug/name only where needed; account archival audited.                        |
| Membership                        | User authorization inside an account.                           | Belongs to account and user; may include role and scoped grants.                                          | Active, invited, disabled, removed.                                                         | Unique active user-account membership; role changes audited.                                            |
| Team                              | Account-owned competitive team identity.                        | Belongs to account; participates in many seasons.                                                         | Active, archived. Names/colors mutable; history snapshotted in games.                       | Unique active display name per account when practical; archive rather than delete once used.            |
| Season                            | Account-owned period of play.                                   | Belongs to account; includes team-season participation and games.                                         | Draft, active, completed, archived.                                                         | Unique account/team season label where practical; archival audited.                                     |
| Team-season participation         | Connects a team to a season and season-specific settings.       | Belongs to account, team, and season.                                                                     | Mutable until games begin; then changes are audited.                                        | Unique team-season pair per account.                                                                    |
| Player/person identity            | Minimal account-owned person record for roster/stat continuity. | Belongs to account; may appear on roster entries across seasons/teams.                                    | Display fields mutable; sensitive fields minimized.                                         | Not the same as roster entry. Privacy deletion may pseudonymize while preserving historical snapshots.  |
| Roster entry                      | Player's eligibility and team/season role.                      | Belongs to account, player, team-season.                                                                  | Active, inactive, archived.                                                                 | Jersey number/display name may change; games snapshot accepted values.                                  |
| Game                              | Scheduled or scored contest.                                    | Belongs to account and season/team context; owns setup snapshots, play transactions, events, projections. | Draft, ready, in_progress, suspended, completed, verified, corrected, abandoned, cancelled. | Per-account stable id; lifecycle transitions append events/audit records.                               |
| Game participant/team snapshot    | Historical team/opponent/home-away information.                 | Belongs to game and account; may link back to current team record.                                        | Immutable after game starts except correction metadata.                                     | Preserves team names and home/away designation used for replay/reporting.                               |
| Lineup or batting-order snapshot  | Historical lineup, batting order, defense, pitcher setup.       | Belongs to game and account; references player/person and roster entries where available.                 | Immutable once accepted; corrections append new snapshots/events.                           | Must preserve display names, jersey numbers, positions, batting slots, pitcher responsibility.          |
| Ruleset reference                 | Versioned scoring and game-configuration contract.              | Account-visible or system-defined; recorded on game setup and events.                                     | Immutable once used by accepted events.                                                     | Historical events replay with recorded ruleset version.                                                 |
| Play transaction                  | Atomic live baseball play.                                      | Belongs to account and game; contains component source events.                                            | Append-only once accepted; corrected by supersession.                                       | Expected revision checked atomically; game revision advances once; idempotency enforced.                |
| Source event                      | Authoritative recorded fact.                                    | Belongs to account, game, and optionally play transaction.                                                | Append-only; never hard-deleted after acceptance.                                           | Per-game sequence unique; event schema/ruleset version recorded; actor/timestamp retained.              |
| Correction relationship           | Supersession, reversal, or judgment replacement.                | Belongs to account and game; references source events/play transactions/ranges.                           | Append-only.                                                                                | Valid targets required; invalidates projections from earliest affected sequence.                        |
| Projection checkpoint or revision | Tracks rebuild state and coverage.                              | Belongs to account, projection scope, game/season.                                                        | Rebuildable; may be deleted and regenerated.                                                | Records source revision/sequence, derivation version, status, error if failed.                          |
| Game-stat projection              | Current state, box score, player/team game stats.               | Belongs to account and game.                                                                              | Rebuildable and invalidated by accepted events/corrections.                                 | Never authoritative; unique by game, source revision, ruleset, derivation version.                      |
| Season-stat projection            | Player/team totals across games.                                | Belongs to account, season, team/player scope.                                                            | Rebuildable; verified reports filter verified games.                                        | Never authoritative; can be rebuilt from game projections/source events.                                |
| Migration run metadata            | Records applied schema/data migration state.                    | System-owned; may include environment, migration id, checksum, actor/tool, started/completed timestamps.  | Append-only for production; failed runs retained.                                           | Used for drift detection, failure response, and deployment audit.                                       |
| Audit record                      | Records privileged or security-relevant actions.                | Belongs to account when action is tenant-scoped; system-owned for platform events.                        | Append-only except future retention/redaction policy.                                       | Must avoid unnecessary personal data while retaining actor/action/context.                              |

## Historical Snapshots

A historical game must remain understandable and replayable after teams, players, rosters, and settings are edited later.

Snapshot when a game reaches `ready` or `GameStarted`:

- Team display names, opponent labels, and home/away designation.
- Player display names and jersey numbers used in lineups and reports.
- Active roster eligibility for each participant.
- Batting order, lineup slots, defensive assignments, and starting pitcher.
- Ruleset version and game settings such as inning count or special runner configuration.
- Scheduled metadata needed for reports: date/time, location when used, opponent, home/away, season, and team context.

Snapshots coexist with links back to canonical account/team/player/roster records. Reports may show current names where explicitly requested, but replay and audit views default to historical snapshots.

## Source Events and Atomic Plays

Persistence must preserve the issue #4 scoring contract:

- Source events are append-only and authoritative.
- A live play is accepted as one atomic play transaction.
- All component events in the play commit together or not at all.
- Component order is deterministic within the play transaction.
- The server assigns per-game source-event sequence values.
- The game revision advances exactly once per accepted play transaction.
- The expected game revision is checked in the same database transaction that inserts the play and events.
- Duplicate retries with the same account, game, actor, client submission identifier, expected revision, and payload return the prior accepted result.
- Conflicting reuse of a client submission identifier is rejected and audited.
- Pre-play and post-play state or state hashes are retained for replay-drift detection.
- Actor identity, recorded timestamp, event schema version, baseball ruleset version, and payload are retained on every source event.
- Accepted historical event rows are never rewritten to change baseball meaning.

Database-level guarantees needed by M1:

- Unique `(game_id, sequence)` for source events.
- Unique `(game_id, accepted_revision)` for accepted play transactions and lifecycle events that advance revision.
- Unique idempotency key per account/game/actor/submission scope.
- Unique component order within a play transaction.
- Foreign keys that keep play transactions, events, corrections, and projections in the same account and game.
- Ruleset references used by accepted events cannot be mutated in place.

## Correction Storage

Corrections remain append-only:

- Whole-play replacement supersedes or reverses every component event in the original play transaction.
- Individual scorer-judgment corrections preserve play state when possible and record the changed judgment, such as hit versus error, RBI eligibility, sacrifice classification, fielding credit, or earned-run context.
- Event-range supersession replaces dependent later events when a correction changes preconditions.
- Reversal without replacement marks prior events ineffective but retains them physically.
- Corrections to verified games require `GameReopened`, then `CorrectionApplied`, then a later `GameVerified` for re-verification.
- Audit displays must be able to show the original record, correction reason, actor, timestamp, replacement payload, and effective result.

Correction relationships physically retain:

- Original source events and play transactions.
- Correction event.
- Superseded/reversed target ids or ranges.
- Replacement event payloads or replacement play transactions.
- Dependency policy: complete play, event range, judgment, or reversal.
- Projection invalidation scope.

No correction design may require hard-deleting or rewriting accepted source-event rows.

## Derived Projections

Projections improve query performance and report ergonomics; they are never authoritative substitutes for source events.

Expected M1 projections:

- Current game state: inning, outs, bases, score, active batter, active pitcher, game lifecycle.
- Game box score.
- Player game statistics.
- Team game statistics.
- Season player totals.
- Season team totals.

Projection records must include:

- Account and projection scope.
- Source game revision or event sequence covered.
- Ruleset version and derivation version.
- Verification filter or report state.
- Status: `fresh`, `stale`, `rebuilding`, or `failed`.
- Error details for failed rebuilds.
- Idempotent rebuild key/checkpoint.

Projection behavior:

- Accepted events make affected projections stale.
- Accepted corrections invalidate projections from the earliest affected sequence through the game, plus season/team/player projections that include the game.
- Full rebuilds must be possible from source events.
- Incremental rebuilds are allowed only when they prove source revision continuity.
- Projection writes are idempotent by scope, source revision, ruleset version, and derivation version.
- Projection failures do not block live scoring, but they block marking a game verified when the verified report cannot be reconciled.
- Live and verified statistics may use the same projection storage with filters, but verified reports must include only verified games unless a report explicitly states otherwise.
- Projections may be deleted and regenerated.

## Database Integrity and Concurrency

Critical guarantees should be enforced as close to the database as practical.

| Guarantee                      | Primary enforcement                                                | Supporting checks                           |
| ------------------------------ | ------------------------------------------------------------------ | ------------------------------------------- |
| Tenant/account isolation       | Tenant-scoped foreign keys and account id on account-owned tables. | Server authorization and replay validation. |
| No cross-account relationships | Composite foreign keys that include account id.                    | Background reconciliation.                  |
| Unique active membership       | Database unique constraint on account/user active membership.      | Invitation workflow validation.             |
| Per-game sequence uniqueness   | Database unique constraint.                                        | Transactional sequence allocation.          |
| Per-game revision uniqueness   | Database unique constraint.                                        | Expected-revision check in transaction.     |
| Idempotency uniqueness         | Database unique constraint.                                        | Payload hash comparison in application.     |
| Play-component ordering        | Database unique constraint on play/component order.                | Replay validation.                          |
| One effective lifecycle state  | Game row current status plus append-only lifecycle events.         | Replay reconciliation detects drift.        |
| Ruleset immutability           | Immutable ruleset versions once referenced.                        | Migration review.                           |
| Valid correction references    | Database foreign keys plus same-game/account constraints.          | Replay validation.                          |
| Projection revision uniqueness | Database unique constraint by scope/source/derivation.             | Idempotent projection writer.               |

Application validation handles baseball-specific rules, role checks, payload schema validation, and user-facing error messages. Replay validation proves deterministic baseball state. Background reconciliation checks projection drift, state-hash mismatch, stale projections, and cross-tenant anomalies.

## Deletion, Archival, and Retention

Prefer archival/status transitions for historical baseball data.

| Data          | Policy                                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Users         | May be deactivated or detached. Historical actor references remain as stable ids with display name redacted when needed. |
| Memberships   | Removed/disabled memberships remain for audit; no future access.                                                         |
| Accounts      | Archive by default. Deletion requires accepted retention/privacy policy and ownership-transfer handling.                 |
| Teams         | Archive after use. Hard delete only before dependent seasons/games/events exist.                                         |
| Seasons       | Archive after use. Hard delete only before dependent games/events exist.                                                 |
| Players       | Pseudonymize or detach personal fields when privacy requires; preserve historical game snapshots and statistics.         |
| Games         | Cancel or abandon through lifecycle. Hard delete only for never-started drafts without source events.                    |
| Source events | Never hard-delete accepted events.                                                                                       |
| Projections   | May be deleted and regenerated.                                                                                          |
| Audit records | Retain according to future retention policy; do not delete while source events depend on them.                           |

Open privacy/retention decisions for issues #7 and #8:

- Legal retention period for youth-player personal data.
- Account-owner deletion when no successor owner exists.
- Public sharing and report redaction policy.
- Whether and how player identity can be pseudonymized across historical seasons while preserving team totals.

## Migration Policy

Prisma migrations live in `prisma/migrations`.

Rules:

- Use a timestamped, descriptive Prisma migration directory name, generated by `prisma migrate dev`, with one logical purpose per migration.
- Do not edit an already-applied production migration. Add a new migration to repair or advance state.
- Every migration requires review for schema changes, data movement, locking risk, rollback/roll-forward notes, and source-event/projection impact.
- Local development: configure `DATABASE_URL` and `DIRECT_URL`, run `npm run db:validate`, generate a migration with Prisma tooling, and run `npm run verify`.
- CI validates schema with `npm run db:validate` as part of `npm run verify`; future migration checks should detect drift before merge.
- Production deployment is forward-only by default: backup, deploy expand-compatible schema, deploy compatible app, backfill/rebuild, validate, then contract old schema in a later migration.
- Rollback means application rollback when safe; schema rollback is not guaranteed and must not be promised for destructive migrations.
- Data rollback requires explicit backup/restore or compensating migration plan.
- Long-running migrations must be batched, restartable, observable, and designed to avoid extended write locks.
- Backfills must record checkpoints, errors, validation counts, and cutover criteria.
- Data validation must run before and after migrations that change constraints, move data, backfill rows, or affect source-event/projection interpretation.
- Migration failure response: stop deployment, preserve logs, restore service if possible, decide roll-forward repair versus restore from backup.
- Drift resolution: compare Prisma schema, migration history, and database state; never manually patch production without recording a follow-up migration.

## Backfills and Projection Rebuilds

Backfills and rebuilds must not mutate source-event meaning.

- Event-schema evolution may add optional fields or migrate payload shape while preserving recorded baseball interpretation.
- Ruleset evolution creates new ruleset versions. Historical games continue using their recorded ruleset unless an explicit correction or approved migration says otherwise.
- Projection-schema changes create new derivation versions and rebuild checkpoints.
- Derivation-version changes require full or incremental rebuilds with validation before cutover.
- Backfill jobs must be restartable, batched, idempotent, and observable.
- Errors are recorded with affected account/game/projection scope and do not silently mark projections fresh.
- Dual-read or dual-write periods are allowed for expand-and-contract migrations when needed.
- Projection rebuilds must derive from source events and correction relationships, not from older projections alone.

## Seed and Fixture Policy

Seed and fixture data are separate:

| Type                      | Policy                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------- |
| Development seed data     | Small, idempotent, deterministic where useful, safe to rerun locally.              |
| Automated-test fixtures   | Owned by tests; deterministic ids acceptable; no production personal data.         |
| Demo data                 | Explicitly fake and isolated from production.                                      |
| Production bootstrap data | Minimal system-owned records only, such as default ruleset versions when accepted. |

Do not add a large seed dataset in issue #5. Future M1 fixtures should cover representative scoring edge cases from `docs/SCORING_SEMANTICS.md` without using real youth-player data.

## Environment and Secrets

Persistence-related environment rules:

- `DATABASE_URL` is required before opening Prisma at runtime.
- `DIRECT_URL` is required before running migrations once production-style migrations exist.
- Development, test, preview, staging, and production databases must be separate.
- Tests must never fall back to development, preview, or production databases.
- Secrets and production credentials must not be committed.
- Prefer least-privilege runtime credentials and separate migration credentials when Supabase/PostgreSQL configuration supports it.
- Preview environments use isolated databases or isolated schemas with clear teardown policy.
- Local placeholders may live in `.env.example`; real values live in ignored local/hosting secrets.

## Observability and Recovery

Future operational signals should cover:

- Migration started/completed/failed.
- Backfill checkpoint progress and failures.
- Event-acceptance conflicts and stale expected revisions.
- Idempotency conflicts.
- Projection lag, stale duration, rebuild failures.
- Cross-account access denials.
- Replay drift or state-hash mismatch.
- Database connectivity and pool exhaustion.

Recovery policy:

- Account-owned source events are the recovery priority.
- Backup ownership, recovery point objective, and recovery time objective are M4 operational decisions, but production cannot launch without them.
- Restores must be tested.
- Point-in-time recovery is expected for production PostgreSQL when available.
- After restore, source events must replay and projections must rebuild before reports are trusted.

## Threat and Failure Analysis

| Failure mode                                | Prevention                                                   | Detection                                          | Recovery                                                            |
| ------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------- | ------------------------------------------------------------------- |
| Cross-account query leakage                 | Account-scoped relationships and authorization checks.       | Audit logs, anomaly checks, access-denial metrics. | Revoke access, patch query, audit affected data.                    |
| Missing account predicate                   | Composite account foreign keys and code review.              | Tests/reconciliation for cross-account rows.       | Add constraint/query fix and backfill account ids if safe.          |
| Incorrect foreign-account relationship      | Composite foreign keys include account id.                   | Constraint violation or reconciliation.            | Reject write or repair by audited migration.                        |
| Duplicate client retry                      | Idempotency unique key and payload hash.                     | Idempotency conflict metric.                       | Return original result or reject conflicting payload.               |
| Concurrent scoring submissions              | Expected game revision checked transactionally.              | Stale-revision conflicts.                          | User retries against latest state or records correction.            |
| Partial play persistence                    | Atomic transaction for play and components.                  | Transaction failure/replay drift.                  | Roll back transaction; if detected later, mark invalid and correct. |
| Correction applied to stale revision        | Expected revision and target validation.                     | Rejected correction/conflict metric.               | Rebase correction onto latest effective state.                      |
| Projection ahead of source data             | Projection uniqueness includes covered source revision.      | Reconciliation compares projection to source.      | Mark stale and rebuild.                                             |
| Projection stale after correction           | Correction invalidates affected scope.                       | Stale status and rebuild lag metric.               | Rebuild projections from source events.                             |
| Failed migration after partial backfill     | Expand-and-contract, checkpoints, no destructive first step. | Migration/backfill status.                         | Resume backfill or roll forward repair.                             |
| Application rollback after schema expansion | Backward-compatible expand phase.                            | Deployment health checks.                          | Roll back app while keeping expanded schema.                        |
| Deleted user authored historical events     | Stable actor id and pseudonymized display.                   | Audit display validation.                          | Preserve event actor reference with redacted personal data.         |
| Player privacy deletion request             | Snapshot/pseudonymization policy.                            | Privacy workflow audit.                            | Remove personal fields, keep historical snapshots/stat continuity.  |

## Explicit Deferrals

- Production Prisma models and migrations: M1 issues #9-#12.
- Authentication and authorization implementation details: issue #7.
- Privacy threat model, youth-player retention, and public sharing policy: issue #8.
- Operational backup objectives and release hardening: M4.
- Projection worker implementation and monitoring dashboards: later M1/M4 work.
