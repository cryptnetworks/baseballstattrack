# Persistence and tenancy

This document defines the M0 persistence, tenancy, migration, and projection contract for Baseball Stat Track. It is a decision baseline for M1 schema, replay, statistic derivation, fixtures, and authorization work. The detailed identity, membership, capability, session, recovery, invitation, and audit policy is canonical in [AUTHENTICATION_AND_AUTHORIZATION.md](AUTHENTICATION_AND_AUTHORIZATION.md); privacy/threat rules are in [PRIVACY_AND_THREAT_MODEL.md](PRIVACY_AND_THREAT_MODEL.md). Issue #9 implements the initial Prisma schema and migration described in [RELATIONAL_DOMAIN_SCHEMA.md](RELATIONAL_DOMAIN_SCHEMA.md); this document does not itself add API routes, row-level-security policies, workers, or UI.

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
- M1 prohibits moving teams, seasons, games, source events, play transactions, corrections, projections, snapshots, and audit records between accounts after creation.
- A future cross-account transfer or sharing feature requires a separate ADR that defines authorization, audit, privacy, export/import, historical actor handling, and tenant-scoped relational integrity for the entire object graph.
- Games, events, corrections, projections, snapshots, and audit records cannot split across accounts or inherit access through an unverified parent relationship.
- Public or shareable data is out of MVP scope. Reports remain private to authorized account/team users; public links or share tokens are not an MVP authorization mechanism. See [AUTHENTICATION_AND_AUTHORIZATION.md](AUTHENTICATION_AND_AUTHORIZATION.md).
- Account deletion must not hard-delete accepted historical baseball source events until retention/privacy policy is accepted. Prefer archival, transfer, or pseudonymization.

## Authorization Model

The complete authorization contract, including the protected-resource matrix and deterministic server algorithm, is in [AUTHENTICATION_AND_AUTHORIZATION.md](AUTHENTICATION_AND_AUTHORIZATION.md). The following persistence rules are its invariants.

Authentication identity and authorization membership are separate:

- Authentication identity: an immutable provider-plus-subject linked to the application-owned user.
- Authorization membership: database records that grant a user capabilities within an account and optional team/season/game scope.

M1 should use a small role model plus scoped grants. Permission resolution is monotonic inside one active account membership:

- An active membership is required before any scoped grant is considered.
- Invited, disabled, removed, expired, or archived memberships grant no access, even if a session token still contains older claims.
- Role assignments and scoped capability grants are separate. A role assignment may be account-wide or scoped; a scoped capability grant adds exactly one capability and never narrows or changes a role. Their exact semantics and inheritance are defined in [AUTHENTICATION_AND_AUTHORIZATION.md](AUTHENTICATION_AND_AUTHORIZATION.md).
- Multiple active roles or grants combine by union. M1 does not support explicit deny rules.
- Disabling or removing a membership invalidates all scoped grants for that user/account pair.
- The database membership and grant state is authoritative for protected server operations; session claims may be used only as cache hints.
- The last active owner cannot remove or disable their own ownership unless a replacement active owner exists.
- Administrators cannot create, remove, or transfer owner membership unless a current owner explicitly grants that capability.
- Role changes, grant changes, membership disablement, and ownership changes are auditable security events.

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

- `Owner` is accountable for the account and may transfer ownership only when another active owner remains or the transfer creates the replacement owner atomically.
- `Administrator` manages account resources but is not the legal/account owner unless also owner.
- `Coach/Manager` is normally team-scoped and can manage roster/game workflows for assigned teams. A coach may verify a game they scored only with an explicit `game.verify` capability; M1 does not require separation of duties because role labels alone cannot enforce it.
- `Scorekeeper` can create or score assigned games and propose or apply corrections for assigned in-progress/completed games. Verified games require reopen plus explicit correction capability; scorekeepers do not manage account membership.
- `Viewer` can view only the report type's documented minimum-field allowlist within an explicit scope. It has no private-player-data access unless a future ADR changes that rule.
- M1 authorization must check database memberships on every protected server operation. Session claims may cache hints, but they are not authoritative.

## Core Persistence Boundaries

