# Baseball Stat Track

Baseball Stat Track is an event-oriented scorekeeping and statistics application
for coaches and scorekeepers. Recorded game events are the source of truth;
scores, box scores, and statistics are derived from replayable history.

## Project status

The repository includes live scoring, corrections, season reporting, fantasy
leagues, integrations, production operations, analytics governance, and an
online-first PWA shell. The application uses Next.js App Router, React, strict
TypeScript, Tailwind CSS, Prisma, provider-neutral OAuth/OIDC, Zod, Vitest, and
GitHub Actions.

## How the system is organized

Domain code under `src/domain` has no dependency on React, Next.js, Prisma, or
an identity provider. Server-side services validate Account ownership and
capabilities before calling that domain code or its persistence adapters.
Corrections append history, and replay binds to the rules and derivation
versions that were active for the original game.

Start with [Start here](docs/START_HERE.md) for a role-based documentation
index or [Production installation](docs/PRODUCTION_INSTALLATION.md) to deploy
the supported production stack.

## Documentation map

| Area                    | Primary references                                                                                                                                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product scope           | [Product scope](docs/PRODUCT_SCOPE.md)                                                                                                                                                              |
| Scoring and statistics  | [Scoring semantics](docs/SCORING_SEMANTICS.md), [immutable events](docs/IMMUTABLE_GAME_EVENT_MODEL.md), [statistic derivation](docs/STATISTIC_DERIVATION.md), [fixtures](docs/SCORING_FIXTURES.md)  |
| Teams and game setup    | [Roster management](docs/TEAM_SEASON_ROSTER_MANAGEMENT.md), [game setup and lineups](docs/GAME_SETUP_AND_LINEUPS.md), [setup workflow](docs/GAME_SETUP_WORKFLOW.md)                                 |
| Results and portability | [Season dashboards](docs/SEASON_DASHBOARD_AND_LEADERBOARDS.md), [printable reports](docs/PRINTABLE_REPORTS.md), [export and import](docs/DATA_EXPORT_AND_IMPORT.md)                                 |
| Persistence             | [Persistence and tenancy](docs/PERSISTENCE_AND_TENANCY.md), [relational schema](docs/RELATIONAL_DOMAIN_SCHEMA.md)                                                                                   |
| Identity and security   | [Authentication and authorization](docs/AUTHENTICATION_AND_AUTHORIZATION.md), [provider operations](docs/AUTHENTICATION_PROVIDERS.md), [privacy and threat model](docs/PRIVACY_AND_THREAT_MODEL.md) |
| Integrations            | [Integrations guide](docs/INTEGRATIONS_GUIDE.md), [partner API program](docs/INTEGRATIONS_AND_PARTNER_API_PROGRAM.md), [calendar synchronization](docs/CALENDAR_SYNCHRONIZATION.md)                 |
| Application experience  | [Product guides](docs/PRODUCT_GUIDES.md), [PWA experience](docs/PWA_APPLICATION_EXPERIENCE.md)                                                                                                      |
| Operations              | [Operations and security](docs/OPERATIONS_AND_SECURITY.md), [container operations](docs/CONTAINER_OPERATIONS.md), [backup and restore](docs/BACKUP_AND_RESTORE.md)                                  |

Report suspected vulnerabilities through the private process in
[SECURITY.md](SECURITY.md), never through a public issue.

## System Requirements

These are sizing baselines, not concurrency guarantees. Measure the actual
scorekeeping, report, integration, backup, and migration workload before
increasing traffic. A small production installation may colocate the
application and database, but each service still requires independent CPU,
memory, and storage headroom.

### Minimum Requirements

| Area               | Minimum supported baseline                       | Workload assumption                                                                                                                                           |
| ------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application CPU    | 2 vCPU                                           | A small production scorekeeping workload without concurrent image builds.                                                                                     |
| Application memory | 4 GiB RAM                                        | Next.js runtime and ordinary request processing. Run production builds separately when possible.                                                              |
| Database CPU       | 2 vCPU                                           | PostgreSQL 17 with a small active dataset and low concurrent scoring/report activity.                                                                         |
| Database memory    | 4 GiB RAM                                        | PostgreSQL, migrations, and modest report queries; monitor for swapping or memory pressure.                                                                   |
| Combined host      | 4 vCPU and 8 GiB RAM                             | Minimum when application and PostgreSQL are colocated; resources are additive, not alternatives.                                                              |
| Storage            | 40 GiB free SSD capacity before data and backups | Allows an initial application/container area and a database volume with maintenance headroom. Keep active database usage below 75% of its backing filesystem. |

