# Discord settings contract

Issue #109 defines the tenant-scoped contract shared by the Discord bot and the
future web control plane. It stores no delivery work and does not change the
bot's current read-only command behavior. Installation and onboarding are
defined in
[`DISCORD_INSTALLATION_AND_ONBOARDING.md`](DISCORD_INSTALLATION_AND_ONBOARDING.md).
Permissions (#117), routing UI (#112), tracked-scope UI (#120), and schedules
(#118) extend this contract. Message strategy (#115) and workers (#119) consume
it in later issues.

The authorized web shell and its navigation/state contract are defined in
[`DISCORD_SETTINGS_WEB_UI.md`](DISCORD_SETTINGS_WEB_UI.md).
Channel discovery, permission evidence, route categories, administrative
disablement, and test-delivery behavior are defined in
[`DISCORD_CHANNEL_ROUTING.md`](DISCORD_CHANNEL_ROUTING.md).
Tracked team-season selection, pause semantics, and game-lifecycle display
behavior are defined in
[`DISCORD_TRACKED_SCOPES.md`](DISCORD_TRACKED_SCOPES.md).
Update cadence, schedule windows, pause/resume, and manual evaluation behavior
are defined in
[`DISCORD_UPDATE_CADENCE.md`](DISCORD_UPDATE_CADENCE.md).

## Ownership boundaries

`DiscordInstallation` owns the Account binding, Discord guild ID, lifecycle,
and an opaque credential reference. `DiscordChannelDestination` owns a channel
ID and managed channel reference inside that exact installation. These records
are server-managed identity; the settings API cannot create them, move them to
another Account/guild, or edit their Discord IDs. Raw credentials and bot
tokens are never stored in PostgreSQL.

`DiscordIntegrationSettings` is the user-editable record. It links to one
installation and contains schema version, optimistic revision, enablement,
cadence, triggers, message format, and quiet hours. Normalized child records
link settings to exact Account-owned `TeamSeason` rows and enabled destinations
from the same installation. Composite foreign keys reject cross-Account or
cross-server references even if application validation is bypassed.

The API returns the installation's guild ID as read-only identity and returns
only a destination's opaque reference, display label, and external UUID. It
never returns the credential reference or raw Discord channel ID.

## Defaults and validation

A connected installation with no settings row reads as revision `0` with safe
defaults:

- disabled;
- no tracked team-season scopes or destinations;
- 300-second cadence;
- game completed, verified, and corrected triggers;
- standard formatting; and
- quiet hours disabled, with a dormant 22:00–07:00 UTC window.

Cadence is bounded from 15 seconds through 24 hours. Triggers, scopes,
destinations, and destination purposes must be unique. Quiet-hour minutes are
0–1439, start and end must differ, and the time zone must be recognized by the
IANA time-zone implementation. At most 50 team-season scopes and 20 channel
destinations may be selected. Enabling fails unless the installation is active
and at least one valid team-season and same-installation destination are
selected.

Schema version `1` describes the shape. `revision` begins at 1 on the first
write and increments once per successful update or reset. A future incompatible
shape requires an explicit schema-version migration; it must not reinterpret a
version-1 row in place.

## Administration API

`GET /api/admin/discord-settings?accountId=...&installationId=...` requires
exact Account `discord.settings.view` authority. It returns installation identity and
settings with `Cache-Control: no-store` and an ETag containing the revision.

`POST /api/admin/discord-settings` is same-origin protected and accepts either:

- `action: "update"` plus the complete version-1 settings document,
  `expectedRevision`, and an optional uppercase `reasonCode`; or
- `action: "reset"`, `expectedRevision`, and an uppercase `reasonCode`.

Writes are full replacement, not partial merge. A stale revision returns 409;
missing/cross-tenant installations, scopes, or destinations return the same
non-enumerating 404 response. Reset removes all scope and destination links,
disables the integration, restores every documented default, increments the
revision, and retains the immutable installation identity.

Every successful write creates a `SecurityAuditRecord` with actor, capability,
target, action, reason when supplied, before/after revision, and a secret-free
summary of changed categories and counts. It excludes guild/channel IDs,
destination references, team/season IDs, credential references, and message
content. Issue #117 may add Discord-role context and richer review surfaces
without changing this persistence boundary.

## Failure and rollout behavior

Account archival disables settings and disconnects active installations before
the Account becomes unavailable. A disconnected or revoked installation may be
inspected or reset but cannot be enabled. Database constraints preserve
lifecycle and immutable identity; application rollback is roll-forward and
does not reverse migrations `20260731230000_discord_settings_contract`,
`20260801040000_discord_channel_routing`, or
`20260801050000_discord_update_cadence` after configuration exists.

The Python bot continues to use deployment configuration until #119 introduces
an authenticated, version-aware configuration consumer. No process should read
these PostgreSQL tables directly except the application data-access boundary.