These are conceptual records for the M1 design. The initial Prisma mapping is in [RELATIONAL_DOMAIN_SCHEMA.md](RELATIONAL_DOMAIN_SCHEMA.md); later issues may extend it only when they preserve these invariants.

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

`GameSetupReady` is the deterministic snapshot boundary. It creates the initial immutable setup snapshot and transitions the game to `ready`. `GameStarted` and the first accepted live play must reference the latest ready snapshot; they do not silently create a different setup record.

- Team display names, opponent labels, and home/away designation.
- Player display names and jersey numbers used in lineups and reports.
- Active roster eligibility for each participant.
- Batting order, lineup slots, defensive assignments, and starting pitcher.
- Ruleset version and game settings such as inning count or special runner configuration.
- Scheduled metadata needed for reports: date/time, location when used, opponent, home/away, season, and team context.

Pregame setup changes are allowed only while the game remains `draft` or returns to `draft`; accepting a later `GameSetupReady` supersedes the prior ready snapshot through an append-only setup/lifecycle event. After `GameStarted`, substitutions, batting-order changes, defensive changes, pitcher changes, and lineup corrections are source events and may create effective setup checkpoints, not edits to the original setup snapshot.

Snapshots coexist with links back to canonical account/team/player/roster records. Those links are optional for replay; the snapshot must contain enough minimal display and ruleset data to reproduce the historical game if current records are archived, transferred by a future export/import workflow, or pseudonymized. Accepted snapshot rows are never edited for privacy. The privacy contract requires an append-only privacy overlay that leaves replay's baseball facts unchanged while projections, reports, exports, and ordinary historical presentation resolve approved display fields through the current overlay. A restricted audit view records the privacy action without exposing replaced personal data merely to show history.

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

### Identifiers and Idempotency

Server-generated identifiers are the stable database identifiers for accounts, users, memberships, teams, seasons, players, games, play transactions, source events, corrections, projections, snapshots, and audit records. Client submission identifiers exist only to make retries safe; they are not resource ids and are not trusted for authorization.

Idempotency rules:

- Scope client submission identifiers to at least account, game, actor, and operation type.
- Store a request payload fingerprint, expected revision, actor, authorization context, resulting resource id, and accepted/rejected outcome.
- Retain idempotency records for at least as long as the accepted source event or operation they protect, unless issue #8 defines a shorter safe window for non-source operations.
- Re-check current database authorization on every retry. If the original actor no longer has access, the server may report that the request was previously accepted or rejected but must not return protected payload data.
- Reject a reused client submission identifier when the payload fingerprint, expected revision, target account/game, or operation type differs.
- Do not expose stable ids for records after access removal except through authorized audit or export workflows.

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

Corrections may form a chain of supersession records, but the effective correction graph must be acyclic and deterministic. A correction target is either the current effective event/play/range or an explicitly historical target with a stated reason. Multiple corrections to the same target are allowed only when their ordering and supersession effect are unambiguous.

Accepted corrections advance the game revision exactly once for the correction operation, even when they supersede multiple events. Lifecycle and setup corrections use the same append-only revision model as live play corrections. Dependent events that no longer replay cleanly remain physically stored but are marked superseded, invalid, or pending replacement in the effective stream; they are not deleted or silently ignored. A corrected verified game remains excluded from verified reports until it is re-verified.

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

- Account, projection type, projection scope, and source object such as game, season, team, or player.
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
- Projection uniqueness includes account, projection type, scope, source revision or sequence, ruleset version, derivation version, and report filter.
- Materialized projections may keep only the latest fresh value per projection identity plus rebuild checkpoints, or retain prior revisions for audit/debug. In either case, stale prior revisions must not be served as verified reports.
- Projection workers must write conditionally so an older rebuild cannot overwrite a newer projection. A worker that discovers a newer accepted game revision or derivation version marks its result stale or discards it.
- Projection failures do not block live scoring, but they block marking a game verified when the verified report cannot be reconciled.
- Live and verified statistics may use the same projection storage with filters, but verified reports must include only verified games unless a report explicitly states otherwise.
- Read paths may derive directly from source events when projections are stale, provided the response clearly uses the current effective source revision and does not claim a stale projection is fresh.
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

