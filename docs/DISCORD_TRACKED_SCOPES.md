# Discord tracked teams, seasons, and games

Issue #120 adds the Teams workspace to the Discord control plane. An exact
Account administrator selects active Account-owned team-season participation;
the browser receives public team/season UUIDs and display labels, never
internal database identifiers or data from another Account.

## Selection and pause behavior

The selected version-1 `trackedScopes` list is the active tracking set. Saving
uses the existing complete-document settings write and optimistic revision.
Clearing one checkbox pauses that team-season without deleting the Discord
installation, channel routes, cadence, triggers, message format, or quiet
hours. Clearing every scope also disables delivery because enabled settings
require at least one scope; reconnecting the bot is not required.

Only non-archived team-season, team, and season records may be newly selected.
An existing selection that later becomes archived is displayed as stale and
cannot generate new delivery. The next save removes that stale selection while
preserving all historical baseball data.

## Game lifecycle display policy

- Upcoming `DRAFT` and `READY` games are followed from the next configured
  event. Saving a scope does not backfill messages.
- `IN_PROGRESS` and `SUSPENDED` games begin following new events after save;
  older updates are not replayed.
- `COMPLETED` and `VERIFIED` games remain eligible for configured finals,
  summaries, and digests.
- `CORRECTED` games remain visible and use correction routing while awaiting or
  after reverification.
- Archived games and team-seasons remain historical evidence and generate no
  new delivery.
- `ABANDONED` and `CANCELLED` games are incomplete terminal history and are not
  delivered as final scores.

An active team-season with no games has an explicit empty state and remains
eligible for future games.

## Authorization and failure behavior

Reads require exact Account `discord.settings.view`; saves require exact
Account `discord.settings.configure`, same-origin protection, and the shared
administration rate limit. Every submitted team/season pair is re-resolved
inside the exact Account before the settings transaction. Cross-Account,
missing, archived, duplicated, and malformed selections fail closed.

Successful changes use the existing secret-free settings audit: before/after
revision and scope counts are recorded, but team IDs, season IDs, display
names, game IDs, and content are excluded. Configuration consumers observe the
new revision without a Discord bot restart.
