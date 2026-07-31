# Production Docker Compose deployment

`docker-compose.yml` is the repository's only Compose manifest. It runs the production application, its one-shot
migration runner, PostgreSQL 17, and the read-only Discord bot. It pulls three
matching images from public GHCR packages:

- `ghcr.io/cryptnetworks/baseballstattrack`
- `ghcr.io/cryptnetworks/baseballstattrack-migration`
- `ghcr.io/cryptnetworks/baseballstattrack-discord-bot`

The app and migration packages come from separate targets in the root
`Dockerfile`. The bot is built from `services/discord-bot/Dockerfile`. A single
source revision produces all three, and every publication receives both the
requested tag and `sha-<full source SHA>`.

## Host prerequisites

- A current Docker Engine and Docker Compose v2
- A DNS name and TLS-terminating reverse proxy for the application
- A production Supabase project and OAuth configuration
- A dedicated Discord application and least-privilege API identity
- A protected host directory for the deployment environment file
- A tested PostgreSQL backup and restore destination

The Compose file does not install a reverse proxy or create credentials. The
application binds to `127.0.0.1:3000` by default so an existing host proxy can
forward HTTPS traffic without exposing Next.js or PostgreSQL directly.

## Configure

Copy the example outside the repository, restrict its permissions, and replace
every placeholder:

```sh
install -m 600 compose.production.env.example /etc/baseballstattrack/production.env
```

`POSTGRES_PASSWORD` contains the raw database password. If it contains URL
reserved characters, percent-encode them in `DATABASE_URL` and `DIRECT_URL`.
Both database URLs must select the same `db` service, database, and user.

`DISCORD_TOKEN` and `BST_API_TOKEN` are secrets. `BST_API_TOKEN` belongs to a
dedicated identity with only the exact-team `report.view` grant. The bot's API
and web URLs must be the public HTTPS application origin; the bot never joins
the database network or reads database credentials.

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
then starts the Discord bot. A migration failure prevents the application and
bot from starting. Application startup never applies migrations itself.

Confirm the deployed services and safe health endpoints:

```sh
docker compose \
  --env-file /etc/baseballstattrack/production.env \
  ps

curl --fail http://127.0.0.1:3000/api/ready
```

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