SSD-backed storage is strongly recommended for PostgreSQL. Backup retention is
additional capacity and should use a separate failure domain; it is not part of
the active-volume allowance. Builds, image pulls, migrations, logs, temporary
files, WAL, and restore work all require free host space.

Software and client requirements:

- the database migration and backup contract targets PostgreSQL 17 and
  PostgreSQL 17-compatible tools;
- production uses `linux/amd64` containers on a 64-bit Linux host with a current
  Docker Engine and Docker Compose v2; the current publication workflow does
  not produce a multi-architecture image manifest;
- clients need a maintained version of Chrome, Edge, Firefox, or Safari with
  JavaScript, cookies, and TLS enabled on phone, tablet, or desktop; and
- production needs reliable HTTPS ingress through a TLS-terminating reverse
  proxy plus outbound HTTPS/DNS access to configured OAuth/OIDC identity,
  notification, calendar, webhook, and integration providers.

### Recommended Production Requirements

For a small production deployment, start with 2–4 vCPU and 4–8 GiB RAM for the
application, 4 vCPU and 8 GiB RAM for PostgreSQL, and at least a 100 GiB
SSD-backed database filesystem. Only 75 GiB of that example filesystem is the
maximum policy boundary; warning begins at 70 GiB. Keep backup storage separate
and sized for the retention policy and restore drills. Monitor CPU, memory,
database latency, database storage, backup storage, logs, artifacts, container
images, and network/provider failures.

For a larger deployment, separate the application and database hosts, begin
load testing around 4+ application vCPU with 8+ GiB RAM and 8+ database vCPU
with 16+ GiB RAM, then size instances, IOPS, and storage from measured peak
scorekeeping, report, worker, migration, and restore behavior. Add application
instances only through a deployment design that preserves the existing
database and worker coordination contracts. This repository does not claim a
supported PostgreSQL cluster, automatic failover, or multi-region topology.

The supported production contract is the repository's Linux Docker Compose
stack with PostgreSQL 17. Provider-managed PostgreSQL/Supabase may supply the
same application boundary, but provider compatibility, backups, disk metrics,
and recovery must be validated in that environment. See
[Database storage capacity](docs/DATABASE_STORAGE_CAPACITY.md),
[Container operations](docs/CONTAINER_OPERATIONS.md), and
[Backup and restore](docs/BACKUP_AND_RESTORE.md).

## Production deployment

The supported production deployment is the image-only `docker-compose.yml`
stack on a 64-bit Linux host. Copy the protected production environment
examples and Compose manifest from one reviewed source revision, pin all
application images to that revision's immutable source tag, validate the
configuration, pull the images, and start the dependency-ordered services:

```sh
sudo install -d -m 755 /opt/baseballstattrack
sudo install -d -m 700 /etc/baseballstattrack
sudo install -m 644 docker-compose.yml /opt/baseballstattrack/docker-compose.yml
sudo install -m 600 compose.production.env.example /etc/baseballstattrack/production.env
sudo install -m 600 app.production.env.example /etc/baseballstattrack/app.env

docker compose --file /opt/baseballstattrack/docker-compose.yml --env-file /etc/baseballstattrack/production.env config --quiet
docker compose --file /opt/baseballstattrack/docker-compose.yml --env-file /etc/baseballstattrack/production.env pull
docker compose --file /opt/baseballstattrack/docker-compose.yml --env-file /etc/baseballstattrack/production.env up --detach --wait
```

Follow [Production installation](docs/PRODUCTION_INSTALLATION.md) before using
the service. It covers secrets, TLS, authentication callbacks, migrations,
readiness, authorization checks, monitoring, backups, upgrades, and rollback.
The detailed runtime references are:

- [Production Docker Compose deployment](docs/PRODUCTION_COMPOSE.md)
- [Container operations](docs/CONTAINER_OPERATIONS.md)
- [Operations and security](docs/OPERATIONS_AND_SECURITY.md)
- [Backup and restore](docs/BACKUP_AND_RESTORE.md)
- [Discord control-plane deployment](docs/DISCORD_CONTROL_PLANE_DEPLOYMENT.md)

Repository documentation is authoritative in `docs/`; direct Wiki edits are
not authoritative. The public Wiki intentionally contains production
installation and operations, product usage, integrations, architectural design
choices, and calculation rules. Local-development, test, contribution, issue,
branch, pull-request, and project-planning procedures remain repository-only.
