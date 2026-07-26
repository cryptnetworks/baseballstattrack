# ADR 0002: Event-Oriented Domain Boundary

## Status

Accepted

## Context

The roadmap and repository agreement require preserving scorekeeping events so corrections can be audited and statistics can be recalculated. M0 issue #4 will define the complete baseball scoring vocabulary later, so this slice must avoid inventing a premature event model.

## Decision

Represent game activity conceptually as ordered source event envelopes. Keep domain logic in `src/domain` and free of React, Next.js, Prisma, and Supabase imports. Store and replay source events as the primary record in future persistence work; derive scoreboards, box scores, and season statistics from those events or from rebuildable projections.

For this slice, only a minimal event-envelope validation shape and event-log summary helper are introduced to prove the boundary and testing approach.

## Rejected Alternatives

- Aggregate-stat tables as primary records: rejected because corrections would not be auditable or reliably replayable.
- Full scoring-event vocabulary now: rejected because issue #4 owns those semantics and ambiguous scoring cases still need review.
- React component state as the scorekeeping source of truth: rejected because events must survive offline recovery, synchronization, and replay.

## Consequences

Future persistence work should distinguish immutable source events from derived projections. Domain tests should cover scoring semantics before UI or database code depends on them.
