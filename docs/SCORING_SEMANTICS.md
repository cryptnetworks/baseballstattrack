# Scoring semantics and event vocabulary

This specification defines the canonical baseball scoring vocabulary for Baseball Stat Track. It is a product and domain contract for future schema, replay, statistic derivation, fixture, and UX work. It does not define database tables, API routes, UI flows, or a production replay engine.

The core rule is simple: a game is represented by an ordered, append-only event stream. Current game state, box scores, season summaries, and statistics are derived by replaying the effective event stream.

## Glossary

| Term                   | Meaning                                                                                                                                                                                                               |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| At-bat                 | A subset of plate appearances that counts toward batting average. Hits, most outs, reached on error, and fielder's choice usually count as at-bats. Walks, hit by pitch, sacrifices, and catcher interference do not. |
| Batter credit          | The scorer's classification of the batter's result, such as hit, walk, sacrifice, reached on error, or fielder's choice.                                                                                              |
| Effective event stream | The ordered source events after applying append-only corrections, reversals, and supersession relationships.                                                                                                          |
| Event sequence         | Monotonic ordering value within a game. Replaying events by this value must be deterministic.                                                                                                                         |
| Game revision          | Monotonic accepted-state version for one game. Every accepted source event outside a play, or every accepted atomic play transaction, advances the revision.                                                          |
| Half inning            | Top or bottom portion of an inning.                                                                                                                                                                                   |
| Play transaction       | Atomic group of one or more source events that resolve one baseball play against one pre-play state.                                                                                                                  |
| Plate appearance       | A completed turn batting, including outcomes that are not at-bats.                                                                                                                                                    |
| Recorded statistic     | A scoring credit or charge preserved as source input because it depends on scorer judgment or ruleset configuration.                                                                                                  |
| Responsible event      | The source event that explains why a runner moved, scored, or was put out.                                                                                                                                            |
| Source event           | A user-recorded or system-recorded fact that is preserved for audit and replay.                                                                                                                                       |
| Derived fact           | A value calculated from source events, such as current score, batting average, RBI total, or box score line.                                                                                                          |
| Verified game          | A completed game reviewed for stat inclusion. Verified season statistics must use only verified games unless a report explicitly says otherwise.                                                                      |

## Game Lifecycle

### States

| State         | Meaning                                                                               | Scoring allowed     | Corrections allowed      | Reports allowed       | Verified season stats |
| ------------- | ------------------------------------------------------------------------------------- | ------------------- | ------------------------ | --------------------- | --------------------- |
| `draft`       | Game exists but setup is incomplete.                                                  | No                  | Setup edits only         | Setup preview only    | No                    |
| `ready`       | Teams, lineup, defensive assignments, and starting pitcher are valid for first pitch. | Start only          | Setup edits only         | Pregame preview       | No                    |
| `in_progress` | The game is actively being scored.                                                    | Yes                 | Yes, for previous events | Live, unverified      | No                    |
| `suspended`   | Scoring paused before natural completion, with current state preserved.               | Resume only         | Yes                      | Suspended, unverified | No                    |
| `completed`   | Game reached an accepted ending condition but has not been reviewed.                  | No new live scoring | Yes                      | Completed, unverified | No                    |
| `verified`    | Completed game reviewed for stat inclusion.                                           | No                  | Reopen first             | Verified reports      | Yes                   |
| `corrected`   | A verified or completed game has accepted corrections and needs review.               | No new live scoring | Yes                      | Corrected, unverified | No until re-verified  |
| `abandoned`   | Game started but will not produce official team statistics.                           | No                  | Metadata or audit only   | Abandoned report      | No                    |
| `cancelled`   | Game did not start or should not be treated as played.                                | No                  | Metadata or audit only   | Cancelled listing     | No                    |

`corrected` is a review state, not permission to continue live scoring. After correction review, the game transitions back to `verified` when accepted or remains `corrected` until more review or corrections are completed.

### Valid Transitions

| From                                                 | Event               | To            | Notes                                               |
| ---------------------------------------------------- | ------------------- | ------------- | --------------------------------------------------- |
| none                                                 | `GameCreated`       | `draft`       | Creates game shell.                                 |
| `draft`                                              | `GameSetupReady`    | `ready`       | Requires valid teams, lineup, defense, and pitcher. |
| `ready`                                              | `GameStarted`       | `in_progress` | Initializes first half inning and first batter.     |
| `in_progress`                                        | `GameSuspended`     | `suspended`   | Preserves replay state.                             |
| `suspended`                                          | `GameResumed`       | `in_progress` | No state loss or sequence reset.                    |
| `in_progress`                                        | `GameCompleted`     | `completed`   | Requires accepted ending condition.                 |
| `completed`                                          | `GameVerified`      | `verified`    | Reviewer accepts box score and derived stats.       |
| `verified`                                           | `GameReopened`      | `corrected`   | Required before changing effective events.          |
| `completed`, `corrected`                             | `CorrectionApplied` | `corrected`   | Appends correction metadata and supersession links. |
| `corrected`                                          | `GameVerified`      | `verified`    | Re-derived stats are accepted.                      |
| `draft`, `ready`                                     | `GameCancelled`     | `cancelled`   | No official game events.                            |
| `in_progress`, `suspended`, `completed`, `corrected` | `GameAbandoned`     | `abandoned`   | Preserves partial audit record.                     |

## Authoritative Replay State

The replay engine must be able to reconstruct at least this state from source events:

| State Component | Requirements                                                                                                                              |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Inning          | Positive inning number and half (`top` or `bottom`).                                                                                      |
| Outs            | Integer 0, 1, or 2 while a half inning is active. A third out ends the half inning immediately after all valid play effects are resolved. |
| Bases           | First, second, and third may each hold zero or one runner identity. A runner may not occupy more than one base.                           |
| Score           | Non-negative home and away run totals derived from recorded scoring events and runner movements.                                          |
| Batter          | Active batting-order slot and player identity.                                                                                            |
| Batting order   | Ordered lineup history for each team, including substitutions and continuous-order configuration where enabled.                           |
| Pitcher         | Active pitcher for the defensive team and responsibility for existing baserunners.                                                        |
| Defense         | Active defensive assignments by team, player, and position.                                                                               |
| Game status     | Current lifecycle state.                                                                                                                  |
| Event sequence  | Monotonic event sequence and game revision used for deterministic replay and conflict detection.                                          |

