# Baseball Stat Track

A production-quality baseball scorekeeping and statistics platform for coaches and scorekeepers.

## Project status

The repository includes the event-oriented scoring, season reporting,
production-readiness, integrations, analytics-governance, and online-first PWA
milestones. The application uses Next.js App Router, React, strict TypeScript,
Tailwind CSS, Prisma, provider-neutral OAuth/OIDC, Zod, Vitest, and GitHub Actions.

## Product direction

The app will let a scorekeeper record a game pitch-by-pitch or play-by-play on phone, tablet, and desktop, then derive reliable batting, pitching, fielding, team, and season statistics from the recorded events.

The design should preserve the source events so a scoring correction can be audited and statistics can be recalculated without losing history.

The implemented season read-model, verified-game inclusion rules, leaderboard
minimums, and dashboard privacy/freshness behavior are documented in
[docs/SEASON_DASHBOARD_AND_LEADERBOARDS.md](docs/SEASON_DASHBOARD_AND_LEADERBOARDS.md).
Authorized game, player, team, and season print presentations are documented
in [docs/PRINTABLE_REPORTS.md](docs/PRINTABLE_REPORTS.md).
The versioned JSON export, separately authorized import dry run, allowlists,
limits, replay validation, and round-trip contract are documented in
[docs/DATA_EXPORT_AND_IMPORT.md](docs/DATA_EXPORT_AND_IMPORT.md).
The supported integration tiers, partner admission, credential lifecycle,
quotas, compatibility, deprecation, and support ownership are documented in
[docs/INTEGRATIONS_AND_PARTNER_API_PROGRAM.md](docs/INTEGRATIONS_AND_PARTNER_API_PROGRAM.md).
The pull-only ICS schedule feed and its privacy and rotation contract are
documented in
[docs/CALENDAR_SYNCHRONIZATION.md](docs/CALENDAR_SYNCHRONIZATION.md).
The installable, mobile-first, online-only application shell, safe public-asset
cache, connectivity states, and explicit offline deferral are documented in
[docs/PWA_APPLICATION_EXPERIENCE.md](docs/PWA_APPLICATION_EXPERIENCE.md).

The first usable release boundary, personas, MVP workflow, non-goals, success metrics, privacy assumptions, and unresolved product decisions are documented in [docs/PRODUCT_SCOPE.md](docs/PRODUCT_SCOPE.md). Canonical scoring semantics and event vocabulary are documented in [docs/SCORING_SEMANTICS.md](docs/SCORING_SEMANTICS.md), with the implemented replay and acceptance boundary in [docs/IMMUTABLE_GAME_EVENT_MODEL.md](docs/IMMUTABLE_GAME_EVENT_MODEL.md), exact calculation contract in [docs/STATISTIC_DERIVATION.md](docs/STATISTIC_DERIVATION.md), executable representative-game coverage in [docs/SCORING_FIXTURES.md](docs/SCORING_FIXTURES.md), managed identity/roster behavior in [docs/TEAM_SEASON_ROSTER_MANAGEMENT.md](docs/TEAM_SEASON_ROSTER_MANAGEMENT.md), the immutable pre-scoring contract in [docs/GAME_SETUP_AND_LINEUPS.md](docs/GAME_SETUP_AND_LINEUPS.md), and the responsive setup experience in [docs/GAME_SETUP_WORKFLOW.md](docs/GAME_SETUP_WORKFLOW.md). Persistence, tenancy, migration, and projection rules are documented in [docs/PERSISTENCE_AND_TENANCY.md](docs/PERSISTENCE_AND_TENANCY.md), with the implemented relational mapping in [docs/RELATIONAL_DOMAIN_SCHEMA.md](docs/RELATIONAL_DOMAIN_SCHEMA.md). Authentication and authorization boundaries are documented in [docs/AUTHENTICATION_AND_AUTHORIZATION.md](docs/AUTHENTICATION_AND_AUTHORIZATION.md), with provider setup and migration in [docs/AUTHENTICATION_PROVIDERS.md](docs/AUTHENTICATION_PROVIDERS.md), the production database-authority implementation in [docs/PRODUCTION_AUTHENTICATION_AND_TEAM_ISOLATION.md](docs/PRODUCTION_AUTHENTICATION_AND_TEAM_ISOLATION.md), and the decision recorded in [ADR 0007](docs/decisions/0007-authentication-and-authorization-boundaries.md). The privacy/threat-model baseline is [docs/PRIVACY_AND_THREAT_MODEL.md](docs/PRIVACY_AND_THREAT_MODEL.md), with [ADR 0008](docs/decisions/0008-privacy-and-threat-model.md).

## Planned delivery targets

1. Foundation — product decisions, architecture, repository governance, and local development.
2. Domain and data — teams, players, seasons, games, lineups, scoring events, and stat derivation.
3. Scorekeeping MVP — fast game entry, substitutions, corrections, save/replay, and box score.
4. Season experience — dashboards, player/team summaries, exports, and printable reports.
5. Operational readiness — authentication, authorization, observability, backups, performance, and release hardening.
6. Advanced analytics governance — explainable, reproducible insight boundaries and observation feasibility.
7. Progressive web application experience — an installable, mobile-first, online-only shell with safe static caching.

See docs/ROADMAP.md, CONTRIBUTING.md, and SECURITY.md.

