# ADR 0017: Account-scoped fantasy experience persistence

## Status

Accepted

## Context

ADRs 0013–0016 define immutable fantasy rules, Account-owned domain entities,
append-only transactions, and deterministic versioned results. The final M8
experience needs durable league state, concurrent roster writes, correction
history, notification consent, and safe presentation. Storing only a mutable
JSON document would lose transaction/result history; immediately decomposing
every frozen domain value into relational tables would duplicate the validated
domain state machine and widen the migration surface.

## Decision

Persist one Account-scoped `FantasyLeagueWorkspace` aggregate projection, one
append-only `FantasyLeagueEvent` audit stream, and one append-only
`FantasyResultSnapshot` revision stream.

Roster mutations lock the exact workspace row, apply the pure #124 state
machine, increment one workspace revision, append one event, and enqueue one
notification outbox event in a short transaction. Duplicate operation ids
return their original result. Result snapshots retain the full #126 lineage and
predecessor relation and cannot update or delete.

Extend the existing notification preference/outbox/delivery foundation with a
fantasy-league scope, recipient enablement, daily digest timing, IANA time zone,
and quiet hours. Only a previously consented Account destination may be
inherited by a new fantasy league.

All application access uses the selected Account plus exact league identity.
Team mutations also compare the authenticated membership to the stored team
owner unless an explicit commissioner capability is present. New tables enable
RLS and revoke direct Supabase API-role privileges; trusted server code remains
the only persistence adapter.

## Consequences

- Domain validation stays framework-independent while database writes are
  atomic, idempotent, and auditable.
- Historical roster and scoring meaning survives corrections and current-view
  projection changes.
- Privacy overlays can change presentation without copying or rewriting player
  identity in fantasy history.
- League notification choices remain recipient-controlled and destination
  details stay outside the fantasy UI.
- The aggregate snapshot is bounded to 500 player entries/results per load;
  growth beyond this initial format requires pagination or decomposed current
  projections.
- Automatic scoring orchestration and #107 delegated web-auth adaptation remain
  operational follow-up work; neither is silently inferred here.

## Alternatives rejected

### Browser-only fantasy state

Rejected because concurrent writes, corrections, authorization, and audit could
not be enforced.

### Mutable current-score rows

Rejected because recalculation would rewrite competition history and discard
source lineage.

### Copy canonical player profiles into fantasy tables

Rejected because it creates identity drift and privacy leakage.

### Infer manager access from a league id

Rejected because possession of an identifier is not Account or delegated
authority.

## Revisit triggers

Revisit when leagues exceed aggregate bounds, cross-Account participation is
approved, #107 delegated authority reaches the web authentication adapter, or a
calculation scheduler is introduced. A replacement must preserve Account
isolation, immutable baseball truth, result lineage, recipient consent, and
append-only historical records.