### Invariants

- Event sequence is strictly increasing within a game. Corrections append new events; they do not edit sequence history.
- A scoring event must reference the current effective game revision it was based on.
- Outs in active play may not exceed three. Once the third out is accepted, the next live scoring state is the next half inning or game completion.
- No base may contain more than one runner after a play resolves.
- One runner may not appear on multiple bases after a play resolves.
- A runner may score only from an occupied base, from the batter-runner state, or from a rule-defined award.
- The active batter must match the offensive team's effective batting order unless the event records an explicit lineup correction.
- The active pitcher must belong to the defensive team and must be eligible under the effective lineup and pitching-change history.
- Defensive assignments must not put the same player in multiple positions at the same time unless a league rule explicitly permits it.
- Runs that score on inning-ending plays count only when baseball scoring rules allow them to count.
- Derived statistics must be reproducible from the same effective event stream.

## Event Envelope

Every source event must carry:

- Stable event identifier.
- Game identifier.
- Sequence number.
- Event type.
- Event schema version.
- Baseball ruleset version.
- Client submission identifier for idempotent retry handling.
- Actor who recorded or approved the event.
- Timestamp recorded by the system.
- Expected game revision and resulting accepted game revision.
- Play transaction identifier, parent event relationship, or correction relationship when applicable.
- Event payload using the vocabulary in this document.

### Ordering, Concurrency, and Versions

Event schema version and baseball ruleset version are separate:

- Event schema version describes the payload shape and validation contract for a stored source event.
- Baseball ruleset version describes scoring interpretation, lineup/substitution configuration, game-ending conditions, and statistic formulas.
- Historical games replay with the event schema migrations and ruleset version recorded on the effective events; newer rulesets may be introduced without changing historical interpretation.
- Unsupported league-specific rules enter as new ruleset versions, new optional payload fields, or new source events. They must not reinterpret previously verified games unless a correction or explicit migration records that decision.

Within one game, the server assigns one strictly increasing sequence per accepted event. A client may propose an event against a known effective game revision, but conflicting proposals must be rejected or converted into explicit correction/resolution events. Replay order is sequence order after supersession rules are applied; wall-clock timestamps are audit metadata and never determine baseball state.

Idempotency is part of the event contract. Retrying the same client submission identifier with the same actor, game, expected revision, and payload must return the original accepted event or play transaction instead of appending a duplicate. Reusing the same client submission identifier with different payload content must be rejected.

### Atomic Play Transactions

One live baseball play is represented as an atomic play transaction containing one or more canonical source events. Examples include a plate appearance with runner advances, a steal with a throwing error, a pickoff with another runner advancing, or a wild pitch during a strikeout.

Every play transaction must record:

- Stable play transaction identifier.
- Game identifier.
- Expected pre-play game revision and enough pre-play state to validate batter, pitcher, outs, bases, inning, score, lineup, defense, and ruleset.
- One or more component source events with deterministic component order inside the play.
- Resulting post-play game revision and enough post-play state, or a state hash, to detect replay drift.
- Actor, timestamp, and client submission identifier for idempotent acceptance.

Play acceptance is all-or-nothing. The application must not persist a completed batter result without its required runner advances, outs, fielding judgments, awards, or score effects. Validation runs against the pre-play state and the full component set before any component becomes part of the accepted event stream.

Component ordering inside a play resolves baseball effects, not wall-clock timing. The component order must identify the batter result, runner ledger entries, out numbers within the play, run-counting judgments, fielding credits, pitcher responsibility, and scorer judgments. After all valid play effects resolve, replay commits the post-play state: bases, outs, score, next batter, pitcher responsibility, and possible half-inning or game-status transition.

Standalone runner events such as steals, caught stealing, pickoffs, balks, wild pitches, passed balls, appeals, and defensive indifference are also play transactions when they change live baseball state. Lifecycle, setup, verification, and correction events are source events but are not live play transactions unless they explicitly replace or reverse one.

Corrections may target:

- A complete play transaction, replacing or reversing every component in that play.
- A component event or component range inside a play, such as runner movement or out order.
- A scorer judgment inside an event, such as error attribution, RBI eligibility, earned-run context, or sacrifice classification.

If correcting one component changes the legal preconditions or post-play state of later components in the same play, the correction must replace the whole play transaction or the affected component range. Partial corrections that leave the play transaction internally invalid are rejected.

### Effective Event Stream

The effective event stream is deterministic:

1. Read accepted source events in strictly increasing sequence order.
2. Migrate old payload shapes according to their event schema versions without changing recorded baseball meaning.
3. Replay each event under the baseball ruleset version recorded on that event or play transaction.
4. Apply `CorrectionApplied` events in sequence order to build a supersession map.
5. Exclude superseded or reversed events and include replacement events only when their own preconditions replay cleanly.
6. Revalidate later events whose expected pre-play revision or preconditions depended on a superseded event.
7. Stop effective replay at the first unresolved invalid dependency, or mark the dependent range invalid, until a correction replaces the affected range.

A correction that changes base/out state, batter order, pitcher responsibility, run counting, or earned-run context can invalidate later events even when those later event payloads were not named directly. The correction event must therefore declare its dependency policy: `replace_play`, `replace_event_range`, `replace_judgment`, or `reverse_events`. For `replace_event_range`, the corrected range must include every later event whose preconditions no longer match the corrected replay state.

Original source events remain addressable for audit. Replaying without correction metadata reconstructs the historical scoring record; replaying the effective stream reconstructs the current accepted game state and derived statistics.

### Shared Event Contract

Every event type in the vocabulary inherits this contract even when a table row only lists the fields that are unique to that event:

