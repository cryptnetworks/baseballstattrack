# Relational domain schema

Issue #9 realizes the persistence structure required by the canonical scoring, tenancy, authorization, and privacy contracts. The Prisma schema and initial migration are the implementation authority for relationships and database constraints; the linked contracts remain authoritative for behavior and policy.

This is storage infrastructure, not a scoring service. Issue #10 owns event-payload validation, lifecycle transition enforcement, atomic acceptance, and replay. Issue #11 owns derived statistic values, and issue #12 owns fixtures.

## Account-scoped ownership

Every account-owned model carries `accountId`. Relationships that can otherwise cross a tenant use a composite foreign key containing that value. IDs are globally stable, but an ID alone is never a tenant or authorization check.

| Area                            | Models                                                                                                           | Key invariants                                                                                                                                                                                                                            |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and access boundary    | `AppUser`, `Account`, `AccountMembership`, `MembershipInvitation`, `MembershipRoleAssignment`, `CapabilityGrant` | Provider plus subject identifies a login. At most one membership is active per user/account, while removed history and reinvitation remain representable; authority scope references are tenant-scoped.                                   |
| Baseball identity               | `Team`, `Season`, `TeamSeason`, `Player`, `RosterEntry`                                                          | Players are account-owned identities, separate from roster entries. A team can participate in many seasons and a player can appear on many rosters without duplicated identity data.                                                      |
| Historical game setup           | `Game`, `GameTeamSnapshot`, `GameSetupSnapshot`, `LineupSlotSnapshot`, `RulesetVersion`                          | A game belongs to an account, season, and one account-owned team-season. Each accepted setup revision owns two side snapshots plus allowlisted scheduling, display, jersey, batting-order, defense, starting-pitcher, and ruleset fields. |
| Append-only event storage       | `PlayTransaction`, `SourceEvent`, `EventCorrection`                                                              | Event payload validation remains #10, but the complete envelope, parent relation, transaction state hashes, and replacement/reversal correction policies are relationally representable without rewriting accepted rows.                  |
| Rebuild and security boundaries | `ProjectionCheckpoint`, `SecurityAuditRecord`, `PrivacyOverlay`, `PrivacyOverlayField`                           | Projections are revisioned/rebuildable. Audits are separate from source events. Privacy replacements are append-only overlays, never snapshot or event edits.                                                                             |

## Lifecycle and integrity constraints

Prisma defines the normalized tables, foreign keys, enums, ordinary indexes, and composite tenant keys. The initial PostgreSQL migration adds constraints Prisma cannot model directly:

- Authorization roles and grants have exactly one valid `ACCOUNT`, `TEAM`, `SEASON`, or `GAME` scope target.
- Only one membership may be active for a user/account; removed membership history does not block a later invitation and distinct membership.
- Invitation authority, recipient, verifier, and expiry are immutable while terminal lifecycle fields may transition atomically.
- A game side is either the account-owned team with both team references or an external opponent with neither reference.
- Setup sides are versioned with their accepted setup snapshot, so a later pregame `GameSetupReady` can supersede rather than mutate an earlier snapshot.
- A projection checkpoint has exactly one scope target, and source/schema/revision values cannot be invalid.
- A privacy overlay field targets exactly one player identity or historical lineup slot.
- Active team names are unique within their Account; archival permits legitimate future reuse. Jersey numbers are intentionally not unique because real rosters can contain duplicates or unknown numbers.
- Active role/capability assignments are unique at their exact scope despite PostgreSQL's normal `NULL` uniqueness behavior.
- Accepted snapshots, play transactions, source events, correction links, audit records, and privacy overlays cannot be updated or deleted through ordinary SQL.

The database intentionally does not attempt to encode rules that need current authorization, event payload interpretation, replay state, or transactional lifecycle logic. Those rules fail closed in later application services.

## Privacy and data minimization

The schema stores only a player display name and roster jersey number. It has no date of birth, birth year, age band, player/parent contact information, or free-form player note field. The invitation delivery contact is adult access-delivery data governed by the authentication/privacy contracts and never enters baseball records. Game history can still be reidentifying, so it remains account-scoped.

`PrivacyOverlay` and `PrivacyOverlayField` hold the approved replacement display value, target, reason code, actor/correlation metadata, and deterministic effective order. They do not mutate accepted records, duplicate raw event payloads, or store contact data. Applying an overlay to reports and projections is deferred to the corresponding privacy/projection implementation work.

## Migration and operational notes

`20260729000000_relational_domain_schema` is the initial production schema. It is forward-only and uses restrictive foreign keys so archival/pseudonymization cannot silently erase accepted history. CI applies the complete migration chain to empty disposable PostgreSQL, checks migration status, and verifies the expected database-only constraints and triggers.

Rollback before production use is removal of the empty schema; after data exists, roll forward with a corrective migration rather than editing this migration or dropping authoritative history. This initial migration performs no backfill and creates no derived data, so projection rebuild impact is none.

Pitching appearances are represented by the starting-pitcher setup state and the immutable pitching-change source-event envelope; a mutable appearance table would duplicate authoritative event history. Issue #10 defines and validates those payloads, and issue #11 may derive rebuildable appearance statistics.

Production work must use a reviewed deploy flow and preserve the constraints in this document. No API route, authorization middleware, event validator, replay engine, statistic projection, export, or privacy workflow is added by this issue.
