# Baseball Stat Track

A production-quality baseball scorekeeping and statistics platform for coaches and scorekeepers.

## Project status

The repository is in the foundation phase. The initial application shell uses Next.js App Router, React, strict TypeScript, Tailwind CSS, Prisma, Supabase boundaries, TanStack Query, Zod, Vitest, and GitHub Actions.

## Product direction

The app will let a scorekeeper record a game pitch-by-pitch or play-by-play on phone, tablet, and desktop, then derive reliable batting, pitching, fielding, team, and season statistics from the recorded events.

The design should preserve the source events so a scoring correction can be audited and statistics can be recalculated without losing history.

The first usable release boundary, personas, MVP workflow, non-goals, success metrics, privacy assumptions, and unresolved product decisions are documented in [docs/PRODUCT_SCOPE.md](docs/PRODUCT_SCOPE.md). Canonical scoring semantics and event vocabulary are documented in [docs/SCORING_SEMANTICS.md](docs/SCORING_SEMANTICS.md). Persistence, tenancy, migration, and projection rules are documented in [docs/PERSISTENCE_AND_TENANCY.md](docs/PERSISTENCE_AND_TENANCY.md), with the implemented relational mapping in [docs/RELATIONAL_DOMAIN_SCHEMA.md](docs/RELATIONAL_DOMAIN_SCHEMA.md). Authentication and authorization boundaries are documented in [docs/AUTHENTICATION_AND_AUTHORIZATION.md](docs/AUTHENTICATION_AND_AUTHORIZATION.md), with the decision recorded in [ADR 0007](docs/decisions/0007-authentication-and-authorization-boundaries.md). The privacy/threat-model baseline is [docs/PRIVACY_AND_THREAT_MODEL.md](docs/PRIVACY_AND_THREAT_MODEL.md), with [ADR 0008](docs/decisions/0008-privacy-and-threat-model.md).

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

## Commands

- Format: `npm run format`
- Lint: `npm run lint`
- Typecheck: `npm run typecheck`
- Unit tests: `npm run test`
- Prisma client generation: `npm run db:generate`
- Prisma schema validation: `npm run db:validate`
- Relational representability proof: `npm run db:representability` after applying migrations to an isolated disposable database
- Production dependency audit: `npm run audit:prod`
- Database migration: `npm run db:migrate` after `DATABASE_URL` and `DIRECT_URL` are configured
- Production build: `npm run build`
- Full verification: `npm run verify`

The canonical local/CI quality contract, required `verify` branch-protection check, and failure triage guidance are in [docs/CI_QUALITY_GATES.md](docs/CI_QUALITY_GATES.md).

## Working agreement

- Keep issues small enough to review and deliver independently.
- Treat game events as the source of truth; derive aggregates from them.
- Validate baseball scoring rules in domain-level tests.
- Prefer accessibility, touch-friendly interactions, and offline-tolerant workflows.
- Never commit secrets or production data.

## Repository governance

The intended taxonomy, milestone plan, project-board layout, and security baseline are documented in .github/label-taxonomy.md and .github/branch-protection.md.