- Purpose and classification: each event is one of lifecycle, setup, plate appearance, runner movement, out, fielding judgment, runner award, substitution, correction, or verification.
- Inputs: every event carries the envelope fields above plus the required payload fields in the vocabulary table; optional fields are allowed only when documented by the event schema version or ruleset version.
- Preconditions and validation: the event must be legal for the current lifecycle state, current lineup, active half inning, base/out state, pitcher, defense, and ruleset.
- Game-state outputs: replay may change only the state components named by the event's `May Change` entry.
- Runner effects: every runner movement, score, award, or out must be recorded as `RunnerAdvanceRecorded`, `RunnerOutRecorded`, or a specialized event that expands to the same runner ledger inside an atomic play transaction.
- Out effects: every out records the retired runner or batter-runner, out number within the play, force or tag status when applicable, fielding path when known, and whether it is the inning-ending third out.
- Score effects: runs are derived from runner movements to home, but the source event must record run-counting judgment for inning-ending and ambiguous third-out situations.
- Recorded statistic effects: scorer judgments such as batter credit, errors, sacrifices, RBI eligibility, earned/unearned context, stolen base, caught stealing, wild pitch, passed ball, and double-play participation are source facts.
- Derived statistic effects: totals, rates, box scores, standings-style summaries, and season reports are rebuilt from recorded statistic effects and replay state.
- Correction behavior: an event is never mutated or deleted; corrections append `CorrectionApplied` events that supersede, reverse, or replace one play transaction, one event, a dependent event range, or a scorer judgment.
- Versioning behavior: adding optional fields or new event types requires a new event schema version; changing baseball interpretation requires a new ruleset version.

## Event Vocabulary

Event payloads should distinguish batter result, runner movement, outs, fielder credits, pitcher responsibility, and scorer judgment. A UI may collect these together, but replay must see the canonical parts.

| Event Type                  | Classification       | Meaning                                                                                        | Required Inputs                                                                                               | May Change                                                  | Validation Rules                                                                               | Statistics Affected                                                               | Recorded or Derived                                  |
| --------------------------- | -------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `GameCreated`               | Lifecycle            | Creates a scheduled game shell.                                                                | Teams, season, home/away, date.                                                                               | Game status.                                                | No duplicate active game for same team/opponent/date unless allowed.                           | None.                                                                             | Recorded.                                            |
| `GameSetupReady`            | Lifecycle/setup      | Marks setup valid for scoring.                                                                 | Starting lineup, batting order, defense, pitcher, ruleset version.                                            | Game status, lineup history.                                | Must satisfy roster, lineup, pitcher, and defensive-assignment rules.                          | None.                                                                             | Recorded.                                            |
| `GameStarted`               | Lifecycle            | Starts live scoring.                                                                           | Starting offensive team, inning, batter slot.                                                                 | Game status, inning, batter.                                | Game must be `ready`.                                                                          | None directly.                                                                    | Recorded.                                            |
| `GameSuspended`             | Lifecycle            | Pauses a game.                                                                                 | Reason, suspended state snapshot hash.                                                                        | Game status.                                                | Game must be `in_progress`.                                                                    | Report status only.                                                               | Recorded.                                            |
| `GameResumed`               | Lifecycle            | Resumes a suspended game.                                                                      | Resume time, state confirmation.                                                                              | Game status.                                                | Game must be `suspended`; state hash must match effective stream.                              | Report status only.                                                               | Recorded.                                            |
| `GameCompleted`             | Lifecycle            | Ends live scoring.                                                                             | Ending reason, final state confirmation.                                                                      | Game status.                                                | Ending condition must be valid under ruleset.                                                  | Enables completed reports.                                                        | Recorded.                                            |
| `GameVerified`              | Verification         | Accepts a completed/corrected game for stats.                                                  | Reviewer, review notes, verification scope.                                                                   | Game status/review metadata.                                | Effective replay must have no unresolved validation errors.                                    | Verified season stats include game.                                               | Recorded.                                            |
| `GameReopened`              | Correction lifecycle | Reopens a verified game for correction.                                                        | Actor, reason.                                                                                                | Game status.                                                | Game must be `verified`.                                                                       | Verified season stats must exclude game until re-verified.                        | Recorded.                                            |
| `GameAbandoned`             | Lifecycle            | Marks a started game as not official.                                                          | Actor, reason.                                                                                                | Game status.                                                | Game must have started.                                                                        | Excluded from verified stats unless a report explicitly includes abandoned games. | Recorded.                                            |
| `GameCancelled`             | Lifecycle            | Marks an unstarted game as cancelled.                                                          | Actor, reason.                                                                                                | Game status.                                                | Game must be `draft` or `ready`.                                                               | None.                                                                             | Recorded.                                            |
| `LineupSet`                 | Setup                | Establishes batting order and starters.                                                        | Team, ordered slots, players, initial positions.                                                              | Lineup history, active batter when relevant.                | Players must be eligible; slots must be unique.                                                | Future PA attribution.                                                            | Recorded.                                            |
| `BattingOrderAdjusted`      | Setup/correction     | Records valid batting-order correction or rule-driven adjustment.                              | Team, affected slots, reason.                                                                                 | Batting order history.                                      | Must not create duplicate active slots unless continuous order permits it.                     | Future PA attribution; correction audit.                                          | Recorded.                                            |
| `DefensiveSubstitutionMade` | Substitution         | Changes defensive player or position.                                                          | Team, outgoing player/position, incoming player/position, effective sequence.                                 | Defensive assignments, lineup history.                      | Player eligibility and substitution rules must pass.                                           | Fielding and pitcher/batter context from effective point forward.                 | Recorded.                                            |
| `DefensiveAlignmentChanged` | Defensive position   | Moves active defenders without changing batting eligibility.                                   | Team, player-position assignments, effective sequence, reason.                                                | Defensive assignments.                                      | Active defenders and positions must be legal under ruleset.                                    | Fielding context from effective point forward.                                    | Recorded.                                            |
| `PitchingChangeMade`        | Pitching change      | Changes active pitcher.                                                                        | Team, outgoing pitcher, incoming pitcher, inherited runners.                                                  | Active pitcher, pitcher responsibility.                     | Defensive team only; incoming pitcher must be eligible.                                        | Pitcher batters faced, inherited runner responsibility, pitching lines.           | Recorded.                                            |
| `SpecialRunnerPlaced`       | Ruleset extension    | Places courtesy, temporary, tie-break, or other rule-awarded runner.                           | Runner identity or placeholder, replaced player if any, base, responsibility, earned-run treatment, reason.   | Bases, pitcher responsibility, lineup context.              | Ruleset must permit the runner type and define replacement/reentry behavior.                   | Run responsibility and scoring context.                                           | Recorded when enabled by ruleset.                    |
| `PlateAppearanceRecorded`   | Plate appearance     | Records completed batter result.                                                               | Batter, pitcher, outcome, batted-ball class where applicable, fielder credits, RBI judgment where applicable. | Batter, outs, bases, score, inning, pitcher responsibility. | Must match active batter and pitcher; must resolve all affected runners.                       | PA, AB, H, BB, HBP, K, sacrifices, RBI, pitcher and fielding stats.               | Recorded source event with derived stat effects.     |
| `RunnerAdvanceRecorded`     | Runner movement      | Records safe runner movement or scoring caused by the responsible event.                       | Runner, start base, end base or home, responsibility, forced flag, earned/unearned context where relevant.    | Bases, score.                                               | Start base must be occupied unless runner is batter-runner; end base must be valid and unique. | Runs, RBI eligibility, earned runs, stolen bases, non-out base advances.          | Recorded as part of play or standalone runner event. |
| `RunnerOutRecorded`         | Out                  | Records an out on a runner outside the batter result.                                          | Runner, start base, out location, fielders, reason, force/tag flag.                                           | Outs, bases, inning.                                        | Runner must be active; third-out run-counting rule must be resolved.                           | Putouts, assists, caught stealing, pickoff, double/triple play participation.     | Recorded as part of play or standalone runner event. |
| `StolenBaseAttemptRecorded` | Runner movement      | Records steal attempt independent of a plate appearance.                                       | Runner, start base, target base, result, fielders.                                                            | Bases, outs, score when home steal succeeds.                | Runner must occupy start base; target base must be valid.                                      | SB, CS, assists, putouts, pitcher/catcher context.                                | Recorded.                                            |
| `PickoffRecorded`           | Runner movement/out  | Records pickoff attempt result.                                                                | Runner, base, result, fielders, pitcher.                                                                      | Bases, outs.                                                | Runner must occupy base.                                                                       | Pickoff, CS when applicable, assists, putouts.                                    | Recorded.                                            |
| `RunnerAwardRecorded`       | Runner award         | Records wild pitch, passed ball, balk, ground-rule double, automatic double, or similar award. | Award type, responsible pitcher/catcher/fielder or rule, affected runners, advances.                          | Bases, score.                                               | Runner advances must be complete and legal for the award.                                      | WP, PB, balk, base awards, earned-run context.                                    | Recorded.                                            |
| `FieldingCreditRecorded`    | Fielding judgment    | Adds explicit scorer judgment for fielders.                                                    | Fielders, credit type, play reference.                                                                        | Fielding ledger only.                                       | Must reference a play and active defenders.                                                    | Putouts, assists, double-play credits.                                            | Recorded when not inferable from play payload.       |
| `ErrorRecorded`             | Fielding judgment    | Records fielding error judgment.                                                               | Fielder, error type, play reference, runner/batter effect.                                                    | Fielding ledger, earned-run context.                        | Must identify affected advancement or reached-base result.                                     | Errors, unearned-run reconstruction, no-hit classification.                       | Recorded scorer judgment.                            |
| `InterferenceRecorded`      | Scorer judgment      | Records catcher, batter, runner, spectator, or defensive interference/obstruction.             | Responsible party, protected runner or batter, award, play reference, scorer judgment.                        | Bases, outs, score, fielding ledger.                        | Ruleset must define the award and whether the ball is live or dead.                            | CI/interference credits, no-AB treatment, RBI/earned-run context when applicable. | Recorded scorer judgment.                            |
| `CorrectionApplied`         | Correction           | Supersedes or reverses prior events.                                                           | Corrected event ids, replacement payload or reversal, actor, reason.                                          | Effective event stream and game status.                     | Cannot delete history; replacement must replay cleanly.                                        | All derived stats from superseded point forward.                                  | Recorded.                                            |

