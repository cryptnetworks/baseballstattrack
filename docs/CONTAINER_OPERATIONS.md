# Container Operations

This runbook defines the M0 container contract for local development, CI, and
production-compatible execution. It does not select a cloud, publish an image,
or configure a production environment.

## Prerequisites

- Docker Engine or Docker Desktop with Docker Compose v2
- At least 4 GB of memory available to Docker
- `curl` for the host-side smoke test

The images publish both `linux/amd64` and `linux/arm64` upstream variants, so the
workflow is compatible with common Linux CI runners and Apple Silicon. The
automated smoke test has to be run separately on each architecture; an image
build on one architecture is not evidence for the other. On macOS and Windows,
source bind mounts run through Docker Desktop and can be slower than native
Linux. The commands use POSIX shell syntax.

## Architecture

The `Dockerfile` has separate targets:

- `dependencies` installs the lockfile exactly with `npm ci` and generates the
  Prisma client.
- `development` runs the Next.js development server with the source bind mount
  supplied by Compose.
- `builder` creates Next.js standalone output.
- `migration` contains Prisma tooling and the exact migration set for an
  explicit `prisma migrate deploy` invocation.
- `runtime` contains only standalone server output, traced runtime
  dependencies, static assets, and the small startup wrapper.

The application and migration images are built from the same source revision.
Migrations are deliberately not run by the application entrypoint.

Debian bookworm slim is used instead of Alpine to retain the glibc/native
compatibility expected by Next.js, Sharp, Prisma, and PostgreSQL drivers. The
Node and PostgreSQL images use bounded version tags plus exact manifest
digests; this is reproducible but means digest updates are required to receive
base-image fixes. The shared base installs only OpenSSL and CA certificates for
Prisma, PostgreSQL TLS, and outbound HTTPS trust.

## Clean Docker-only startup

No host Node.js or npm installation is needed for this path:

```sh
docker compose build app migrate
docker compose up -d --wait db
docker compose run --rm migrate
docker compose up -d --wait app
curl --fail http://127.0.0.1:3000/api/ready
```

Open `http://127.0.0.1:3000`. Rerunning `docker compose run --rm migrate` is
safe: Prisma applies only unapplied migrations. An application restart never
runs migrations.

The defaults in `compose.yaml` are synthetic local values. Optional local
overrides can be copied and passed explicitly:

```sh
cp compose.env.example .env.container
docker compose --env-file .env.container up -d --wait db
docker compose --env-file .env.container run --rm migrate
docker compose --env-file .env.container up -d --wait app
```

`.env.container` is ignored by Git. Never put production credentials in it.

## Development target

Start the database, apply migrations, and run the bind-mounted development
server:

```sh
docker compose up -d --wait db
docker compose run --rm migrate
docker compose --profile development up app-dev
```

The development app listens on `127.0.0.1:3001` by default. Its dependencies
live in the `app-node-modules` volume so host dependencies are not required.
This target includes development tooling and is not a production artifact.

## Services, ports, networks, and volumes

| Service   | Purpose                                 | Host port        | Restart behavior |
| --------- | --------------------------------------- | ---------------- | ---------------- |
| `db`      | PostgreSQL 17                           | Not published    | `unless-stopped` |
| `migrate` | One-shot production-safe migration      | None             | Never            |
| `app`     | Production-compatible standalone server | `127.0.0.1:3000` | `unless-stopped` |
| `app-dev` | Optional development server             | `127.0.0.1:3001` | Never            |

All services communicate on the private `backend` network. PostgreSQL is not
published to the host. `postgres-data` persists local database state;
`app-node-modules` is development-only.

Change host ports through `APP_PORT` or `DEV_PORT`. The container application
port defaults to `3000`; deployments that override `PORT` are supported because
the image health check reads the same variable.

## Configuration and secrets

Required production runtime variables:

- `NODE_ENV=production`
- `NEXT_PUBLIC_APP_ENV`, one of `local`, `preview`, or `production`
- `DATABASE_URL`, a server-only PostgreSQL URL
- `REQUIRED_DATABASE_MIGRATION`, pinned by the image to the newest required
  migration
- `PORT`, default `3000`

`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` become required
only when the existing Supabase boundary is used. Anything named
`NEXT_PUBLIC_*` is browser-visible and must never contain a secret.
`NEXT_PUBLIC_APP_ENV` is currently read by server routes at runtime. If browser
code later consumes a `NEXT_PUBLIC_*` value, Next.js will inline that nonsecret
value during the build and the image contract must add an explicit build input.

`VCS_REF` is the only current build argument and is recorded as an OCI revision
label. Builds do not accept database credentials or other secrets. Compose
interpolation variables such as `POSTGRES_PASSWORD` are passed to containers at
runtime and are not image build arguments.

Local Compose interpolation is defined by `compose.env.example`:

| Variable                                            | Local purpose                                               |
| --------------------------------------------------- | ----------------------------------------------------------- |
| `APP_ENV`                                           | Supplies the runtime `NEXT_PUBLIC_APP_ENV`                  |
| `APP_PORT`, `DEV_PORT`                              | Loopback host-port overrides                                |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | Isolated local database initialization                      |
| `APP_IMAGE`, `MIGRATION_IMAGE`, `DEV_IMAGE`         | Local image names or externally supplied matching revisions |
| `VCS_REF`                                           | Nonsecret source-revision OCI label                         |

Production credentials must come from the target platform's secret manager,
not an environment file, Compose manifest, image layer, build argument, source
control, or `NEXT_PUBLIC_*` variable. The local defaults must not be reused
outside isolated development or CI.

