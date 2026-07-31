# Baseball Stat Track

A production-quality baseball scorekeeping and statistics platform for coaches and scorekeepers.

## Project status

The repository is in the foundation phase. The initial application shell uses Next.js App Router, React, strict TypeScript, Tailwind CSS, Prisma, Supabase boundaries, TanStack Query, Zod, Vitest, and GitHub Actions.

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

The first usable release boundary, personas, MVP workflow, non-goals, success metrics, privacy assumptions, and unresolved product decisions are documented in [docs/PRODUCT_SCOPE.md](docs/PRODUCT_SCOPE.md). Canonical scoring semantics and event vocabulary are documented in [docs/SCORING_SEMANTICS.md](docs/SCORING_SEMANTICS.md), with the implemented replay and acceptance boundary in [docs/IMMUTABLE_GAME_EVENT_MODEL.md](docs/IMMUTABLE_GAME_EVENT_MODEL.md), exact calculation contract in [docs/STATISTIC_DERIVATION.md](docs/STATISTIC_DERIVATION.md), executable representative-game coverage in [docs/SCORING_FIXTURES.md](docs/SCORING_FIXTURES.md), managed identity/roster behavior in [docs/TEAM_SEASON_ROSTER_MANAGEMENT.md](docs/TEAM_SEASON_ROSTER_MANAGEMENT.md), the immutable pre-scoring contract in [docs/GAME_SETUP_AND_LINEUPS.md](docs/GAME_SETUP_AND_LINEUPS.md), and the responsive setup experience in [docs/GAME_SETUP_WORKFLOW.md](docs/GAME_SETUP_WORKFLOW.md). Persistence, tenancy, migration, and projection rules are documented in [docs/PERSISTENCE_AND_TENANCY.md](docs/PERSISTENCE_AND_TENANCY.md), with the implemented relational mapping in [docs/RELATIONAL_DOMAIN_SCHEMA.md](docs/RELATIONAL_DOMAIN_SCHEMA.md). Authentication and authorization boundaries are documented in [docs/AUTHENTICATION_AND_AUTHORIZATION.md](docs/AUTHENTICATION_AND_AUTHORIZATION.md), with the production Supabase and database-authority implementation in [docs/PRODUCTION_AUTHENTICATION_AND_TEAM_ISOLATION.md](docs/PRODUCTION_AUTHENTICATION_AND_TEAM_ISOLATION.md) and the decision recorded in [ADR 0007](docs/decisions/0007-authentication-and-authorization-boundaries.md). The privacy/threat-model baseline is [docs/PRIVACY_AND_THREAT_MODEL.md](docs/PRIVACY_AND_THREAT_MODEL.md), with [ADR 0008](docs/decisions/0008-privacy-and-threat-model.md).

## Planned delivery targets

1. Foundation — product decisions, architecture, repository governance, and local development.
2. Domain and data — teams, players, seasons, games, lineups, scoring events, and stat derivation.
3. Scorekeeping MVP — fast game entry, substitutions, corrections, save/replay, and box score.
4. Season experience — dashboards, player/team summaries, exports, and printable reports.
5. Operational readiness — authentication, authorization, observability, backups, performance, and release hardening.

See docs/ROADMAP.md, CONTRIBUTING.md, and SECURITY.md.

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

Copy `.env.example` to `.env.local` before connecting Supabase or running migrations. The example contains local placeholders only and no secrets.

For authentication, configure the matching Supabase project URL and
publishable anonymous key, set the canonical site URL, enable the selected
OAuth provider in Supabase, and allow `<site-url>/auth/callback` as a redirect
URL. Provider access proves identity only; an active database membership is
still required for every Account operation.

For a Docker-only production-compatible path, build the images, start PostgreSQL, run migrations explicitly, and start the app:

```sh
docker compose build app migrate
docker compose up -d --wait db
docker compose run --rm migrate
docker compose up -d --wait app
```

Container architecture, development usage, readiness, migration, reset, security, and troubleshooting are defined in [docs/CONTAINER_OPERATIONS.md](docs/CONTAINER_OPERATIONS.md).

The deployable production stack, including PostgreSQL and the Discord bot, is
defined in `compose.production.yaml` and documented in
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
- Production build: `npm run build`
- Container configuration: `npm run container:config`
- Production Compose configuration: `npm run container:production:config`
- Production image build: `npm run container:production:build`
- Container build and smoke test: `npm run container:verify`
- Full verification: `npm run verify`

The canonical local/CI quality contract, required `verify` branch-protection check, and failure triage guidance are in [docs/CI_QUALITY_GATES.md](docs/CI_QUALITY_GATES.md).

Defect reporting, severity and priority, regression evidence, verification, and closure follow [docs/DEFECT_TRIAGE_AND_REGRESSION_POLICY.md](docs/DEFECT_TRIAGE_AND_REGRESSION_POLICY.md). Suspected vulnerabilities must use the private route in [SECURITY.md](SECURITY.md), never an issue.

## Working agreement

- Keep issues small enough to review and deliver independently.
- Treat game events as the source of truth; derive aggregates from them.
- Validate baseball scoring rules in domain-level tests.
- Prefer accessibility, touch-friendly interactions, and offline-tolerant workflows.
- Never commit secrets or production data.

## Repository governance

The intended taxonomy, milestone plan, project-board layout, and security baseline are documented in .github/label-taxonomy.md and .github/branch-protection.md.