Derived facts include current inning, score, base state, box score lines, batting average, on-base percentage, earned run average, team totals, and season summaries. They may be cached as rebuildable projections later, but they must never be the source of truth.

## Plate Appearance Outcomes

Plate appearance outcomes classify the batter's completed turn. Runner movement during the same play is recorded separately as runner advances or runner outs linked to the plate appearance.

| Outcome                | Counts as PA | Counts as AB | Batter Credit                                                 | Required Extra Data                                                            | Runner Movement                                                             | Key Stat Effects                                                             |
| ---------------------- | ------------ | ------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Single                 | Yes          | Yes          | Hit, one-base hit.                                            | Hit location/class optional, fielders if relevant.                             | Batter to first unless out advancing; runners recorded independently.       | H, 1B, AVG/OBP/SLG, pitcher hit allowed.                                     |
| Double                 | Yes          | Yes          | Hit, two-base hit.                                            | Hit location/class optional; ground-rule or automatic flag when awarded.       | Batter to second unless out advancing or a ruleset award controls movement. | H, 2B, total bases.                                                          |
| Triple                 | Yes          | Yes          | Hit, three-base hit.                                          | Hit location/class optional.                                                   | Batter to third unless out advancing.                                       | H, 3B, total bases.                                                          |
| Home run               | Yes          | Yes          | Hit, home run.                                                | Inside-park flag optional, RBI eligibility.                                    | Batter scores; runners on base usually score.                               | H, HR, R, RBI, earned-run context.                                           |
| Walk                   | Yes          | No           | Base on balls.                                                | Intentional flag false.                                                        | Batter to first; forced runners advance.                                    | BB, OBP, pitcher walk allowed.                                               |
| Intentional walk       | Yes          | No           | Intentional base on balls.                                    | Intentional flag true.                                                         | Batter to first; forced runners advance.                                    | IBB, BB, OBP.                                                                |
| Hit by pitch           | Yes          | No           | Hit by pitch.                                                 | Pitcher, batter, award.                                                        | Batter to first; forced runners advance.                                    | HBP, OBP.                                                                    |
| Strikeout swinging     | Yes          | Yes          | Strikeout.                                                    | Swinging flag; dropped-third-strike state if applicable.                       | Batter out or reaches on uncaught third strike by explicit judgment.        | K, pitcher strikeout, catcher putout/assist context.                         |
| Strikeout looking      | Yes          | Yes          | Strikeout.                                                    | Looking flag; dropped-third-strike state if applicable.                        | Same as strikeout swinging.                                                 | K, pitcher strikeout.                                                        |
| Ground out             | Yes          | Yes          | Batted-ball out.                                              | Batted-ball class, fielders, out target.                                       | Runners may advance, score, or be put out by linked advances.               | AB, outs, putouts/assists, possible RBI.                                     |
| Fly out                | Yes          | Yes          | Batted-ball out.                                              | Batted-ball class, fielder catching ball.                                      | Runner advancement recorded separately.                                     | AB, putout, possible sacrifice fly/RBI if classified.                        |
| Line out               | Yes          | Yes          | Batted-ball out.                                              | Batted-ball class, fielder.                                                    | Runner advancement recorded separately.                                     | AB, putout.                                                                  |
| Pop out                | Yes          | Yes          | Batted-ball out.                                              | Batted-ball class, fielder.                                                    | Runner advancement recorded separately.                                     | AB, putout.                                                                  |
| Fielder's choice       | Yes          | Yes          | Reached by fielder's choice.                                  | Chosen out/attempt, fielders, runner retired or reason no out.                 | Batter reaches; runner effects explicit.                                    | PA, AB, no hit, possible RBI only under allowed scoring judgment.            |
| Reached on error       | Yes          | Yes          | Reached on error.                                             | Responsible fielder, error type, ordinary-effort judgment.                     | Batter reaches; runner effects explicit.                                    | PA, AB, no hit, fielder error, unearned-run context.                         |
| Sacrifice fly          | Yes          | No           | Sacrifice fly.                                                | Fly-ball out, runner scoring, RBI judgment.                                    | Batter out; runner scores after catch.                                      | SF, RBI when eligible, no AB.                                                |
| Sacrifice bunt         | Yes          | No           | Sacrifice bunt.                                               | Bunt classification, intended advance, fielders.                               | Batter usually out; runners advance.                                        | SH, no AB; RBI only under explicit valid judgment.                           |
| Double play            | Yes          | Usually Yes  | Outcome plus double-play participation.                       | Two outs, fielders, force/tag details.                                         | Multiple runner/batter outs.                                                | GDP when batter grounds into double play as applicable; fielding DP credits. |
| Triple play            | Yes          | Usually Yes  | Outcome plus triple-play participation.                       | Three outs, fielders, force/tag details.                                       | Multiple runner/batter outs.                                                | Fielding TP credits, batter stat classification.                             |
| Catcher's interference | Yes          | No           | Reached on interference.                                      | Responsible catcher, award, scorer judgment.                                   | Batter to first; forced runners advance.                                    | CI, no AB, OBP treatment per configured stat rule.                           |
| Other interference     | Ruleset      | Ruleset      | Reached, out, advance, or return by interference/obstruction. | Responsible party, protected runner or batter, award, live/dead-ball judgment. | Runner and out effects explicit.                                            | Stat effects come from ruleset and recorded scorer judgment.                 |

