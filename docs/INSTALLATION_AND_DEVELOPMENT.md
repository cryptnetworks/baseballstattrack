# Installation and development

This page is the entry point for installing Baseball Stat Track, running it
locally, understanding the repository, and contributing changes.

## Local development

### Requirements

- Node.js 24 or newer
- npm 11 or newer
- macOS, Linux, or Windows through WSL2 or Docker Desktop
- PostgreSQL 17 when exercising persistence and migrations

### Install and start

From the repository root:

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. Process health is available at
`http://localhost:3000/api/health` and configured readiness at
`http://localhost:3000/api/ready`.

The committed environment example contains placeholders only. Replace the
values required for the feature you are exercising, keep real credentials out
of Git, and configure `DATABASE_URL` and `DIRECT_URL` before running a database
migration.

```sh
npm run db:migrate
```

## Production installation

The supported production deployment uses prebuilt application, migration, and
Discord bot images with PostgreSQL 17 through Docker Compose. Copy the example
environment files to a protected location, replace every placeholder, and then
set `APP_ENV_FILE=./app.production.env` in `.env.production` before validating
and starting the stack.

```sh
cp compose.production.env.example .env.production
cp app.production.env.example app.production.env
docker compose --env-file .env.production config --quiet
docker compose --env-file .env.production pull
docker compose --env-file .env.production up --detach --wait
```

Before using this in production, follow the complete
[container operations](CONTAINER_OPERATIONS.md) and
[production Compose deployment](PRODUCTION_COMPOSE.md) guides. They define TLS,
secret handling, migrations, readiness, backups, upgrades, and rollback.

## Repository map

| Path                    | Purpose                                                                |
| ----------------------- | ---------------------------------------------------------------------- |
| `src/`                  | Next.js application, domain logic, integrations, and shared TypeScript |
| `prisma/`               | PostgreSQL schema and immutable migrations                             |
| `services/discord-bot/` | Python Discord gateway and its tests                                   |
| `tests/`                | Unit, integration, policy, and quality tests                           |
| `scripts/`              | Validation, operations, publication, and release tooling               |
| `docs/`                 | Authoritative product, engineering, and operations documentation       |

The persistence boundaries are documented in
[Persistence and tenancy](PERSISTENCE_AND_TENANCY.md) and
[Relational domain schema](RELATIONAL_DOMAIN_SCHEMA.md).

## Contributor workflow

Read the repository `CONTRIBUTING.md`, work from a focused issue and short-lived
branch, and keep scoring behavior deterministic and tested. Before opening a
pull request, run the checks appropriate to the change:

```sh
npm run format
npm run lint
npm run typecheck
npm run test
npm run verify
```

Supporting references:

- [CI quality gates](CI_QUALITY_GATES.md)
- [Repository operations checklist](REPOSITORY_OPERATIONS_CHECKLIST.md)
- [Defect triage and regression policy](DEFECT_TRIAGE_AND_REGRESSION_POLICY.md)
- [Documentation wiki publishing](DOCUMENTATION_WIKI_PUBLISHING.md)
- [Responsive performance and accessibility](RESPONSIVE_PERFORMANCE_AND_ACCESSIBILITY.md)

The full verification command includes the production build and dependency
audit. Container changes also require the container validation documented in
the operations guide.
