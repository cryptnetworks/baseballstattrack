# Production Docker Compose deployment

`docker-compose.yml` is the repository's only Compose manifest. It runs the
production application, its one-shot migration runner, PostgreSQL 17, and
optional Discord bot and Cloudflare Tunnel services. It pulls three matching
application images from public GHCR packages:

- `ghcr.io/cryptnetworks/baseballstattrack`
- `ghcr.io/cryptnetworks/baseballstattrack-migration`
- `ghcr.io/cryptnetworks/baseballstattrack-discord-bot`

The app and migration packages come from separate targets in the root
`Dockerfile`. The bot is built from `services/discord-bot/Dockerfile`. A single
source revision produces all three, and every publication receives both the
requested tag and `sha-<full source SHA>`.

## Host prerequisites

- A current Docker Engine and Docker Compose v2
- A DNS name with either a Cloudflare Tunnel or another TLS-terminating reverse
  proxy for the application
- A production Supabase project and OAuth configuration
- A dedicated Discord application and least-privilege API identity
- A protected host directory for the deployment environment file
- A tested PostgreSQL backup and restore destination
- CPU, memory, SSD, and network capacity from the production profile in the
  README, with the PostgreSQL filesystem kept below 75% usage

The application binds to `127.0.0.1:3000` by default so an existing host proxy
can forward HTTPS traffic without exposing Next.js or PostgreSQL directly. The
optional tunnel reaches the app over the Compose network and does not require a
host port.

## Configure

Copy the Compose and application examples outside the repository, restrict
their permissions, and replace every placeholder:

```sh
install -m 600 compose.production.env.example /etc/baseballstattrack/production.env
install -m 600 app.production.env.example /etc/baseballstattrack/app.env
```

Set `APP_ENV_FILE=/etc/baseballstattrack/app.env` in `production.env`. Compose
injects that file only into the application container; the bot and tunnel do
not receive SMTP, Supabase, webhook, or application worker credentials.

`POSTGRES_PASSWORD` contains the raw database password. If it contains URL
reserved characters, percent-encode them in `DATABASE_URL` and `DIRECT_URL`.
Both database URLs must select the same `db` service, database, and user.

`DISCORD_TOKEN` and `BST_API_TOKEN` are secrets. `BST_API_TOKEN` belongs to a
dedicated identity with only the exact-team `report.view` grant. The bot's API
and web URLs must be the public HTTPS application origin; the bot never joins
the database network or reads database credentials.

`FEATURE_ICS_CALENDAR_ENABLED` enables the pull-only calendar feed.
`ICS_FEED_SIGNING_KEY` signs its subscription URLs and must be at least 32
random characters. `ICS_FEED_DETAIL_LEVEL` is `private`, `opponent`, or `full`.

Email and Discord notifications are independently controlled by
`FEATURE_EMAIL_NOTIFICATIONS_ENABLED` and
`FEATURE_DISCORD_NOTIFICATIONS_ENABLED`. Email uses only `SMTP_HOST`,
`SMTP_PORT`, `SMTP_SECURE`, `SMTP_USERNAME`, `SMTP_PASSWORD`, and `SMTP_FROM`.
Disabled channels do not require their provider credentials.

Optional containers use Compose profiles. Set `COMPOSE_PROFILES=discord-bot`
for only the bot, `COMPOSE_PROFILES=cloudflare-tunnel` for only the tunnel, or a
comma-separated list for both. With no profiles, only PostgreSQL, migration,
and the application run.

For the tunnel, create a remotely managed tunnel in Cloudflare, configure its
public hostname service as `http://app:3000`, and copy its token to
`CLOUDFLARE_TUNNEL_TOKEN`. No Cloudflare credentials are placed in the app.

For reproducible deployments, set `APP_IMAGE`, `MIGRATION_IMAGE`, and
`DISCORD_BOT_IMAGE` to the same `sha-<full source SHA>` tag after initial
publication. The moving `latest` tag is provided for convenience, but it is not
an immutable release reference. Compose never builds from the checkout; each
application service is sourced only from its configured image.

## Deploy

Pull and start the complete dependency-ordered stack:

```sh
docker compose \
  --env-file /etc/baseballstattrack/production.env \
  pull

docker compose \
  --env-file /etc/baseballstattrack/production.env \
  up --detach --wait
```

Compose waits for PostgreSQL, runs `prisma migrate deploy` once, waits for that
container to exit successfully, starts the app, waits for `/api/ready`, and
then starts whichever optional profiles are enabled. A migration failure
prevents the application and dependent services from starting. Application
startup never applies migrations itself.

Confirm the deployed services and safe health endpoints:

```sh
docker compose \
  --env-file /etc/baseballstattrack/production.env \
  ps

curl --fail http://127.0.0.1:3000/api/ready
```

Confirm the active database volume is below the warning threshold:

```sh
docker compose \
  --env-file /etc/baseballstattrack/production.env \
  exec --no-TTY \
  -e DB_STORAGE_PATH=/var/lib/postgresql/data \
  -e DB_STORAGE_VOLUME_NAME=postgres-production-data \
  -e DB_STORAGE_WARNING_PERCENT=70 \
  -e DB_STORAGE_CRITICAL_PERCENT=75 \
  db bash -s < scripts/check-database-storage.sh
```

Schedule this check through host monitoring at least every five minutes. Usage
below 70% is healthy, 70–75% is warning, and above 75% is critical. The check
only detects and alerts; it never deletes data or changes database availability.
See [`DATABASE_STORAGE_CAPACITY.md`](DATABASE_STORAGE_CAPACITY.md) for managed
database measurement, safe overrides, exit codes, and operator actions.

The bot readiness endpoint exists only inside its container network. Its image
health check reports Discord gateway readiness through Compose.

## Upgrade and rollback

1. Record a current, restorable database backup.
2. Change all three application image variables to the same exact-SHA tag.
3. Pull and run `up --detach --wait` again.
4. Preserve migration and service logs and record the resolved image digests.

The database volume is never deleted by an ordinary `down`. Do not use
`docker compose down --volumes` for production. Application rollback means
restoring the prior app and bot image tag only when it remains compatible with
already-applied migrations. Applied migrations are never reversed or edited;
follow `docs/BACKUP_AND_RESTORE.md` for recovery and ship a roll-forward repair
when schema compatibility is uncertain.

## Build and publish

Build all three local production images from one revision:

```sh
IMAGE_TAG=local VCS_REF="$(git rev-parse HEAD)" npm run container:production:build
```

The manually dispatched `Publish production containers` workflow performs the
same build on `main`, logs in with its short-lived `GITHUB_TOKEN`, pushes the
requested and exact-SHA tags, and retains each package's configured visibility.
It does not receive application, Discord, Supabase, or database secrets.

GitHub creates a new personal-account package as private and requires its owner
to make the irreversible private-to-public change in the package settings UI;
the Packages REST API does not expose that visibility operation. After the
one-time change, later workflow publications remain public. Use **Package
settings → Danger Zone → Change visibility → Public** for each package:

- [Application package settings](https://github.com/users/cryptnetworks/packages/container/baseballstattrack/settings)
- [Migration package settings](https://github.com/users/cryptnetworks/packages/container/baseballstattrack-migration/settings)
- [Discord bot package settings](https://github.com/users/cryptnetworks/packages/container/baseballstattrack-discord-bot/settings)