Ground-rule and automatic doubles use the `double` batter credit when the batter is credited with a hit. The award itself is recorded on the runner ledger, usually through `RunnerAwardRecorded` or linked `RunnerAdvanceRecorded` entries, so replay knows which runners are entitled to score or advance. If a ruleset awards two bases without hit credit, the event records the award without changing the batter credit to `double`.

### Batter Credit, Movement, and Fielding Credit

- Batter credit answers "what happened to the batter's plate appearance?"
- Runner movement answers "where did each runner start, end, score, or get put out?"
- Fielding credit answers "which defenders receive putouts, assists, errors, or double-play participation?"
- Pitcher responsibility answers "which pitcher is charged with the batter, baserunner, run, or inherited runner?"
- Statistic derivation combines those recorded judgments with replay state.

## Runner Advancement

Runner movement must be explicit whenever a runner changes base, scores, or is put out. A play with multiple moving runners records one movement entry per runner.

Each runner movement must include:

- Runner identity.
- Starting base: `batter`, `first`, `second`, or `third`.
- Ending base: `first`, `second`, `third`, or `home`; runner outs are recorded with `RunnerOutRecorded`.
- Responsible event id.
- Cause: forced advance, optional advance, steal, error, passed ball, wild pitch, balk, fielder's choice, hit advancement, sacrifice, defensive indifference, or correction.
- Whether the runner was forced.
- Whether the run or advancement is earned, unearned, or not yet classified when pitcher responsibility requires later replay.
- Out details when ending at `out`: base/location, force or tag, fielders, out number, and whether the out ends the inning.
- RBI eligibility judgment for scoring runners when the answer is not mechanically determined.

Rules:

- A walk or hit-by-pitch forces the batter to first and forces only runners who must advance because every following base is occupied.
- A runner may not pass another runner.
- A runner may not end on a base occupied by another runner after all play effects resolve.
- Temporary shared proximity during a rundown is not a base-occupancy state. Only the accepted post-play base state must satisfy single-runner-per-base invariants.
- A walk-off play records only the advances needed to end the game unless the ruleset requires all awarded bases to be credited.
- On inning-ending plays, runner advances and scoring must identify whether the run counts before or after the third out.
- Runs do not count when the third out is a force out on a runner who must advance, the batter-runner is retired before safely reaching first, or another ruleset-defined non-counting third out applies. Runs may count when they score before a non-force tag out or other counting third out. The source event must record this judgment instead of relying on timestamp order inside the play.
- Outs on bases are linked to the responsible play so double-play, caught-stealing, pickoff, and fielding credits can be derived.

### State Consistency Policies

The replay contract must classify difficult plays before M1 implementation:

- Bases loaded walks and hit-by-pitch awards are deterministic forced-advance plays after batter credit and award type are recorded.
- Dropped-third-strike handling is ruleset-dependent. The strikeout judgment is recorded; batter-runner entitlement to advance, wild-pitch or passed-ball attribution, and catcher putout context are recorded as component events.
- Batter-runner passing another runner, runner passing a base without legal touch, and appeals for missed bases are resolved through runner ledger and out events. The appeal itself is a play transaction whose ruleset determines timing, force status, and run-counting effect.
- Batting out of order is not inferred by replay. It is recorded as `BattingOrderAdjusted`, `CorrectionApplied`, or a future ruleset-specific appeal/correction event that states the accepted remedy.
- Force status is evaluated at the moment recorded by the out component within the play transaction. If a preceding component removes a force before a tag, the out component must record `force` as false.
- Sacrifice fly plays that also retire another runner record the batter out, scoring advance, extra runner out, out order, and whether the scoring run counts.
- A fielder's choice may record no out when the defense attempts a play on another runner and all runners are safe; the chosen play/attempt and no-hit batter credit remain recorded scorer judgments.
- Errors combined with subsequent advancement require separate runner ledger entries so earned-run reconstruction can distinguish the error-enabled base from later discretionary advances.
- Stolen-base attempts with throwing errors record the steal attempt/result, the error judgment, and any additional runner advances as components of one play transaction.
- Pickoffs with additional runner advancement record the pickoff result and every other runner movement in the same play transaction.
- Pitching changes record inherited runner responsibility before the next play transaction. Corrections that change responsible pitcher or earned-run context must invalidate affected pitching projections from the corrected sequence forward.
- Pitcher/designated-hitter substitution behavior is ruleset-dependent and intentionally deferred; the event contract requires lineup, defensive assignment, and pitcher responsibility to remain separable.
- Suspended games resume under the ruleset version and replay state recorded before suspension unless a correction or explicit migration records a different decision.

## Corrections and Replay

Corrections are append-only. The original event remains stored forever.

A correction event must include:

- Actor who made the correction.
- Timestamp.
- Human-readable reason.
- Events superseded or reversed.
- Replacement event payloads or reversal instructions.
- Review state after correction.
- Optional reviewer notes.
- Projection invalidation scope.

Replay rules:

- Replaying all original events without correction metadata reconstructs the historical scoring record.
- Replaying the effective event stream applies supersession and reversal relationships to produce current game state and statistics.
- A correction may supersede one event, a range of dependent events, or a scorer judgment inside an event.
- Superseded events remain addressable for audit, but they do not affect current derived state.
- A corrected verified game is excluded from verified season-stat inclusion until it is re-verified.

Completed but unverified games may be corrected by appending `CorrectionApplied`. Verified games must first append `GameReopened`, then the correction, then a later `GameVerified` event when review accepts the rebuilt results. Re-verification is itself an auditable source event, not a silent metadata toggle.

Correcting a complete play transaction replaces or reverses every component needed to make the post-play state valid. Correcting a scorer judgment keeps the play state intact and changes only the recorded judgment path, such as hit versus error, sacrifice classification, RBI eligibility, earned-run context, or fielding credit. If a judgment correction changes state, responsibility, or later preconditions, it must be promoted to a component-range or complete-play correction.

Any accepted correction invalidates rebuildable projections from the earliest affected sequence through the end of the affected game, and season/team/player projections that include that game. Cached projections may be retained only with a revision marker proving they were rebuilt from the current effective event stream.

## Statistics Boundaries

The implemented issue #11 formulas, exact numeric representation, event-schema v2 earned-run judgment, correction behavior, supported season boundary, and explicit unsupported cases are documented in [STATISTIC_DERIVATION.md](STATISTIC_DERIVATION.md). This implementation note narrows representability gaps without changing the source-authority rules below.

Recorded source facts:

- Plate appearance outcome and scorer judgment.
- Runner advances, scoring, and outs.
- Fielder putout, assist, error, and double-play/triple-play judgment when not mechanically inferred.
- Pitcher of record for each plate appearance and pitcher responsibility for inherited runners.
- Earned/unearned context where a scoring rule requires scorer interpretation.
- Correction, verification, and review metadata.

Derived facts:

- Current score, inning, outs, base state, next batter, and active pitcher.
- Box score lines.
- Batting totals: PA, AB, H, 1B, 2B, 3B, HR, R, RBI, BB, IBB, HBP, K, SF, SH, SB, CS, AVG, OBP, SLG, OPS.
- Pitching totals: batters faced, hits, runs, earned runs, walks, strikeouts, HBP, HR allowed, innings pitched, ERA, WHIP.
- Fielding totals: putouts, assists, errors, double plays, triple plays, passed balls when applicable.
- Winning pitcher, losing pitcher, saves, holds, and similar pitching decisions when a future ruleset enables them.
- Team and season summaries.

Ambiguous classifications:

- At-bat versus plate appearance is derived from recorded batter credit and ruleset version.
- Hits and reached-on-error are mutually exclusive batter credits.
- Sacrifices require explicit scorer classification; they are not inferred only from runner movement.
- RBI eligibility is recorded when ambiguous and deterministic when mechanical; awarded RBI totals are derived from the eligibility, runner scoring ledger, and ruleset.
- Earned versus unearned runs require recorded error and passed-ball judgments plus replay under pitching responsibility rules.
- Team versus individual unearned-run treatment is ruleset-dependent; the source stream records enough error, passed-ball, pitcher-responsibility, and run-scoring context to derive it later.
- Inherited runners remain the responsibility of the pitcher who allowed them to reach base unless ruleset configuration says otherwise.
- Double-play credits require the outs, fielders, and play relationship to be recorded clearly enough to derive batting and fielding credits.

## Required Case Coverage

| Case                                         | Semantic Resolution                                                                                                                                |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hits by base value                           | `PlateAppearanceRecorded` outcome records single, double, triple, or home run; runner advances remain explicit.                                    |
| Walks and intentional walks                  | Walk outcome records intentional flag; batter and forced runners advance through runner ledger.                                                    |
| Hit by pitch                                 | HBP outcome records batter award; forced runner advances are explicit.                                                                             |
| Strikeouts                                   | Strikeout outcome records swinging/looking and dropped-third-strike context; batter reaching safely requires explicit runner advance and judgment. |
| Reached on error                             | Batter credit and `ErrorRecorded` are source judgments; no hit is derived.                                                                         |
| Fielder's choice                             | Batter credit, chosen out/attempt, and runner effects are recorded; no hit is derived.                                                             |
| Sacrifice bunt/fly                           | Sacrifice classification is a recorded scorer judgment; AB exclusion and RBI treatment are derived from that judgment and ruleset.                 |
| Catcher and other interference               | `InterferenceRecorded` captures responsible party, award, and live/dead-ball judgment; stat treatment comes from ruleset.                          |
| Ground-rule or automatic double              | Double credit is recorded only when the batter receives a hit; awards and runner entitlements are recorded separately.                             |
| Wild pitch, passed ball, and balk            | `RunnerAwardRecorded` records award type, responsible player/rule, affected runners, and earned-run context.                                       |
| Stolen base, caught stealing, pickoff        | Specialized events record attempt/result; runner ledger records the base or out effect.                                                            |
| Standalone runner advances                   | `RunnerAdvanceRecorded` can be linked to a plate appearance or recorded as an independent runner event.                                            |
| Force outs and tag outs                      | `RunnerOutRecorded` records target, location, fielders, and force/tag judgment.                                                                    |
| Double and triple plays                      | Multiple out records share one responsible event and fielding path; DP/TP credits are derived when ruleset conditions match.                       |
| Runs during third-out situations             | Runner ledger records whether each scoring advance counts when the third out creates ambiguity.                                                    |
| Substitutions and defensive-position changes | `DefensiveSubstitutionMade`, `DefensiveAlignmentChanged`, and `PitchingChangeMade` separate batting order, defense, and pitcher responsibility.    |
| Courtesy or special runners                  | `SpecialRunnerPlaced` is enabled only by a ruleset that defines eligibility, replacement, reentry, and run responsibility.                         |
| Game lifecycle                               | Game-created, ready, started, suspended, resumed, completed, verified, reopened, abandoned, and cancelled events govern status.                    |
| Corrections and supersession                 | `CorrectionApplied` appends reversal or replacement relationships; original source events remain stored for audit.                                 |