Every account-owned child relationship should prefer composite tenant-scoped foreign keys or an equivalent database-enforced design. A bare `accountId` column plus application filtering is insufficient for relationships such as roster entry to player/team-season, game to season/team participants, event to game/play transaction, correction to target events, projection to source scope, and audit record to tenant target.

## Audit Records

Baseball source events are already an audit trail for game scoring, corrections, verification, and replay. Separate audit records are still required for privileged or security-relevant actions that are not themselves baseball source events.

Separate audit records should cover:

- Membership invitation, acceptance, disablement, removal, role changes, scoped grant changes, and ownership transfer attempts.
- Team, season, roster, game, report, export, privacy, pseudonymization, archival, deletion, and recovery actions when they affect access or historical visibility.
- Game verification, reopening, correction approval, projection rebuild failures that affect verified reporting, migration repair, and production backfill/cutover actions.

Audit records must include actor, action, target type/id, account or system scope, timestamp, outcome, reason when supplied, request/correlation id, and enough before/after metadata to review the decision. They should not duplicate full source-event payloads, exported files, or unnecessary personal data. Retention and redaction rules remain issue #8, but M1 must not design audit storage that depends on mutable display names or current membership state.

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
| Projections   | May be deleted and regenerated; rebuild after privacy pseudonymization when projected display fields change.             |
| Audit records | Retain according to future retention policy; do not delete while source events depend on them.                           |

Archival hierarchy should flow from account to seasons/teams to games and derived views without changing account ownership. Grants are revocable immediately, but historical source events, snapshots, correction relationships, and audit records remain according to retention policy. Draft/test data may be hard-deleted only when it has no accepted source events and lives in a disposable environment.

Exports are snapshots outside normal application control. The app can revoke future access to generated exports and record that an export occurred, but it must not promise that already downloaded files are retracted. If privacy pseudonymization changes reportable personal fields, derived exports may need reissue or redaction notices under issue #8 policy.

Privacy/threat-model decisions are in [PRIVACY_AND_THREAT_MODEL.md](PRIVACY_AND_THREAT_MODEL.md). Retention details still deferred are:

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
- CI validates schema with `npm run db:validate` as part of `npm run verify`; future migration checks must apply the complete migration chain to a clean database and detect drift before merge.
- Production deployment must not use `prisma migrate dev` or a local development command. A reviewed deploy command such as Prisma's production migration deploy flow should run with migration credentials that are separate from least-privilege runtime credentials when supported.
- Production deployment is forward-only by default: backup, deploy expand-compatible schema, deploy compatible app, backfill/rebuild, validate, then contract old schema in a later migration after old code no longer reads or writes it.
- Rollback means application rollback when safe; schema rollback is not guaranteed and must not be promised for destructive migrations.
- Data rollback requires explicit backup/restore or compensating migration plan.
- Long-running migrations must be batched, restartable, observable, and designed to avoid extended write locks.
- Backfills must record checkpoints, errors, validation counts, and cutover criteria.
- New non-null columns, unique constraints, and foreign keys on populated tables should use expand/backfill/validate/contract ordering. Add constraints only after backfill validation proves the existing data satisfies them.
- Data validation must run before and after migrations that change constraints, move data, backfill rows, or affect source-event/projection interpretation.
- Backups reduce recovery risk but are not a migration strategy by themselves; rollback, roll-forward repair, and restore criteria must be explicit before production changes.
- Migration failure response: stop deployment, preserve logs, restore service if possible, decide roll-forward repair versus restore from backup. Failed migrations and failed backfills remain recorded rather than edited away.
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

Development seed scripts must refuse to run against production-like hosts, schemas, or environment names. Automated tests must fail closed when their dedicated test database is not configured; they must not fall back to development, preview, staging, or production. Destructive reseeding is allowed only for disposable local/test databases. Do not add a large seed dataset in issue #5. Future M1 fixtures should cover representative scoring edge cases from `docs/SCORING_SEMANTICS.md` without using real youth-player data.

## Environment and Secrets

