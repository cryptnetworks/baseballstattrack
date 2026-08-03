# ADR 0014: Account-scoped immutable fantasy aggregates

## Status

Accepted

## Context

ADR 0013 defines immutable fantasy scoring models downstream from canonical
baseball statistics. M8 now needs fantasy league, team, player-reference,
eligibility, ownership, and roster concepts without duplicating player identity,
granting Organization access to Account data, or committing prematurely to the
transaction and matchup persistence shapes owned by #124 and #126.

## Decision

Create framework-independent, Account-owned fantasy aggregates. A fantasy
league season binds one canonical season reference and one exact fantasy model
family/version/digest. Fantasy teams name exact Account membership owners.
Fantasy player entries carry one canonical `baseballPlayerId` plus verified,
versioned eligibility and ownership snapshots; they carry no copied identity or
private player fields.

Roster state is an immutable revision chain. Each snapshot has exact
Account/league/team ancestry, predecessor, effective UTC instant, sealed rules
binding, and validated active/bench/inactive slots. Completed leagues cannot
return to active or receive new roster history.

Direct Account and #107-delegated authority use the same distinct fantasy
capabilities. Delegated authority is accepted only from an allowed exact-
Account #107 decision; Organization or League membership is never sufficient.
League activation requires separate approval.

No database schema is added. ADR 0015 now defines #124 ownership-event and
transaction atomicity, while #126 must still define scoring-period/result
references. Both consume these identities and snapshots without mutating them.

## Consequences

- Fantasy state cannot change baseball truth or duplicate baseball identity.
- One baseball player can participate in multiple fantasy leagues through
  distinct entries that reference the same stable source id.
- Exact digests, source revisions, predecessor links, and immutable objects keep
  historical rosters reproducible after later changes.
- Account isolation and commissioner actions fail closed under explicit
  capabilities and exact scopes.
- Transaction behavior is implemented by ADR 0015. Scoring, standings,
  playoffs, UI, persistence, and offline behavior remain deferred.

## Alternatives rejected

### Duplicate player records in the fantasy domain

Rejected because copied names and attributes drift from canonical identity,
leak private fields, and make corrections ambiguous.

### Store only the current roster

Rejected because trades, drops, corrections, and rule changes would make prior
lineups and results unreproducible.

### Treat league or organization membership as Account permission

Rejected because #107 explicitly separates administrative membership from
Account consent and least-privilege capability grants.

### Add partial fantasy tables now

Rejected because transaction events were not yet defined and scoring-period
references remain undefined. A partial schema would invite mutable ownership
columns and later lineage-breaking migrations.

## Revisit triggers

Revisit only if ADR 0015 or reviewed #126 design cannot reference these stable
ids and snapshots, a cross-Account competition contract establishes explicit
sharing, or persistence exposes an unrepresentable constraint. Any superseding
decision must preserve canonical player references, exact Account authorization,
immutable history, and the one-way baseball-to-fantasy boundary.