## Configurable Rules

The vocabulary must support these extension points even when the MVP does not implement every option:

| Extension Point            | Vocabulary Requirement                                                                                                                                |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Continuous batting order   | Batting-order events must support more than nine active batting slots and substitutions that affect defense without removing a batter from the order. |
| Free substitutions         | Defensive substitution events must separate defensive eligibility from batting-order replacement.                                                     |
| Mercy rules                | Game-completion events must accept rule-defined early endings and final-state confirmation.                                                           |
| Time limits                | Game-completion and suspension events must record time-limit reasons without corrupting inning state.                                                 |
| Extra-inning runners       | Inning-start events must support rule-awarded runners with responsibility and earned-run treatment.                                                   |
| Pitch-count limits         | Pitching-change and pitch-tracking extensions must be attachable without changing plate-appearance semantics.                                         |
| Shortened games            | Verification must distinguish official shortened games from abandoned games.                                                                          |
| League-specific statistics | Stat derivation must be versioned by ruleset so historical reports can be recalculated consistently.                                                  |

## Representative Examples

These examples are intentionally compact. They show the minimum source events needed to replay state and identify which statistics are recorded judgments versus derived totals.

### Routine Plate Appearance With Runner Advancement

Situation: Top 1st, one out, Runner R1 on second. Batter A singles to right and R1 scores.

Before:

| Inning | Outs | Bases        | Score |
| ------ | ---- | ------------ | ----- |
| Top 1  | 1    | R1 on second | 0-0   |

Recorded source events:

- `PlateAppearanceRecorded`: Batter A, Pitcher X, outcome `single`, batted-ball `line_drive`.
- `RunnerAdvanceRecorded`: Batter A from `batter` to `first`, cause `hit`, responsible event is the plate appearance.
- `RunnerAdvanceRecorded`: R1 from `second` to `home`, cause `hit_advancement`, RBI eligible `true`.

After replay:

| Inning | Outs | Bases       | Score          |
| ------ | ---- | ----------- | -------------- |
| Top 1  | 1    | Batter A 1B | Away 1, Home 0 |

Recorded statistic judgments: batter credit `single`; R1 scoring advance; RBI eligibility.

Derived statistics: Batter A PA +1, AB +1, H +1, 1B +1, RBI +1; R1 R +1; Pitcher X BF +1 and H allowed +1; away score +1.

### Fielder's Choice, Batter Safe

Situation: Top 2nd, no outs, Runner R2 on first. Batter B grounds to shortstop; defense retires R2 at second while Batter B reaches first.

Before:

| Inning | Outs | Bases       | Score |
| ------ | ---- | ----------- | ----- |
| Top 2  | 0    | R2 on first | 1-0   |

Recorded source events:

- `PlateAppearanceRecorded`: Batter B, Pitcher X, outcome `fielder_choice`, batted-ball `ground_ball`.
- `RunnerOutRecorded`: R2 from `first` out at `second`, force out, fielders shortstop to second baseman, first out of play.
- `RunnerAdvanceRecorded`: Batter B from `batter` to `first`, cause `fielder_choice`.

After replay:

| Inning | Outs | Bases       | Score |
| ------ | ---- | ----------- | ----- |
| Top 2  | 1    | Batter B 1B | 1-0   |

Recorded statistic judgments: batter credit `fielder_choice`; force-out path and fielders; no-hit classification.

Derived statistics: Batter B PA +1 and AB +1, no H; one team out; fielder putout/assist credits; no RBI unless a scoring runner and ruleset/scorer judgment allow it.

### Reached on Error

Situation: Bottom 3rd, no outs, Runner R3 on second. Batter C hits a ground ball that the shortstop misplays under ordinary-effort judgment; R3 reaches third.

Before:

| Inning   | Outs | Bases        | Score |
| -------- | ---- | ------------ | ----- |
| Bottom 3 | 0    | R3 on second | 1-0   |

Recorded source events:

- `PlateAppearanceRecorded`: Batter C, Pitcher Y, outcome `reached_on_error`, batted-ball `ground_ball`.
- `ErrorRecorded`: shortstop, fielding error, responsible for Batter C reaching.
- `RunnerAdvanceRecorded`: Batter C from `batter` to `first`, cause `error`.
- `RunnerAdvanceRecorded`: R3 from `second` to `third`, cause `error`.

After replay:

| Inning   | Outs | Bases              | Score |
| -------- | ---- | ------------------ | ----- |
| Bottom 3 | 0    | Batter C 1B, R3 3B | 1-0   |

Recorded statistic judgments: reached-on-error batter credit; responsible fielder and error type; ordinary-effort judgment.

Derived statistics: Batter C PA +1 and AB +1, no H; shortstop E +1; earned-run reconstruction treats the error according to ruleset replay.

### Sacrifice Fly

Situation: Top 4th, one out, Runner R4 on third. Batter D flies out to center; R4 scores after the catch.

Before:

| Inning | Outs | Bases       | Score |
| ------ | ---- | ----------- | ----- |
| Top 4  | 1    | R4 on third | 1-0   |