## System Requirements

These are sizing baselines, not concurrency guarantees. Measure the actual
scorekeeping, report, integration, backup, and migration workload before
increasing traffic. The application and database may share a development host;
production should preserve independent CPU, memory, and storage headroom.

### Minimum Requirements

| Area               | Minimum supported baseline                       | Workload assumption                                                                                                                                           |
| ------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application CPU    | 2 vCPU                                           | Development, evaluation, or a small scorekeeping workload without concurrent builds.                                                                          |
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

- source development and builds require Node.js 24 or newer and npm 11 or newer;
- the database migration and backup contract targets PostgreSQL 17 and
  PostgreSQL 17-compatible tools;
- production uses `linux/amd64` containers on a 64-bit Linux host with a current
  Docker Engine and Docker Compose v2; the current publication workflow does
  not produce a multi-architecture image manifest;
- local development is supported on current macOS or Linux; Windows users
  should use WSL2 or Docker Desktop because repository operations use Bash;
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

## Local development

Prerequisites:

- Node.js 24 or newer
- npm 11 or newer

Install dependencies:

```sh
npm ci
```

Start the app:

```sh
npm run dev
```

Open `http://localhost:3000` for the application shell or `http://localhost:3000/status` for the smoke page. The JSON health endpoint is available at `http://localhost:3000/api/health`.

Copy `.env.example` to `.env.local` before configuring authentication or
running migrations. The example contains local placeholders only and no real
secrets.

For authentication, set the canonical site URL, application encryption key,
enabled provider adapters, and each provider's server-side client credentials.
Register `<site-url>/auth/callback` directly with each provider. Provider access
proves identity only; an active database membership is still required for every
Account operation. See
[Authentication providers](docs/AUTHENTICATION_PROVIDERS.md).

For the image-only production stack, copy the example environment file, pull
the public GHCR images, and start the dependency-ordered services:

```sh
cp compose.production.env.example .env.production
docker compose --env-file .env.production pull
docker compose --env-file .env.production up --detach --wait
```

Container architecture, development usage, readiness, migration, reset, security, and troubleshooting are defined in [docs/CONTAINER_OPERATIONS.md](docs/CONTAINER_OPERATIONS.md).

The Discord web settings, OAuth callback, Python gateway, isolated update
scheduler, secret rotation, and credential-free CI proof are defined in
[docs/DISCORD_CONTROL_PLANE_DEPLOYMENT.md](docs/DISCORD_CONTROL_PLANE_DEPLOYMENT.md).

The deployable production stack, including PostgreSQL and the Discord bot, is
the repository's only Compose manifest, `docker-compose.yml`, and is documented in
[docs/PRODUCTION_COMPOSE.md](docs/PRODUCTION_COMPOSE.md). It pulls matching
public GHCR images and keeps migrations explicit and dependency ordered.

## Commands

- Format: `npm run format`
- Lint: `npm run lint`
- Typecheck: `npm run typecheck`
- Unit tests: `npm run test`
- Prisma client generation: `npm run db:generate`
- Prisma schema validation: `npm run db:validate`
- Relational representability proof: `npm run db:representability` after applying migrations to an isolated disposable database
- Defect-policy and issue-form validation: `npm run policy:validate`
- Production dependency audit: `npm run audit:prod`
- Database migration: `npm run db:migrate` after `DATABASE_URL` and `DIRECT_URL` are configured
- Database storage health: `npm run db:storage:check` where the database filesystem is visible
- Production build: `npm run build`
- Container configuration: `npm run container:config`
- Production image build: `npm run container:production:build`
- Container build and smoke test: `npm run container:verify`
- Full verification: `npm run verify`

The canonical local/CI quality contract, required `verify` branch-protection check, and failure triage guidance are in [docs/CI_QUALITY_GATES.md](docs/CI_QUALITY_GATES.md).

Repository documentation is authoritative in `docs/`. The generated GitHub Wiki
publication pipeline, manifest, visibility policy, dry-run commands, credential
boundary, and recovery procedure are documented in
[Documentation Wiki Publishing](docs/DOCUMENTATION_WIKI_PUBLISHING.md). Direct
wiki edits are not authoritative. The public wiki's focused entry points begin
at [Start here](docs/START_HERE.md); detailed rules and formulas are indexed in
[Rules and calculations](docs/RULES_AND_CALCULATIONS.md), while setup and
contributor material is collected in
[Installation and development](docs/INSTALLATION_AND_DEVELOPMENT.md).

Defect reporting, severity and priority, regression evidence, verification, and closure follow [docs/DEFECT_TRIAGE_AND_REGRESSION_POLICY.md](docs/DEFECT_TRIAGE_AND_REGRESSION_POLICY.md). Suspected vulnerabilities must use the private route in [SECURITY.md](SECURITY.md), never an issue.

## Working agreement

- Keep issues small enough to review and deliver independently.
- Treat game events as the source of truth; derive aggregates from them.
- Validate baseball scoring rules in domain-level tests.
- Prefer accessibility, touch-friendly interactions, and explicit online-first interruption recovery.
- Never commit secrets or production data.

## Repository governance

The intended taxonomy, milestone plan, project-board layout, and security baseline are documented in .github/label-taxonomy.md and .github/branch-protection.md.
