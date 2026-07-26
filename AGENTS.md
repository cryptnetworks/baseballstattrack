# Repository Instructions

## Project Overview

Baseball Stat Track is an event-oriented baseball scorekeeping and statistics application. Scorekeeping events are the source of truth; scores, box scores, and statistics are derived from replayable records.

Primary workspaces:

- `src/app` — Next.js App Router pages and route handlers.
- `src/components` — reusable UI, app shell, and client providers.
- `src/domain` — framework-independent baseball domain logic.
- `src/validation` — shared Zod validation primitives.
- `src/server` — server-side application services, Prisma data access, and Supabase integration boundaries.
- `tests` — focused Vitest tests.
- `docs/decisions` — architecture decision records.
- `prisma` — Prisma schema and future migrations.

Supported runtime and deployment baseline:

- Node.js 24 or newer.
- npm 11 or newer.
- GitHub Actions CI.
- Future hosted deployment target will use PostgreSQL/Supabase and Next.js-compatible hosting.

## Required Commands

- Install: `npm ci`
- Format: `npm run format`
- Lint: `npm run lint`
- Typecheck: `npm run typecheck`
- Unit tests: `npm run test`
- Integration tests: not yet configured
- Full verification: `npm run verify`
- Production build: `npm run build`
- Database migration: `npm run db:migrate`

## Repository Conventions

- Branch strategy: short-lived branches using `feat/`, `fix/`, `chore/`, or `docs/`, with related issue numbers in the branch name when practical.
- Labels and milestones: use the taxonomy in `.github/label-taxonomy.md`; M0-M4 roadmap detail lives in `docs/ROADMAP.md`.
- Database migrations: run `npm run db:migrate` only after `DATABASE_URL` and `DIRECT_URL` are configured. Do not add production tables until persistence, tenancy, and event-vocabulary decisions are accepted.
- API compatibility: keep domain logic independent from React, Next.js, Prisma, and Supabase. Validate boundary inputs with Zod.
- Release and deployment: releases require passing CI, reviewed migrations, rollback notes, and operational readiness per `.github/branch-protection.md`.
- Required CI checks: `verify`.

## Definition of Done

Before a PR is ready for review, run:

- `npm run format`
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run db:validate`
- `npm run build`
- `npm run verify`

Confirm no secrets, production data, accidental generated files, or unrelated scope are included.
