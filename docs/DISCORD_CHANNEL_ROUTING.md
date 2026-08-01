# Discord channel routing

Issue #112 adds tenant-scoped channel discovery and routing administration to
the Discord settings shell. The control plane remains server-side: browsers
receive opaque destination UUIDs and display names, never Discord guild or
channel IDs, credential references, or bot tokens.

## Discovery and permission evidence

An exact-Account administrator with `discord.settings.configure` can refresh
the selected installation. The server resolves the managed credential, asks
Discord for text and announcement channels, and calculates the bot member's
effective `View Channel` and `Send Messages` permissions from the everyone
role, aggregated role overwrites, and the member overwrite.

Every discovered destination stores `canView`, `canSend`, and
`lastVerifiedAt` separately from the administrator-controlled `enabled` flag.
The UI lists only channels with both permissions and reports aggregate missing
View/Send counts without exposing inaccessible channel identity. A channel
that disappears from discovery is marked inaccessible. Routes to inaccessible
or administratively disabled destinations are removed atomically; settings are
disabled if no routable destination remains.

Cached discovery is explicit in the UI. Administrators can refresh evidence at
any time, and saving routes performs another live refresh so a stale permission
snapshot cannot authorize a new route.

## Route categories and enablement

Each category is independently disabled or mapped to one enabled, accessible
destination:

- live updates;
- final scores;
- corrections;
- summaries;
- errors; and
- digests.

The migration maps legacy `REPORTS` routes to `SUMMARIES` and `OPERATIONS`
routes to `ERRORS`; it enables no new category implicitly. Route saves use the
existing complete-document settings write and optimistic revision. Changes
therefore become visible to configuration consumers without a bot restart and
conflicting edits fail rather than overwrite one another.

Disabling a channel removes its routes but retains installation and destination
identity so the administrator can re-enable it after permissions are restored.
Re-enabling requires current View and Send evidence.

## Test delivery and audit

An exact-Account administrator with `discord.settings.preview` can send one
fixed, non-sensitive test message to an enabled, accessible destination. The
administrator selects compact, standard, or detailed format. Test content is
headed `TEST ONLY — SYNTHETIC — NOT A LIVE UPDATE` and contains no game,
player, tenant, or user data; Discord mentions are disabled. Test sends are
never automatically retried. The dedicated
[configuration preview](DISCORD_CONFIGURATION_PREVIEW.md) further restricts
its selector to saved routes.

Refresh, enablement, route-save, and test-delivery outcomes create secret-free
audit records. Metadata contains only operation categories, formats, counts,
and success/failure classification. It excludes raw Discord IDs, opaque
destination references, credentials, and message content.

## Failure and rollout behavior

Provider authorization, rate limits, missing permissions, stale revisions, and
cross-tenant identifiers fail closed. Unavailable resources use
non-enumerating feedback. Existing routes continue to use cached validated
configuration when Discord discovery is temporarily unavailable; new route
writes do not. Rollback after production data exists is a forward repair and
must not reverse `20260801040000_discord_channel_routing`.
