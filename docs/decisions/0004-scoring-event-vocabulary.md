# ADR 0004: Scoring Event Vocabulary and Replay Contract

## Status

Accepted

## Context

Baseball Stat Track must preserve game events as the source of truth and derive scores, reports, and statistics from replayable records. Issue #4 defines the canonical scoring semantics needed before schema, event-model, statistic-derivation, and fixture work can proceed.

The event-oriented domain boundary and MVP product scope are already accepted on `main`. This decision records the durable architecture consequences of the scoring vocabulary without implementing a production event model.

## Decision

Use an append-only, ordered source-event stream as the replay contract for baseball scoring. Events must carry enough explicit scorer judgment to distinguish batter result, runner movement, outs, runs, pitcher responsibility, fielder credits, errors, sacrifices, fielder's choice, corrections, and verification.

Live baseball plays must be accepted as atomic play transactions. A plate appearance, steal attempt, pickoff, award, appeal, or other live play may contain multiple component source events, but those components must validate against one pre-play state and persist all-or-nothing.

Corrections must append supersession or reversal events rather than editing or deleting original events. The effective event stream is produced by applying those relationships and must deterministically replay to the current game state and derived statistics.

Event schema versions and baseball ruleset versions are separate. Schema versions govern payload shape; ruleset versions govern scoring interpretation, game-ending conditions, lineup/substitution options, awards, and statistic formulas. Historical games must replay under their recorded ruleset unless an explicit correction or migration records a different decision.

Mutable aggregate statistics must not be stored as the source of truth. Aggregate values may be cached later only as rebuildable projections that are invalidated and rebuilt after accepted corrections.

## Rejected Alternatives

- Store box-score lines as the primary record: rejected because corrections and stat recalculation would not be reliably auditable.
- Infer all baseball judgment from base/out transitions: rejected because baseball scoring requires explicit scorer classifications such as error, sacrifice, fielder's choice, interference, RBI eligibility, and earned-run treatment.
- Persist component events independently for a single play: rejected because a partially recorded play could credit a plate appearance without its required runner, out, award, or fielding effects.
- Implement a production event schema during M0: rejected because issue #4 is a semantics decision; issues #9-#12 own schema, event model, stat derivation, and fixtures.

## Consequences

Issues #9-#12 should implement against `docs/SCORING_SEMANTICS.md` rather than inventing event names or baseball classifications. Future persistence work must separate immutable source events from rebuildable derived projections. Ruleset differences must be versioned so historical games can be replayed consistently after the vocabulary evolves.
