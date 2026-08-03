# ADR 0015: Deterministic fantasy roster transactions

## Status

Accepted

## Context

ADR 0014 defines immutable Account-scoped fantasy league, team, player-entry,
ownership, and roster snapshots. M8 needs add, drop, trade, waiver, and lineup
behavior that remains auditable under retries and concurrency without changing
canonical baseball truth or preempting #126 scoring/result identity.

## Decision

Implement a pure transaction state machine. Every command carries an exact
Account/league, actor authority, accepted UTC timestamp, operation id, expected
revision, and audit id. Success appends ownership/roster state and audit;
parseable denial appends audit but preserves the prior mutation revision.

Use a canonical request digest for idempotency and optimistic aggregate revision
for concurrency. Exact retries return the original result. Reused keys with new
content and stale writers fail without mutation.

Initial roster assignment uses one declared `DRAFT` or
`COMMISSIONER_ASSIGNMENT` method, league-wide processor authority, and a sealed
deadline. Later acquisitions use deterministic daily waiver batches: current
priority, then submitted time, then stable claim id. Only successful claims
rotate priority. Conditional drops and acquisitions are claim-local atomic
candidates.

Trades execute only at sealed instants before the deadline, require both current
team-owner acceptances plus league-wide processing authority, have no subjective
veto, and commit both ownership/roster changes together. Lineup locks are sealed
UTC intervals; commissioner correction creates a new reasoned audit/snapshot.

No persistence or scheduler is added. ADR 0016 now completes the #123/#124/#126
result identity boundary. A future schema will atomically persist these results
with uniqueness, compare-and-swap, immutable history, worker leases, and RLS.

## Consequences

- Add, drop, trade, waiver, cancellation, and lineup behavior is deterministic
  and independently testable.
- Duplicate delivery, concurrent writers, failed second trade roster, and failed
  post-drop acquisition cannot partially change ownership.
- Every safe decision has actor/scope/action/player/time/result audit evidence.
- Past rosters remain addressable for #126 result lineage under ADR 0016.
- The domain does not implement scoring, standings, playoffs, UI, or baseball
  mutation.

## Alternatives rejected

### Mutable current roster rows as transaction history

Rejected because overwrites cannot reproduce prior locks, ownership, or results.

### First-come free agency

Rejected because timing races conflict with the low-maintenance #125 format and
make network latency part of league outcomes.

### Last-write-wins concurrency

Rejected because simultaneous adds, claims, or lineup changes could duplicate
ownership or erase a valid roster revision.

### Partial trade commits

Rejected because one failed roster would leave ownership split or duplicate.

### Subjective commissioner trade veto

Rejected in favor of mutual manager acceptance and objective authorization,
deadline, ownership, roster, eligibility, and integrity rules.

## Revisit triggers

Revisit only if #126 cannot bind immutable roster snapshot ids, a reviewed
fantasy format needs another deterministic acquisition policy, or production
persistence exposes an unrepresentable atomic constraint. Any superseding
decision must preserve Account isolation, idempotency, audit, objective order,
atomic rollback, and the one-way baseball-to-fantasy boundary.
