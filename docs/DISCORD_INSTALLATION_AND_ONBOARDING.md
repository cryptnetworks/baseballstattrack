# Discord installation and onboarding

Issue #110 connects one Discord guild to one Baseball Stat Track Account. The
web application owns OAuth, Account authorization, lifecycle, and audit. It
does not add channel routing, tracked teams, delivery workers, or Discord
control commands from later M5 issues.

## Least-privilege authorization

The authorization request uses `identify`, `guilds`, `bot`, and
`applications.commands`. The bot receives only View Channels, Send Messages,
and Use Application Commands. Administrator and privileged gateway intents are
not requested. The callback accepts a guild only after fresh Discord API checks
confirm all of the following:

- the returned user token contains every requested scope;
- the installer owns the guild or has Manage Guild or Administrator there;
- the callback guild and fresh user guild membership match;
- the bot is currently present in that exact guild; and
- the callback reports every requested bot permission.

The OAuth code and user token are transient. Neither is stored or logged. The
bot token and OAuth secret are deployment secrets. PostgreSQL stores only an
opaque credential reference; APIs and UI never return that reference or a bot
credential.

## State and lifecycle

Starting installation requires exact-Account `discord.settings.configure`
authority and the administration rate limit. A cryptographically random OAuth
state is bound to the authenticated AppUser and Account by an HMAC-signed,
HttpOnly, SameSite=Lax callback cookie. It expires after ten minutes and is
cleared after every callback, including rejection. A different user, Account,
missing cookie, changed state, changed signature, expired state, or replay
fails closed.

A verified callback creates an active installation or idempotently reactivates
the same non-revoked Account/guild binding. The global guild uniqueness rule
prevents linking a guild to another Account. A revoked installation cannot be
reactivated through OAuth.

Disconnect requires `discord.settings.operate`. The application first asks the
bot to leave (an already-absent bot is success), then transactionally marks the
installation disconnected, disables settings, revokes active Discord grants,
and disables known guild roles. Repeated disconnects are idempotent. Revocation
reported by Discord is represented by the existing `REVOKED` lifecycle for a
later reconciliation path; revoked records remain unavailable for reconnect.

Connect, reconnect, and disconnect write a required `SecurityAuditRecord` in
the same database transaction as lifecycle changes. Audit metadata includes an
external installation UUID, status transition, and HMAC installer fingerprint,
but excludes Discord guild/user IDs, OAuth data, credentials, and tokens.

## Configuration and operations

Register the exact callback URI with Discord and configure:

- `DISCORD_OAUTH_CLIENT_ID` and `DISCORD_OAUTH_CLIENT_SECRET`;
- `DISCORD_INSTALLATION_BOT_TOKEN`;
- `DISCORD_INSTALLATION_CREDENTIAL_REFERENCE`, an opaque secret-manager path;
- `DISCORD_OAUTH_STATE_SECRET`, independent and at least 32 characters;
- `DISCORD_OAUTH_REDIRECT_URI` (or derive it from `NEXT_PUBLIC_SITE_URL`);
- optional HTTPS `DISCORD_INSTALLATION_API_BASE_URL`; and
- optional 1–30 second `DISCORD_INSTALLATION_TIMEOUT_MS`.

Configuration fails closed. HTTPS is mandatory except loopback HTTP for local
development. Rotate secrets in the manager, update the deployment, verify one
install/reconnect, and then revoke the prior secret. Never paste a bot token or
OAuth secret into source, migrations, issues, PRs, logs, or browser storage.
