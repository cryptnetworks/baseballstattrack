# Relational domain schema

Issue #9 realizes the persistence structure required by the canonical scoring, tenancy, authorization, and privacy contracts. The Prisma schema and initial migration are the implementation authority for relationships and database constraints; the linked contracts remain authoritative for behavior and policy.

This is storage infrastructure, not a scoring service. Issue #10 owns event-payload validation, lifecycle transition enforcement, atomic acceptance, and replay. Issue #11 owns derived statistic values, and issue #12 owns fixtures.

## Account-scoped ownership

Every account-owned model carries `accountId`. Relationships that can otherwise cross a tenant use a composite foreign key containing that value. IDs are globally stable, but an ID alone is never a tenant or authorization check.

| Area                            | Models                                                                                   | Key invariants                                                                                                                                                                                                                        |
| ------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and access boundary    | `AppUser`, `Account`, `AccountMembership`, `MembershipRoleAssignment`, `CapabilityGrant` | Provider subject is immutable and email is absent. One membership row exists per user/account; role and capability scope references are tenant-scoped.                                                                                |
| Baseball identity               | `Team`, `Season`, `TeamSeason`, `Player`, `RosterEntry`                                  | Players are account-owned identities, separate from roster entries. A team can participate in many seasons and a player can appear on many rosters without duplicated identity data.                                                  |
| Historical game setup           | `Game`, `GameTeamSnapshot`, `GameSetupSnapshot`, `LineupSlotSnapshot`, `RulesetVersion`  | A game belongs to an account, season, and one account-owned team-season. Two side snapshots preserve the account team and external opponent. Accepted snapshots capture display names, jerseys, order, defense, and starting pitcher. |
| Append-only event storage       | `PlayTransaction`, `SourceEvent`, `EventSupersession`                                    | Event payloads are opaque JSON at this layer; stable identifiers, game sequence, actor, schema version, ruleset version, state hashes, and correction links are relationally stored.                                                  |
| Rebuild and security boundaries | `ProjectionCheckpoint`, `SecurityAuditRecord`, `PrivacyOverlay`, `PrivacyOverlayField`   | Projections are revisioned/rebuildable. Audits are separate from source events. Privacy replacements are append-only overlays, never snapshot or event edits.                                                                         |

## Lifecycle and integrity constraints

Prisma defines the normalized tables, foreign keys, enums, ordinary indexes, and composite tenant keys. The initial PostgreSQL migration adds constraints Prisma cannot model directly:

- Authorization roles and grants have exactly one valid `ACCOUNT`, `TEAM`, `SEASON`, or `GAME` scope target.
- A game side is either the account-owned team with both team references or an external opponent with neither reference.
- A projection checkpoint has exactly one scope target, and source/schema/revision values cannot be invalid.
- A privacy overlay field targets exactly one player identity or historical lineup slot.
- Active team names and active non-null jersey numbers are unique only within their relevant tenant/team-season scope; archival does not prevent a legitimate future reuse.
- Active role/capability assignments are unique at their exact scope despite PostgreSQL's normal `NULL` uniqueness behavior.
- Accepted snapshots, play transactions, source events, supersession links, audit records, and privacy overlays cannot be updated or deleted through ordinary SQL.

The database intentionally does not attempt to encode rules that need current authorization, event payload interpretation, replay state, or transactional lifecycle logic. Those rules fail closed in later application services.

## Privacy and data minimization

The schema stores only a player display name and roster jersey number. It has no date of birth, birth year, age band, player/parent contact information, or free-form player note field. Game history can still be reidentifying, so it remains account-scoped.

`PrivacyOverlay` and `PrivacyOverlayField` hold the approved replacement display value, target, reason code, actor/correlation metadata, and deterministic effective order. They do not mutate accepted records, duplicate raw event payloads, or store contact data. Applying an overlay to reports and projections is deferred to the corresponding privacy/projection implementation work.

## Migration and operational notes

`20260729000000_relational_domain_schema` is the initial production schema. It is forward-only and uses restrictive foreign keys so archival/pseudonymization cannot silently erase accepted history. The configured local PostgreSQL endpoint was unavailable while this migration was generated from the validated Prisma schema, so applying it to a clean disposable PostgreSQL database remains a deployment-time migration check.

Production work must use a reviewed deploy flow, record projection-rebuild impact, and preserve the constraints in this document. No API route, authorization middleware, event validator, replay engine, statistic projection, export, or privacy workflow is added by this issue.