## Health and startup order

- `GET /api/health` is liveness: the Next.js process can answer a request. It
  does not access PostgreSQL.
- `GET /api/ready` is readiness: required configuration exists, PostgreSQL is
  reachable, the authoritative `SourceEvent` table exists, the image-pinned
  migration is applied, and no migration is left unfinished.
- PostgreSQL's Compose health check uses `pg_isready`.
- The application image health check calls `/api/ready` over loopback.

Readiness returns only safe booleans and never includes connection errors or
database URLs. Before migration, the app may be live while readiness correctly
returns HTTP 503. The explicit deployment order is database, migration, then
application; `depends_on` waits for database health but does not imply or run a
migration.

## Migrations, seed, and rollback

Production-compatible migration:

```sh
docker compose run --rm migrate
```

The command exits after `prisma migrate deploy`, reports failures in its
standard logs, and is safe to rerun. The migration image must use the same
source revision as the application image. Never substitute `prisma migrate dev`
in a deployment. Never make application startup apply or repair migrations.

There is no seed command in this repository, so the container workflow does not
invent or run one. When a safe synthetic seed is introduced, it must remain an
explicit development-only action and must never contain real player or youth
data.

Applied migrations are immutable. Database changes roll forward through a new
migration. Rolling back an application image is safe only when it remains
compatible with the already-applied schema. Production backup/restore,
deployment rollback execution, and release coordination remain issue #31 work.

## Logs, shutdown, and restart

Next.js, startup validation, migration output, and fatal errors use standard
output or standard error:

```sh
docker compose logs -f app
docker compose logs migrate
```

The startup wrapper forwards `SIGINT` and `SIGTERM` to Next.js. Compose allows
15 seconds for application shutdown and 30 seconds for PostgreSQL. No logs are
written to the read-only application filesystem.

Restart without migration:

```sh
docker compose restart app
```

Database data remains in `postgres-data` across `stop`, `start`, and ordinary
`down` operations.

## Stop and destructive local reset

Stop containers while retaining local data:

```sh
docker compose down
```

The following command permanently deletes only this Compose project's local
database and dependency volumes. Confirm the Compose project and current
directory before running it:

```sh
docker compose down --volumes
```

That is a local data reset, not a migration rollback. Start the database and
rerun migrations afterward. Never aim this workflow at production.

## Verification and image inspection

Run the CI-equivalent build, failure-path checks, migration cycle, and smoke
requests:

```sh
npm run container:verify
```

This host-side harness requires Docker, Bash, `curl`, and standard POSIX command
line utilities. It verifies the
runtime user, read-only application files, writable `/tmp`, image contents,
image history, explicit migrations, health, restart behavior, persistence,
reset, unavailable-database behavior, configuration failures, occupied ports,
logs, and graceful shutdown.

Useful manual inspections:

```sh
docker image inspect baseballstattrack:local
docker history --no-trunc baseballstattrack:local
docker run --rm --entrypoint id baseballstattrack:local
docker run --rm --entrypoint node baseballstattrack:local -p 'process.versions'
```

The runtime image intentionally has no Prisma CLI, TypeScript compiler, test
runner, source tree, tests, docs, `.git`, or environment files. The separate
migration target has Prisma CLI and migrations by design.

If Docker Scout is installed and authenticated, inspect locally:

```sh
npm run container:scan
```

The production npm audit and a clean image scan assess different dependency
layers. A clean npm audit does not mean the operating-system image is
vulnerability-free. If the scanner is unavailable or unauthenticated, record
that limitation; the platform/release maintainer must review an authenticated
OS scan before promotion. Enforced scanning remains issue #31 work.

## Troubleshooting

- **Missing or invalid environment:** startup exits nonzero with the variable
  name but does not print its value.
- **Database unavailable:** liveness may remain 200 while readiness is 503.
  Check `docker compose ps`, then PostgreSQL and migration logs.
- **Absent or stale schema:** `/api/ready` reports the `schema` or `migration`
  check as false. Run the matching revision's migration image.
- **Migration failure:** do not mark the app ready or edit an applied migration.
  Preserve logs, diagnose, and create a roll-forward repair.
- **Occupied port:** set an unused loopback host port, for example
  `APP_PORT=3100 docker compose up -d app`.
- **Permission error:** production runs with a read-only root filesystem as the
  non-root `node` user. Use `/tmp` only for truly temporary writes; do not make
  application code writable.
- **Missing static asset:** rebuild both application and migration images from
  one clean revision; the builder copies `public` and `.next/static`.
- **Unhealthy app:** compare `/api/health` and `/api/ready`; inspect app,
  database, and migration logs rather than disabling the health check.

## Base-image and release policy

The Dockerfile pins Node `24.18.0-bookworm-slim` by digest. Compose pins
PostgreSQL `17-bookworm` by digest. Dependabot checks Docker references weekly.
For each proposed update, the platform owner reviews upstream release/security
notes, updates both the human-readable tag and digest, rebuilds all targets,
runs repository and container verification, reviews the image scan, and treats
Node major-version changes as architecture changes requiring explicit review.

Digest pinning provides repeatability; it also prevents an existing tag from
silently receiving fixes. Rebuilds without a reviewed digest change do not
update the base layer.

Issue #31 remains responsible for production environment approvals and secrets,
registry selection, versioned promotion, release automation, image signing,
enforced SBOM/OS scanning, cloud deployment, backup/restore execution, and
production rollback procedures. This M0 work creates a production-compatible
artifact and test contract; it does not claim those M4 controls are complete.
