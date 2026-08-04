# Discord control-plane deployment

This is the provider-neutral deployment contract for the M5 Discord control
plane. It covers the web settings surface, Discord OAuth installation, the
read-only Python gateway, durable update processing, and their operational
dependencies. It does not prescribe a cloud vendor or Kubernetes topology.

## Topology and trust boundaries

```text
Browser/operator ──HTTPS──> web settings + API (`app`)
                                │             │
                                │             ├── internal database network ──> PostgreSQL/Supabase
                                │             │
Discord OAuth callback ─────────┘             └── internal control-plane network <── update scheduler

Discord gateway <──TLS── Python statistics bot ──TLS──> versioned statistics API

Discord REST API <──TLS── update transport inside `app`
```

The production responsibilities are deliberately separate even where they
share an artifact:

| Responsibility                                     | Compose service/process                  | Credential and data boundary                                                                       |
| -------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Web settings and OAuth callback                    | `app` / Next.js UI routes                | Account-authorized browser session; OAuth state and client secret remain server-side               |
| Versioned statistics and internal worker API       | `app` / Next.js route handlers           | API bearer validation and the isolated scheduler token                                             |
| Discord command gateway                            | `discord-bot` / Python                   | Discord gateway token, exact-team `report.view` token, and public external IDs; no database access |
| Durable update worker trigger                      | `discord-update-worker` / Node scheduler | Only the scheduler token and internal app origin; no database or Discord token                     |
| Evaluation, claiming, and Discord update transport | `app` / worker endpoint                  | Database, statistics token, update bot token, Account-scoped settings, and durable attempts        |
| Schema migration                                   | `migrate` / one-shot Prisma runner       | Direct database URL; exits before `app` starts                                                     |
| Durable state                                      | `db` or managed Supabase Postgres        | Private database network/provider connection only                                                  |

The scheduler uses the same immutable application image as `app`, with the
entrypoint replaced by `container/discord-update-scheduler.mjs`. This avoids a
fourth artifact while preserving a distinct process, health check, identity,
restart policy, and least-privilege network. It never polls tables. It invokes
`POST /api/internal/discord-updates/run`, and the application owns claims,
leases, ordering, retries, provider calls, and safe operational events.

`control-plane` is an internal Compose network shared only by `app` and the
scheduler. The scheduler has neither the `database` nor `outbound` network.
The Python bot has only `outbound`; it receives no database URL or worker
credential. PostgreSQL has no host port.

## Configuration ownership

Use two mode-0600 files outside the checkout:

- `app.env`, based on `app.production.env.example`, is injected only into the
  application.
- `production.env`, based on `compose.production.env.example`, is read by
  Compose and supplies image coordinates, database bootstrap values, and
  narrowly scoped service credentials.

Do not put either file into an image, GitHub Actions secret for smoke tests,
issue, PR, or support attachment. Prefer a deployment secret manager and
render the files immediately before Compose starts.

### Identity, OAuth, and callback configuration

| Variable/system setting                   | Owner                            | Requirement                                                                                               |
| ----------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SITE_URL`                    | app                              | Canonical HTTPS origin; no path, query, or fragment                                                       |
| `AUTHENTICATION_ENABLED_PROVIDERS`        | app                              | Comma-separated provider-neutral adapter allowlist                                                        |
| `OAUTH_CALLBACK_URL`                      | app                              | Exact `https://<site>/auth/callback`; register directly with every enabled provider                       |
| `AUTHENTICATION_ENCRYPTION_KEY`           | app secret                       | Exact 32-byte base64url application-session root key                                                      |
| Login provider client identifiers/secrets | app + secret manager             | Use the provider-specific variables in `AUTHENTICATION_PROVIDERS.md`; never expose secrets to the browser |
| `DISCORD_OAUTH_CLIENT_ID`                 | app                              | Discord application ID                                                                                    |
| `DISCORD_OAUTH_CLIENT_SECRET`             | app secret                       | OAuth code exchange only                                                                                  |
| `DISCORD_OAUTH_STATE_SECRET`              | app secret                       | Independent random value of at least 32 characters                                                        |
| `DISCORD_OAUTH_REDIRECT_URI`              | app                              | Exact `https://<site>/api/admin/discord-installations/callback`; register the identical URL in Discord    |
| `DISCORD_INSTALLATION_BOT_TOKEN`          | app secret                       | Server-side installation verification and lifecycle operations                                            |
| Discord installation credential reference | application configuration portal | Stable non-secret reference stored with installation metadata                                             |

Provider identity establishes a user session but does not grant Account
membership. Database authorization and row-level security remain the source of
tenant access. Discord OAuth state is short-lived, signed, bound to the
initiating Account operation, and held in an HTTP-only callback cookie.

### Bot gateway and update credentials

| Variable                               | Service         | Purpose                                                                     |
| -------------------------------------- | --------------- | --------------------------------------------------------------------------- |
| `DISCORD_PROVIDER_MODE`                | bot             | Must be `gateway`; stub mode is unsupported in production                   |
| `DISCORD_TOKEN`                        | bot             | Discord gateway token                                                       |
| `BST_API_TOKEN`                        | bot             | Dedicated exact-team `report.view` identity                                 |
| `BST_API_BASE_URL`, `BST_WEB_BASE_URL` | bot             | Public HTTPS application origins                                            |
| `DISCORD_TEAM_BINDINGS`                | bot             | Guild/channel/role to external Account/team/season bindings                 |
| `DISCORD_UPDATE_EVENT_TOKEN`           | app             | Authenticates accepted game-state signals                                   |
| `DISCORD_UPDATE_WORKER_TOKEN`          | app + scheduler | Authenticates only the internal run endpoint; at least 32 random characters |
| `DISCORD_UPDATE_WORKER_ID`             | scheduler       | Stable 8–128 character lease/audit identity                                 |
| `DISCORD_STATISTICS_API_TOKEN`         | app             | Dedicated read token for current statistics snapshots                       |
| `DISCORD_UPDATE_BOT_TOKEN`             | app             | Discord REST delivery credential                                            |
| `DISCORD_INSTALLATION_BOT_TOKEN`       | app             | Installation lifecycle credential                                           |