Recorded source events:

- `PlateAppearanceRecorded`: Batter D, Pitcher Y, outcome `sacrifice_fly`, batted-ball `fly_ball`, fielder center field.
- `RunnerOutRecorded`: Batter D from `batter` out on caught fly ball, second out of inning.
- `RunnerAdvanceRecorded`: R4 from `third` to `home`, cause `sacrifice_fly`, RBI eligible `true`, run counts `true`.

After replay:

| Inning | Outs | Bases | Score          |
| ------ | ---- | ----- | -------------- |
| Top 4  | 2    | Empty | Away 2, Home 0 |

Recorded statistic judgments: sacrifice-fly classification; RBI eligibility; putout fielder; run-counting judgment.

Derived statistics: Batter D PA +1, SF +1, no AB, RBI +1; R4 R +1; center fielder putout +1; score +1.

### Inning-Ending Double Play With Third-Out Run Judgment

Situation: Bottom 5th, one out, Runner R5 on third and Runner R6 on first. Batter E grounds to shortstop; R6 is forced at second and Batter E is retired at first. R5 crosses home during the play.

Before:

| Inning   | Outs | Bases              | Score |
| -------- | ---- | ------------------ | ----- |
| Bottom 5 | 1    | R5 on third, R6 1B | 2-0   |

Recorded source events:

- `PlateAppearanceRecorded`: Batter E, Pitcher X, outcome `ground_into_double_play`, batted-ball `ground_ball`.
- `RunnerOutRecorded`: R6 from `first` out at `second`, force out, first out of play.
- `RunnerOutRecorded`: Batter E from `batter` out at `first`, second out of play and third out of inning.
- `RunnerAdvanceRecorded`: R5 from `third` to `home`, cause `in_play_advance`, run counts `false` because the inning-ending out retired the batter-runner before first.
- `FieldingCreditRecorded`: shortstop, second baseman, and first baseman double-play participation.

After replay:

| Inning | Outs | Bases | Score |
| ------ | ---- | ----- | ----- |
| Top 6  | 0    | Empty | 2-0   |

Recorded statistic judgments: ground-ball double-play classification; force out; batter-runner third out before first; R5 run-counting judgment `false`; fielding path.

Derived statistics: Batter E PA +1, AB +1, GIDP +1 when ruleset conditions apply; two outs; no run added; fielding putout/assist/double-play credits.

### Stolen Base and Caught Stealing

Situation A: Top 6th, no outs, Runner R7 on first. R7 steals second during Batter F's plate appearance.

Before:

| Inning | Outs | Bases       | Score |
| ------ | ---- | ----------- | ----- |
| Top 6  | 0    | R7 on first | 2-0   |

Recorded source events:

- `StolenBaseAttemptRecorded`: R7 from `first` to `second`, result `safe`, pitcher/catcher context.
- `RunnerAdvanceRecorded`: R7 from `first` to `second`, cause `steal`.

After replay:

| Inning | Outs | Bases        | Score |
| ------ | ---- | ------------ | ----- |
| Top 6  | 0    | R7 on second | 2-0   |

Recorded statistic judgments: steal attempt and result.

Derived statistics: R7 SB +1; base state changes; no batter PA yet.

Situation B: Same base state, but R7 is thrown out at second.

Recorded source events:

- `StolenBaseAttemptRecorded`: R7 from `first` to `second`, result `out`, fielders catcher to shortstop.
- `RunnerOutRecorded`: R7 from `first` out at `second`, tag out, first out of inning.

After replay:

| Inning | Outs | Bases | Score |
| ------ | ---- | ----- | ----- |
| Top 6  | 1    | Empty | 2-0   |

Recorded statistic judgments: caught-stealing attempt and fielder path.

Derived statistics: R7 CS +1; one out; catcher assist and shortstop putout.

### Scoring Correction

Original scoring: Top 7th, one out, Runner R8 on second. Batter G is credited with a single and R8 scores.

Correction: Official review changes the play to reached on error by left fielder.

Before correction replay:

| Inning | Outs | Bases       | Score          |
| ------ | ---- | ----------- | -------------- |
| Top 7  | 1    | Batter G 1B | Away 3, Home 0 |

Original source events remain stored:

- `PlateAppearanceRecorded`: Batter G, outcome `single`.
- `RunnerAdvanceRecorded`: Batter G from `batter` to `first`, cause `hit`.
- `RunnerAdvanceRecorded`: R8 from `second` to `home`, cause `hit_advancement`, RBI eligible `true`.

Correction source events:

- `GameReopened`: reason `scoring review`.
- `CorrectionApplied`: supersedes the original plate appearance and dependent runner advances with replacement payloads.
- Replacement `PlateAppearanceRecorded`: Batter G, outcome `reached_on_error`.
- Replacement `ErrorRecorded`: left fielder, fielding error, responsible for Batter G reaching.
- Replacement `RunnerAdvanceRecorded`: Batter G from `batter` to `first`, cause `error`.
- Replacement `RunnerAdvanceRecorded`: R8 from `second` to `home`, cause `error`, RBI eligible `false`, run counts according to earned-run replay.

After effective replay:

| Inning | Outs | Bases       | Score          |
| ------ | ---- | ----------- | -------------- |
| Top 7  | 1    | Batter G 1B | Away 3, Home 0 |

Recorded statistic judgments: original and replacement scorer judgments, supersession links, correction actor, timestamp, and reason.

Derived statistics:

- Effective stats remove Batter G's hit, total base, and RBI.
- Left fielder receives error.
- Earned-run reconstruction is recalculated.
- Game status becomes `corrected` until re-verified.

## Official-Scoring Follow-Ups

The vocabulary above records the scorer judgments needed for deterministic replay. These policy questions should be answered before implementing full scoring fixtures and UI shortcuts:

- Exact RBI handling for fielder's choice, error, double play, and interference cases.
- Dropped-third-strike distinctions across strikeout, reached-base, wild pitch, passed ball, and catcher putout credits.
- Earned-run reconstruction rules for innings extended by errors, passed balls, and catcher's interference.
- League-specific handling of defensive indifference versus stolen base.
- Youth-league handling of continuous batting order, free substitution, mercy rules, and time limits.
- Whether pitch-level events are required in the MVP or can remain an extension for pitch-count support.
