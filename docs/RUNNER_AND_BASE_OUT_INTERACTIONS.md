# Runner and base-out interactions

Issue #18 adds the scorer-facing runner interaction boundary without adding the
plate-appearance entry surface owned by issue #17. The live route is
`/games/score/[gameId]`. It enters scoring from the exact accepted
`GameSetupSnapshot`, its setup revision, and the current source revision. Every
render reloads authoritative state by replaying accepted history.

## Interaction model

The page shows named, textual base occupancy alongside the visual diamond. For
each occupied base, the scorer may leave the runner in place, advance the
runner, score the runner, or record an out when the selected play type permits
one. The preview shows before and proposed-after bases, outs before and after,
runs, runner identity, optional-movement classification, pitcher
responsibility, earned-run judgment for a scoring runner, and required
fielding attribution.

Walks, hits, and other batter results continue to use the canonical
`PlateAppearanceRecorded` runner ledger. Its forced and optional movements are
validated simultaneously. Issue #18 does not expose those batter-result
controls; issue #17 will compose the same base-out interaction concepts into
the fast plate-appearance surface.

## Atomic proposal

One form submission produces one `RunnerPlayRecorded` schema-v3 event and one
play transaction. Every changed runner is included in its `movements` array.
The client never submits runner components independently. Server acceptance
strict-replays the expected pre-play revision, validates the complete event,
and persists the transaction and source event together. Any invalid component
rejects the entire proposal and reserves no partial event or idempotency key.

Successful acceptance revalidates the route. The displayed diamond is then
rebuilt from server replay rather than trusting the optimistic preview. A
stale source revision returns a recoverable message and the current
authoritative state.

## Supported vocabulary

Schema v3 adds `RunnerPlayRecorded` for standalone, potentially multi-runner
plays:

- optional advances;
- advances caused by a fielding error, with an explicit error credit;
- stolen bases and caught stealing;
- pickoffs, including another runner moving in the same atomic play;
- other runner outs, including inning-ending outs;
- wild pitches;
- passed balls, with the active catcher identified; and
- scoring movements with explicit run-counting, RBI-ineligible, responsible
  pitcher, and earned/unearned/pending judgments.

Existing `PlateAppearanceRecorded`, `RunnerAdvanceRecorded`,
`RunnerOutRecorded`, and `StolenBaseAttemptRecorded` events remain replayable.
Versions 1 and 2 are unchanged. Schema v3 statistics derive runs, earned runs,
SB, CS, pitcher outs, putouts, assists, and errors from runner plays. Wild-pitch
and passed-ball counting statistics are not yet emitted because the statistic
projection has no WP/PB counters.

## Validation

The typed payload and reducer reject duplicate runners, duplicate origins or
destinations, absent runners, occupied destinations that are not freed in the
same play, backward movement, contradictory score/out shapes, invalid
fielders, wrong pitcher responsibility, invalid passed-ball catcher
attribution, impossible out order, a fourth out, and a counting run when the
third out is a force out. Forced safe advances must form a complete trailing
occupied-base chain.

Account, game, setup-snapshot, ruleset, sequence, source revision, actor scope,
and state-hash checks remain part of ordinary event acceptance. An event for
another Account or game, a stale proposal, or an idempotency-key collision
fails closed.

## Innings and endings

The reducer owns the third-out transition. It clears the bases, resets outs,
changes batting side, and increments the inning after the bottom half. The
scheduled inning count comes from the accepted setup; no UI or reducer path
hard-codes nine innings. Ordinary extra innings therefore replay without a
special case.

The preview may identify that a proposed bottom-half run would create a
walk-off score condition, but it does not complete the game. The server must
first accept the play and then accept the explicit canonical `GameCompleted`
event against the resulting authoritative state. Regulation and walk-off
validity remain domain decisions.

## Accessibility

The diamond is supplemental and hidden from assistive technology. Named
`first`, `second`, and `third` entries expose runner identity and empty bases in
text. Native labels and selects provide keyboard and touch operation, controls
use large targets, and color is never the only state indicator. Polite live
regions announce accepted status and proposed changes such as a runner moving,
a run scoring, the out count, or the inning ending.

## Unsupported cases

Issue #18 does not add the issue #17 plate-appearance entry surface, pitch-level
tracking, balks, appeals, defensive-indifference policy, dropped-third-strike
variants, courtesy runners, substitutions, or lineup correction. League
specific automatic extra-inning runners remain unsupported because their
eligibility, replacement, pitcher responsibility, and earned-run policy require
an explicit ruleset contract. No default tiebreak-runner policy is inferred.