These tokens are separate authorities even when one Discord application backs
more than one bot operation. Never reuse the OAuth state secret, event token,
worker token, API token, or a user session. Keep Discord updates disabled in
**Settings → Application configuration** until migrations, installation state,
permissions, statistics access, and provider credentials have been verified.

The scheduler interval is 15 seconds by default and is bounded to 5–300
seconds. Its request timeout is bounded to 5–60 seconds and remains below the
route's one-minute execution budget. Use one stable worker ID per deployed
replica. Database leases and `SKIP LOCKED` make overlapping invocations safe,
but the default deployment runs one scheduler to avoid unnecessary load.

## Start, health, shutdown, and logs

Use immutable `sha-<full source SHA>` tags for `APP_IMAGE`, `MIGRATION_IMAGE`,
and `DISCORD_BOT_IMAGE`, then enable `COMPOSE_PROFILES=discord-control-plane`.
Startup is dependency ordered:

1. PostgreSQL becomes healthy, or the managed Supabase database is reachable.
2. `migrate` runs the immutable Prisma migration chain once and exits zero.
3. `app` starts only after migration success and reports `/api/ready`.
4. The scheduler calls the authenticated worker endpoint successfully and then
   reports `/readyz`.
5. In gateway mode the Python bot connects and synchronizes commands before
   reporting `/readyz`.

| Component               | Liveness                    | Readiness                                            | Shutdown contract                                                          |
| ----------------------- | --------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------- |
| `db`                    | process                     | `pg_isready`                                         | 60-second grace; persistent volume retained                                |
| `migrate`               | process exit                | successful zero exit                                 | never restarted; failure blocks dependents                                 |
| `app`                   | `/api/health`               | `/api/ready` checks config, DB, and pinned migration | entrypoint forwards SIGTERM; 30-second grace                               |
| `discord-update-worker` | `/healthz` inside container | `/readyz` after a recent successful invocation       | abort active HTTP call, stop loop/listener, 60-second grace                |
| `discord-bot`           | `/healthz` inside container | gateway ready, or explicit stub ready                | close health listener, API client, and Discord connection; 30-second grace |

All services write to standard output/error. Compose rotates JSON logs at five
10 MiB files. Scheduler logs include only its stable ID, response status,
duration, and safe event name. Application delivery events use safe reason
codes and correlation IDs; bot logs use interaction IDs. Tokens, OAuth codes,
Discord bodies, channel IDs, message content, and database URLs must not be
logged.

Alert on application or scheduler readiness loss, repeated worker non-2xx
cycles, gateway disconnects, dead-letter growth, rate limits, permission loss,
statistics staleness, migration failure, and database capacity. Use the M5
Discord activity dashboard for Account-scoped diagnosis; do not inspect or
rewrite delivery tables as a first response.

## Secret rotation

Record an operator, time, credential reference, affected services, and
post-rotation evidence. Never record secret values.

1. **Internal event/worker/API tokens:** create an independent replacement,
   update every producer and consumer in a coordinated maintenance window,
   restart only affected services, prove health and one synthetic operation,
   then revoke the old value. A mismatch fails closed with 401.
2. **Discord bot token:** schedule a brief gateway/update pause because Discord
   token reset invalidates the prior value. Reset in the Developer Portal,
   update every applicable managed secret, restart the bot/app, prove gateway
   readiness, installation verification, and a sandbox delivery, then end the
   pause. Never paste the token into a manual curl command or shell history.
3. **Discord OAuth client secret:** create/reset the secret in Discord, update
   the application secret, restart the app, and complete a new installation
   callback. Existing installations remain identified by non-secret external
   IDs; failed callback state must not be replayed.
4. **OAuth state secret:** rotate during a short onboarding pause. Existing
   in-flight states become invalid by design; restart the app and begin a new
   flow after rotation.
5. **Login-provider OAuth secret:** disable the affected adapter, rotate in the
   upstream provider and application secret manager, verify the exact direct
   callback, restart the app, and complete a fresh login. Revoke affected
   application sessions when compromise is possible.
6. **Database credential:** create or select a replacement role/password,
   update both `DATABASE_URL` and `DIRECT_URL`, run readiness and migration
   status checks, restart app/migration consumers, then revoke the previous
   credential according to the provider's connection-drain procedure.

If any credential may have leaked, disable its feature or affected service,
rotate immediately, inspect safe audit/operational events, invalidate derived
sessions when applicable, and use the private security-reporting route.

## Deployment and rollback checklist

Before enabling Discord delivery:

- validate the resolved Compose configuration and immutable image revisions;
- verify direct callback URLs for every login provider and Discord installation;
- confirm bot/API/database identities have only their documented authority;
- deploy migrations before the app and preserve migration output;
- prove application, scheduler, and gateway readiness;
- run a synthetic installation, command, and update delivery in a non-production
  guild/account;
- confirm logs and the activity dashboard contain no sensitive payloads; and
- record the feature-disable, credential-revoke, image-rollback, and
  roll-forward migration owners.

Rollback begins by disabling Discord updates in the application configuration
portal and stopping the scheduler/bot profile if provider traffic must cease.
An older app image may be
restored only if it is compatible with the already-expanded schema. Applied
migrations and durable attempt evidence are never edited or reversed; ship a
forward repair. An ordinary `docker compose down` retains database data. Never
use `down --volumes` in production.
