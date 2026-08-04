# Container operations

`docker-compose.yml` is the repository's only Docker Compose manifest. It is a
production-mode deployment contract for PostgreSQL, the one-shot migration
runner, the Next.js application, the isolated Discord update scheduler, and
the read-only Discord bot.

Compose never builds application source. The `app`, `migrate`, and
`discord-bot` services are sourced only from the images named by `APP_IMAGE`,
`MIGRATION_IMAGE`, and `DISCORD_BOT_IMAGE`. This keeps a production host from
silently building a different artifact from a checkout.

## Prerequisites

- Docker Engine and Docker Compose v2
- A protected production environment file
- A TLS-terminating reverse proxy and DNS name for the application
- Production authentication-provider, Discord, and integration credentials
- A tested PostgreSQL backup and restore destination
- Host capacity that satisfies the minimum production profile and keeps the
  PostgreSQL data filesystem below the storage policy ceiling

## Image contract

The root `Dockerfile` provides two production targets:

- `runtime` contains only the Next.js standalone server and its startup and
  readiness contract.
- `migration` contains Prisma and the exact immutable migration set for
  `prisma migrate deploy`.

`services/discord-bot/Dockerfile` produces the separate non-root bot image.
The trusted image publisher builds all three from one source revision and tags
each with both the requested tag and `sha-<full source SHA>`. Production hosts
consume those images and never build from a checkout.
The publication workflow builds all three from one source revision and tags
each with both the requested tag and `sha-<full source SHA>`.

## Upstream infrastructure image monitoring

The database and optional tunnel use vendor images pinned by both meaningful
version and manifest digest. The repository security maintainer owns their
review. Dependabot checks image metadata weekly, and the monthly security audit
reports High and Critical vulnerabilities without scanning image files for
credentials or packaged test keys.