Persistence-related environment rules:

- `DATABASE_URL` is required before opening Prisma at runtime.
- `DIRECT_URL` is required before running migrations once production-style migrations exist.
- Development, test, preview, staging, and production databases must be separate.
- Tests must never fall back to development, preview, or production databases.
- Secrets and production credentials must not be committed.
- Prefer least-privilege runtime credentials and separate migration credentials when Supabase/PostgreSQL configuration supports it.
- Preview environments use isolated databases or isolated schemas with clear teardown policy.
- Preview environments must not clone or expose production personal data unless a future privacy/security policy explicitly approves anonymized copies.
- Runtime logs, error messages, and CI output must not print database URLs, direct URLs, service-role secrets, or connection strings.
- Production database access must be auditable and limited to approved operators or automation.
- Local placeholders may live in `.env.example`; real values live in ignored local/hosting secrets. Local defaults must point only at loopback/disposable resources.

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
| Disabled membership with cached session     | Database authorization checked on each protected operation.  | Access-denial audit and session/authz mismatch.    | Revoke sessions if needed and keep membership disabled.             |
| Correction cycle or ambiguous chain         | Acyclic correction graph and target validation.              | Replay validation rejects non-determinism.         | Add repair correction or audited migration.                         |
| Old worker overwrites newer projection      | Conditional projection writes by source/derivation revision. | Projection revision reconciliation.                | Discard stale result and rebuild from current source revision.      |
| Failed migration after partial backfill     | Expand-and-contract, checkpoints, no destructive first step. | Migration/backfill status.                         | Resume backfill or roll forward repair.                             |
| Migration succeeds but backfill fails       | Separate migration and backfill checkpoints/cutover gates.   | Backfill status and validation counts.             | Keep compatibility path, resume or roll forward repair.             |
| Application rollback after schema expansion | Backward-compatible expand phase.                            | Deployment health checks.                          | Roll back app while keeping expanded schema.                        |
| Last account owner removed                  | Sole-owner guard in membership writes.                       | Audit and membership invariant check.              | Restore owner membership through audited admin recovery.            |
| Restore leaves stale projections            | Restore runbook requires replay/rebuild before reports.      | Projection/source revision reconciliation.         | Mark stale, rebuild, and block verified reports until reconciled.   |
| Deleted user authored historical events     | Stable actor id and pseudonymized display.                   | Audit display validation.                          | Preserve event actor reference with redacted personal data.         |
| Player privacy deletion request             | Snapshot/pseudonymization policy.                            | Privacy workflow audit.                            | Remove personal fields, keep historical snapshots/stat continuity.  |
| Export contains later-redacted player data  | Track exports and minimize report fields.                    | Privacy workflow/export audit.                     | Reissue/redact where possible; record limits under issue #8 policy. |

## Portable-data boundary

The implemented M3 export reads one exact Account with bounded queries, rebuilds
accepted game history and derived summaries, applies current privacy overlays,
and emits no source Account identifier. Export generation never writes
baseball data; its required security audit is a separate append-only record.

The initial import path is validation and dry run only. It performs no database
promotion, staging-table write, upsert, or source-row mutation. Existing target
logical IDs are conflicts, cross-Account ownership fields are rejected, and
every accepted game is replayed before a zero-mutation plan is returned. A
future commit path requires a new reviewed transaction/staging design and
cannot reuse validation success as authorization. See
[Data export and import validation](DATA_EXPORT_AND_IMPORT.md).

## Explicit Deferrals

- Production Prisma models and migrations: M1 issues #9-#12.
- Authentication and authorization implementation details: [AUTHENTICATION_AND_AUTHORIZATION.md](AUTHENTICATION_AND_AUTHORIZATION.md) and [ADR 0007](decisions/0007-authentication-and-authorization-boundaries.md).
- Privacy implementation, youth-player retention periods, and public-sharing implementation: follow-up work defined by [PRIVACY_AND_THREAT_MODEL.md](PRIVACY_AND_THREAT_MODEL.md).
- Operational backup objectives and release hardening: M4.
- Projection worker implementation and monitoring dashboards: later M1/M4 work.
