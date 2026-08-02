# Baseball Stat Track Discord bot

This is a separate, read-only Python 3.12+ service. It uses `discord.py` 2.x
application commands and the authenticated statistics API; it never connects
to PostgreSQL, Supabase tables, or score-mutation endpoints.

## Commands and boundaries

The first release provides `/team-stats`, `/player-stats`, `/leaders`, `/game`,
`/recent-games`, and `/help`. Every response is ephemeral. The configured team
binding, not a Discord option or URL, determines the Account authority used for
the API call. `/game` verifies the returned Account team before formatting it.

For each request the service requires one exact match across:

- Discord guild;
- channel allowlist;
- at least one role from the binding's role allowlist; and
- external team UUID, when supplied.

Direct messages, ambiguous bindings, missing roles, wrong channels, malformed
UUIDs, and cross-team results fail without disclosing another team. Player
responses use only the API's display name and derived statistics. The service
does not request or render contacts, birth dates, notes, memberships, provider
subjects, internal IDs, setup lineage, or source-event payloads.

## Authentication and configuration

Create a dedicated integration identity in the production identity provider,
give it an active membership, and assign only an exact-team `report.view`
grant. The bot does not call directories or request mutation, management,
private-player, export, or audit capabilities. Do not reuse an owner/operator
session. Set its bearer access token as `BST_API_TOKEN` through the deployment
secret manager. The token is sent only in the Authorization header and is
excluded from object representations and logs.

Required variables are shown in [`.env.example`](.env.example):

- `DISCORD_PROVIDER_MODE`: `gateway` for production or explicit `stub` for
  local/CI process proof;
- `DISCORD_TOKEN`: Discord bot token, stored as a secret;
- `BST_API_TOKEN`: least-privilege API bearer token, stored as a secret;
- `BST_API_BASE_URL`: HTTPS application origin;
- `BST_WEB_BASE_URL`: HTTPS origin used for box-score links; and
- `DISCORD_TEAM_BINDINGS`: JSON bindings with guild, Account, team, allowed
  channels, allowed roles, and optional default season external IDs.

`HEALTH_HOST`, `HEALTH_PORT`, and `BST_API_TIMEOUT_SECONDS` are bounded optional
settings. Plain HTTP is accepted only for loopback/container-host local
development. The process fails closed on missing, malformed, duplicate, or
unsafe configuration.

## Discord application setup

1. Create a Discord application and bot in the Developer Portal.
2. Keep the bot token in a secret manager; never commit or paste it into issue,
   PR, CI, or support logs.
3. Install with only the `bot` and `applications.commands` scopes. Grant View
   Channel, Send Messages, and Use Application Commands only in allowlisted
   channels. Administrator permission and privileged gateway intents are not
   required.
4. Add the guild/channel/role IDs and the API's external Account/team/season
   UUIDs to `DISCORD_TEAM_BINDINGS`.
5. Start the bot. Commands are synchronized only into configured guilds.

The web onboarding flow uses the same Discord application and keeps its bot
token in application deployment secrets. See
[`docs/DISCORD_INSTALLATION_AND_ONBOARDING.md`](../../docs/DISCORD_INSTALLATION_AND_ONBOARDING.md).
It never exposes that token to the browser or stores it in PostgreSQL.

## Local development

Install [uv](https://docs.astral.sh/uv/), then run:

```bash
cd services/discord-bot
uv sync --frozen --all-extras
uv run ruff check .
uv run ruff format --check .
uv run pytest
uv run baseballstattrack-discord
```

Copy `.env.example` to an ignored `.env` only for local secret injection; the
service does not load dotenv files itself. Export variables from a secret-aware
shell or container runtime.

To prove startup, health, logging, and shutdown without contacting Discord or
the statistics API, set `DISCORD_PROVIDER_MODE=stub`, leave both token
variables empty, and set `DISCORD_TEAM_BINDINGS=[]`. Stub mode is explicit and
must not be used as evidence of production provider connectivity.

## Container deployment and monitoring

```bash
docker build -t baseballstattrack-discord:local services/discord-bot
docker run --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges \
  --env-file services/discord-bot/.env baseballstattrack-discord:local
```

The image is pinned, runs as UID/GID 10001, contains no source-control secrets,
and exposes port 8080. `/healthz` reports process liveness. `/readyz` returns 200
only while the Discord gateway is ready. Alert on repeated readiness loss,
authentication failures, API 5xx responses, or sustained rate limits. Logs are
structured and contain interaction IDs, not command inputs, display names, or
tokens.

Rotate either token by creating the replacement first, updating the secret
manager, restarting one instance, checking `/readyz` and a permitted command,
then revoking the old credential. An API 401/403 is shown as an administrator
action rather than retried. Discord reconnects are automatic; API timeouts,
5xx responses, invalid contracts, and 429 responses return safe ephemeral
errors. `Retry-After` is honored in user guidance, never by an unbounded retry.

The complete service topology, callback inventory, scheduler, secret rotation,
and credential-free Compose proof are in
[`docs/DISCORD_CONTROL_PLANE_DEPLOYMENT.md`](../../docs/DISCORD_CONTROL_PLANE_DEPLOYMENT.md).

## Release scope

Discord interactions are read-only in this release. Score entry, corrections,
roster changes, account settings, announcements, AI/NL commands, and all other
writes are deferred. M5 epic #108 owns the administrator-facing Discord
control plane; this service does not implement those settings.
