# ADR 0005: Persistence, Tenancy, and Migration Rules

## Status

Accepted

## Context

Baseball Stat Track uses Next.js, PostgreSQL/Supabase, Prisma, strict TypeScript, and an event-oriented baseball domain boundary. ADR 0004 establishes append-only source events, atomic play transactions, correction supersession, ruleset versions, and rebuildable projections. Issue #5 defines the persistence, tenancy, and migration rules needed before M1 adds production schema.

## Decision

Use an `Account` as the primary tenant and authorization boundary. An account owns teams, seasons, player identities, rosters, games, source events, play transactions, correction relationships, projections, and audit records. Users authenticate independently and receive access through account memberships and optional scoped grants.

Use PostgreSQL relational integrity through Prisma-managed migrations for M1 persistence. Account-owned records must carry tenant scope, and critical relationships must prevent cross-account references through database constraints rather than relying only on application code.

Persist accepted source events and atomic play transactions as authoritative, append-only records. Derived game state, box scores, player statistics, team statistics, and season summaries may be cached only as rebuildable projections tied to source revisions, ruleset versions, and derivation versions.

Use forward-compatible migration practices: reviewed Prisma migrations in `prisma/migrations`, one logical purpose per migration, no editing applied production migrations, expand-and-contract for risky changes, restartable backfills, and roll-forward repair by default.

## Rejected Alternatives

- User-owned tenancy: rejected because collaboration, ownership transfer, multi-team management, and team history would be fragile.
- Team-owned tenancy: rejected because one account may manage multiple teams and future club/league administration should not require rewriting ownership.
- League-owned tenancy: rejected as too specific for MVP families, independent teams, and clubs.
- Separate databases per team/account for M1: rejected because it adds operational complexity before the product needs it.
- Aggregate-stat tables as authoritative records: rejected because corrections must replay from source events.
- Hard-deleting accepted source events: rejected because audit, correction, and replay require retained history.

## Consequences

M1 schema work should implement account-scoped relational models and database constraints aligned with `docs/PERSISTENCE_AND_TENANCY.md`. Authorization services must check database memberships, not only session claims. Migration PRs must document rollback or roll-forward strategy, data validation, and projection rebuild impact. Privacy, production auth, backup objectives, and projection worker implementation remain separate follow-up issues.