| Image             | Reviewed identity                                            | Upstream status on 2026-08-03                                                                                                                                                                                                                                                                                                                                        |
| ----------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL        | `postgres:17-bookworm@sha256:4f736a…b394` (`17.10-bookworm`) | The current tag still resolves to this digest. The [vendor Dockerfile](https://github.com/docker-library/postgres/blob/4f9ced003ba58a854656ba150d146243d27ae3ac/17/bookworm/Dockerfile) contains [gosu 1.19](https://github.com/tianon/gosu/releases/tag/1.19), built with Go 1.24.6; no newer gosu release or rebuilt PostgreSQL image uses a patched Go toolchain. |
| Cloudflare Tunnel | `cloudflare/cloudflared:2026.7.3@sha256:e39ee8…d91d`         | [`2026.7.3`](https://github.com/cloudflare/cloudflared/releases/tag/2026.7.3) and `latest` resolve to this same digest. The binary uses Go 1.26.4 and gRPC 1.81.1; the [vendor notes](https://github.com/cloudflare/cloudflared/blob/2026.7.3/RELEASE_NOTES) do not identify an image with both affected dependencies fixed.                                         |

The ephemeral CI database is also pinned to the current
`postgres:17.10-alpine3.24` manifest. It comes from the same reviewed PostgreSQL
source revision as the production image and cannot drift between workflow runs.

Trivy 0.73.0 reports one Critical and 14 High Go-standard-library findings in
`/usr/local/bin/gosu`. The same scan reports 31 High and 19 Critical Debian
advisories with no currently installable fix in the image; `--ignore-unfixed`
removes those OS findings but retains every gosu finding. Gosu runs only during
local container startup to drop from root to the `postgres` user using the
vendor entrypoint's fixed arguments. PostgreSQL has no host port and remains on
the internal database network.

The cloudflared binary has two High findings: `CVE-2026-39822` in Go 1.26.4 and
`GHSA-hrxh-6v49-42gf` in gRPC 1.81.1. The tunnel is disabled unless its Compose
profile is selected. When enabled it runs non-root with a read-only filesystem,
no Linux capabilities, no privilege escalation, and autoupdate disabled. Its
token is injected only at runtime and is not available to image scans.

These controls reduce exposure but do not mark the findings fixed. Reassess
immediately when any of the following occurs:

- the PostgreSQL or cloudflared registry tag resolves to a new digest;
- gosu is released with Go 1.24.13 or later, or cloudflared is released with Go
  1.26.5 or later and gRPC 1.82.1 or later;
- Trivy changes a finding, severity, fix version, or reachability assessment;
- the PostgreSQL entrypoint arguments or network exposure change; or
- the Cloudflare profile is enabled in a new environment or its permissions,
  token handling, command, or network boundary changes.

An upgrade uses a focused pull request: verify vendor release notes and the
multi-platform manifest, replace every matching digest and validation fixture,
run vulnerability scans with and without `--ignore-unfixed`, run
`npm run container:verify`, and preserve startup, health, migration, backup, and
credential-exposure evidence. Never rebuild or replace a vendor binary inside
the image as an unreviewed workaround.

Build the images locally without changing the Compose image-only contract:

```sh
IMAGE_TAG=local VCS_REF="$(git rev-parse HEAD)" npm run container:production:build
```

## Configure and start

Copy both scoped environment examples to a protected location and replace every
placeholder:

```sh
install -m 600 compose.production.env.example /etc/baseballstattrack/production.env
install -m 600 .env.production.example /etc/baseballstattrack/app.env
```

Set `APP_ENV_FILE=/etc/baseballstattrack/app.env` in `production.env`.

The application environment file contains only bootstrap topology and secret
material. Account behavior survives container replacement in PostgreSQL and is
managed at **Settings → Application configuration**. Restarting or replacing
the app container does not require copying operational settings back into the
environment.

Use the same immutable source tag for all three application images. The moving
`latest` tag is appropriate only for initial evaluation. `POSTGRES_PASSWORD`
contains the raw password; percent-encode reserved characters in `DATABASE_URL`
and `DIRECT_URL`.

Validate, pull, and start:

```sh
docker compose --env-file /etc/baseballstattrack/production.env config --quiet
docker compose --env-file /etc/baseballstattrack/production.env pull
docker compose --env-file /etc/baseballstattrack/production.env up --detach --wait
```

Startup is fail-closed and dependency ordered:

1. PostgreSQL must become healthy.
2. The migration image runs `prisma migrate deploy` once and must exit zero.
3. The application starts and `/api/ready` must succeed.
4. Enabled profile services start; the Discord update scheduler must complete
   an authenticated app invocation, the bot must connect to the Discord
   gateway, and Cloudflare Tunnel must connect to the configured tunnel.

A migration failure prevents both the app and bot from starting. Application
startup never applies migrations.

## Services and isolation

| Service                 | Purpose                        | Host exposure               |
| ----------------------- | ------------------------------ | --------------------------- |
| `db`                    | PostgreSQL 17                  | None                        |
| `migrate`               | One-shot Prisma migration      | None                        |
| `app`                   | Production Next.js application | `127.0.0.1:3000` by default |
| `discord-bot`           | Read-only statistics bot       | None                        |
| `discord-update-worker` | Isolated worker scheduler      | None                        |

PostgreSQL joins only the internal `database` network. The app joins that
network and an outbound network for identity-provider and webhook traffic. The
bot joins only the outbound network and calls the public HTTPS API; it cannot
reach PostgreSQL and receives no database credential.

The app, migration runner, scheduler, and bot run as non-root users with all Linux
capabilities dropped, `no-new-privileges`, read-only root filesystems, bounded
temporary filesystems, rotated local logs, and health checks where applicable.

## Health and operations

- `GET /api/health` reports application-process liveness.
- `GET /api/ready` verifies configuration, database reachability, schema, and
  the migration required by the runtime image.
- PostgreSQL uses `pg_isready`.
- The Discord bot image checks its internal `/readyz` endpoint.
- The Discord update scheduler reports ready only after a recent successful
  authenticated invocation of the application worker endpoint.
- The operator-invoked database storage check measures the PostgreSQL data
  filesystem; it is intentionally separate from application and database
  readiness.

Useful commands:

```sh
docker compose --env-file /etc/baseballstattrack/production.env ps --all
docker compose --env-file /etc/baseballstattrack/production.env logs app migrate discord-bot
curl --fail http://127.0.0.1:3000/api/ready
```

Run the read-only capacity check at least every five minutes and before a large
migration or restore. Its warning/critical exit does not stop PostgreSQL or an
authorized emergency recovery:

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

Interpretation, provider-managed boundaries, exit codes, and remediation are in
[`DATABASE_STORAGE_CAPACITY.md`](DATABASE_STORAGE_CAPACITY.md).

The application binds to loopback by default for a host reverse proxy. Change
`APP_BIND_ADDRESS` only with an intentional host firewall and TLS design.

## Upgrade, rollback, and data safety

Before an upgrade, record a current restorable backup. Change all three image
variables to one matching exact-SHA tag, pull, and run `up --detach --wait`
again. Preserve the resolved image digests and migration logs.

Applied migrations are immutable. Roll back an application image only when it
remains compatible with the expanded schema. Do not edit or reverse migration
history; ship a roll-forward repair or follow `docs/BACKUP_AND_RESTORE.md` for
disaster recovery.

An ordinary `docker compose down` retains the database volume. Never run
`docker compose down --volumes` against production. The repository's container
smoke and release rehearsal scripts use unique disposable project names and
remove only their own synthetic volumes.

The complete Discord topology and credential lifecycle are in
[`DISCORD_CONTROL_PLANE_DEPLOYMENT.md`](DISCORD_CONTROL_PLANE_DEPLOYMENT.md).

Production deployment details, GHCR package links, and the one-time public
visibility procedure are in `docs/PRODUCTION_COMPOSE.md`.
