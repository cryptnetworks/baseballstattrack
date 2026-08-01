# Discord permissions and audit history

Discord administration uses two independent, fail-closed authority layers. The
application membership authorizes access to an Account or team. A current
Discord guild-membership observation and server-managed Discord role ID then
authorizes Discord-side actions. Neither layer replaces the other.

## Application capabilities

| Capability                   | Purpose                                      | Scope         |
| ---------------------------- | -------------------------------------------- | ------------- |
| `discord.settings.view`      | Read settings and role grants                | Account, team |
| `discord.settings.configure` | Change settings and versioned role grants    | Account, team |
| `discord.settings.preview`   | Preview delivery using non-production output | Account, team |
| `discord.settings.operate`   | Operational actions and permission audit     | Account       |

The authorization service derives these capabilities from active application
memberships and explicit grants. Account administrators receive every Discord
capability. Coach/manager authority is limited to viewing and previewing within
its authorized scope.

## Discord role grants

`DiscordGuildRole` stores an immutable Discord role ID and an opaque managed
reference for one installation. `DiscordRoleGrant` maps that identity to one or
more actions: `READ_ONLY`, `CONFIGURE`, `PREVIEW`, or `OPERATE`. Grants use an
optimistic revision and explicit active/revoked lifecycle. Role display names
are informational only and are never accepted as authorization evidence.

Permission evaluation requires all of the following:

- the application membership is active;
- the installation is active and matches the observed guild;
- guild membership was verified within five minutes;
- at least one observed raw Discord role ID maps to an enabled, active grant;
- the resulting grant includes the requested action.

Missing, future-dated, stale, mismatched, disabled, or revoked evidence denies
the action. Permission changes also require a recently verified managed role;
operators must refresh guild state instead of relying on cached names.

## HTTP error contract

The administrative routes return stable, configuration-safe codes:

- `SIGN_IN_REQUIRED` for missing authentication;
- `DISCORD_PERMISSION_REQUIRED` for insufficient application authority;
- `DISCORD_MEMBERSHIP_STALE` when Discord membership must be refreshed;
- `DISCORD_RESOURCE_UNAVAILABLE` for unavailable or cross-tenant identities;
- `DISCORD_PERMISSION_CONFLICT` for optimistic revision conflicts.

These codes let a future UI explain the recovery action without revealing raw
guild IDs, Discord role IDs, channel IDs, credentials, or whether a cross-tenant
resource exists.

## Audit history

Every successful role-grant update or revoke writes an Account-scoped security
audit record. The operator history includes actor, public server identity,
`permissions` category, summarized before/after action sets and lifecycle,
timestamp, result, action, and optional reason code. It does not include raw
Discord guild/role IDs, credential references, webhook values, or tokens.

Account archival revokes active role grants, disables managed roles, disables
Discord settings, and disconnects or revokes installations in one transaction.
Immutable audit records remain available under the repository privacy policy.
