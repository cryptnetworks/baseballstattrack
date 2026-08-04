# Team, season, and roster management

Issue #13 implements the application and persistence boundary for Account-owned teams, seasons, stable player identities, team-season participation, and historical roster periods. The public boundary is `TeamSeasonRosterService`; callers provide unknown input plus a previously validated actor context. There are no route handlers or synthetic authentication shortcuts in this slice.

## Identity and history

- `Team` and `Player` are stable Account-owned identities. A player is reused across seasons rather than copied.
- `TeamSeason` records one team's participation in one season.
- `RosterEntry` is a half-open membership period, `[startsAt, endsAt)`, with a period-specific jersey number and primary position.
- Ending membership or changing a jersey closes the current period. Rejoining or changing a jersey creates a new row.
- Adjacent periods are allowed; overlapping periods for the same Account, team-season, and player are rejected by PostgreSQL.
- At most one period may be `ACTIVE` for a player/team-season.
- Jersey numbers may be absent or use `0`, `00`, or `1` through `99` without leading zeroes. Different players may share a jersey number; the product has not adopted a uniqueness rule.

Accepted setup snapshots, game events, replay state, and derived statistics never read mutable current roster labels as historical truth. Player edits and later roster periods therefore leave accepted game history unchanged.

## Commands and lifecycle

All mutation commands use strict Zod objects. Unknown fields are rejected. Mutable resources carry a nonnegative `revision`, and updates require `expectedRevision`.

- Teams can be created, edited, archived, and restored. A team with active season participation cannot be archived.
- Seasons progress `DRAFT → ACTIVE → COMPLETED → ARCHIVED`; `DRAFT → ARCHIVED` is also allowed. Closed seasons cannot be edited, and active roster periods block archival.
- Team-season participation may be added once per Account/team/season and archived only after active roster and operational game dependencies end.
- Players can be created, edited, archived, and restored. Active roster membership blocks archival.
- Roster periods can start only for active players, active teams and participation, and draft or active seasons. They can be ended as inactive or archived.
- A jersey change atomically ends the prior period and inserts its replacement.

Database conflicts, cross-Account foreign keys, exclusion violations, and serialization failures are translated into stable management errors. Raw SQL diagnostics are not returned to callers.

## Authorization and tenancy

Every service call requires a strict `ManagementActorContext` with an Account, actor identity, one exact capability, scope, and authorization timestamp. User actors also require stable user and membership IDs; service actors must not claim them.

Capabilities are `team.view`, `team.manage`, `season.view`, `season.manage`, `roster.view`, and `roster.manage`. Account IDs must match exactly. Account, Team, and Season scopes are enforced before writes; scoped reads add relational filters rather than loading the entire Account.

Creating global team, season, or player identity and changing player identity require Account scope. Team- or Season-scoped roster managers can change membership-specific jersey and position history for their exact scope. This prevents a staff member for one team from renaming a player identity shared with another team.

Successful mutations append a `SecurityAuditRecord` in the same serializable transaction. Rejected commands produce no success audit.

## Ordering and pagination

Team, season, and player directory reads use deterministic `(displayName, id)` ordering and opaque-value cursor inputs. Roster history uses `(startsAt DESC, id ASC)`. Page limits are bounded from 1 through 100.

## Privacy

The player boundary permits only display name, batting side, and throwing hand. It strictly rejects birth dates or years, age bands, contact fields, medical or behavioral data, and free-form notes. Historical display changes continue to use the existing snapshot/privacy-overlay design.

## Migration and operations

`20260729200000_team_season_roster_management` adds management revisions, player batting/throwing attributes, roster primary position and period timestamps, the `btree_gist` extension, period checks, the no-overlap exclusion constraint, and management query indexes.

Existing roster starts are backfilled from `createdAt`. Existing inactive or archived rows receive a deterministic end after their start using archived/update time. The migration does not rewrite accepted setup or event history. Preflight should check invalid status/end combinations and overlapping historical periods. Deployment is forward-only; if populated-data validation fails, stop and ship a reviewed repair migration rather than editing the applied migration or dropping history constraints.

Production release evidence applies the complete migration chain to isolated
PostgreSQL, verifies the catalog and representability proof, and exercises the
migration-aware container before deployment.

Issue #14 consumes roster periods through bounded candidate reads and snapshots exact player/roster lineage at readiness. A roster period referenced by a currently ready setup cannot end or be replaced until that setup is superseded or scoring starts.
