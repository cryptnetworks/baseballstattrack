# Container operations

`docker-compose.yml` is the repository's only Docker Compose manifest. It is a
production-mode deployment contract for PostgreSQL, the one-shot migration
runner, the Next.js application, and the read-only Discord bot.

Compose never builds application source. The `app`, `migrate`, and
`discord-bot` services are sourced only from the images named by `APP_IMAGE`,
`MIGRATION_IMAGE`, and `DISCORD_BOT_IMAGE`. This keeps a production host from
silently building a different artifact from a checkout.

## Prerequisites

- Docker Engine and Docker Compose v2
- A protected production environment file
- A TLS-terminating reverse proxy and DNS name for the application
- Production Supabase, Discord, and provider credentials
- A tested PostgreSQL backup and restore destination

## Image contract

The root `Dockerfile` provides two production targets:

- `runtime` contains only the Next.js standalone server and its startup and
  readiness contract.
- `migration` contains Prisma and the exact immutable migration set for
  `prisma migrate deploy`.

`services/discord-bot/Dockerfile` produces the separate non-root bot image.
The publication workflow builds all three from one source revision and tags
each with both the requested tag and `sha-<full source SHA>`.

Build the images locally without changing the Compose image-only contract:

```sh
IMAGE_TAG=local VCS_REF="$(git rev-parse HEAD)" npm run container:production:build
```

## Configure and start

Copy the environment example to a protected location and replace every
placeholder:

```sh
install -m 600 compose.production.env.example /etc/baseballstattrack/production.env
```

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
4. The Discord bot starts and must connect to the Discord gateway.

A migration failure prevents both the app and bot from starting. Application
startup never applies migrations.

## Services and isolation

| Service       | Purpose                        | Host exposure               |
| ------------- | ------------------------------ | --------------------------- |
| `db`          | PostgreSQL 17                  | None                        |
| `migrate`     | One-shot Prisma migration      | None                        |
| `app`         | Production Next.js application | `127.0.0.1:3000` by default |
| `discord-bot` | Read-only statistics bot       | None                        |

PostgreSQL joins only the internal `database` network. The app joins that
network and an outbound network for identity-provider and webhook traffic. The
bot joins only the outbound network and calls the public HTTPS API; it cannot
reach PostgreSQL and receives no database credential.

The app, migration runner, and bot run as non-root users with all Linux
capabilities dropped, `no-new-privileges`, read-only root filesystems, bounded
temporary filesystems, rotated local logs, and health checks where applicable.

## Health and operations

- `GET /api/health` reports application-process liveness.
- `GET /api/ready` verifies configuration, database reachability, schema, and
  the migration required by the runtime image.
- PostgreSQL uses `pg_isready`.
- The Discord bot image checks its internal `/readyz` endpoint.

Useful commands:

```sh
docker compose --env-file /etc/baseballstattrack/production.env ps --all
docker compose --env-file /etc/baseballstattrack/production.env logs app migrate discord-bot
curl --fail http://127.0.0.1:3000/api/ready
```

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

## Verification

```sh
npm run container:config
npm run container:verify
npm run release:rehearse
```

`container:verify` builds local runtime and migration images directly, injects
them through the Compose image variables with pulling disabled, and exercises
the same production manifest against a disposable database. It checks explicit
migration completion, readiness, non-root/read-only execution, persistence,
reset behavior, graceful shutdown, and secret-safe failure paths.

Production deployment details, GHCR package links, and the one-time public
visibility procedure are in `docs/PRODUCTION_COMPOSE.md`.
