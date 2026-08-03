# ADR 0003: Persistence Integration Boundaries

## Status

Superseded in part

The PostgreSQL/Prisma decision remains accepted. Supabase authentication was
replaced by the provider-neutral, application-owned identity and session
boundary documented in `docs/AUTHENTICATION_PROVIDERS.md`.

## Context

The approved stack includes PostgreSQL, Supabase, and Prisma. M0 issue #5 still owns detailed tenancy, migration, and production persistence rules, so this slice should prepare integration boundaries without introducing production tables.

## Decision

Use Prisma as the typed server-side database boundary for PostgreSQL access and
migrations. Provider-hosted PostgreSQL, including Supabase PostgreSQL, may be
used through that standard database boundary. Authentication does not use a
Supabase client or Supabase session primitive.

The initial Prisma schema declares PostgreSQL connectivity only. Production models and migrations will be added after the persistence, tenancy, and event vocabulary decisions are accepted.

## Rejected Alternatives

- Direct SQL throughout application services: rejected for the initial stack because typed migrations and generated client access improve maintainability.
- Supabase client as the only data-access layer: rejected because Prisma gives clearer migration and relational modeling workflows for server-owned data.
- Initial placeholder tables: rejected because they would imply persistence decisions that belong to issue #5 and scoring vocabulary decisions that belong to issue #4.

## Consequences

Local development requires `DATABASE_URL` and `DIRECT_URL` before running migrations. The app can build without database credentials because no database query runs during render.
