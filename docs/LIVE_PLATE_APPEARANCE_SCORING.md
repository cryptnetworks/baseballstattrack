# Live plate-appearance scoring

Issue #17 adds the batter-result surface to `/games/score/[gameId]`. It composes
the issue #18 runner/base-out model into the existing atomic
`PlateAppearanceRecorded` event. Setup remains immutable after first pitch, and
the page never derives accepted state from client controls.

## Screen model

The persistent game header shows inning and half, score, outs, and the
authoritative source revision. The plate-appearance area shows the current
batter, on-deck batter, active pitcher, save status, last accepted action, and
available next actions. Named before/after base occupancy supplements the
visual diamond.

The current batter, on-deck batter, pitcher, lineup, bases, score, inning, and
outs come from strict replay of one accepted setup snapshot and its ordered
event history. A successful action revalidates the route and remounts the
editor at the new source revision. The optimistic preview is discarded in
favor of the replayed result.

## Outcome hierarchy

The primary grid contains the frequent choices:

- in-play out;
- strikeout;
- walk;
- hit by pitch;
- single, double, triple, and home run;
- reached on error; and
- fielder's choice.

Intentional walk, looking strikeout, sacrifice bunt/fly, and interference live
under `More outcomes`. Batted-ball type, fielder attribution, runner movement,
force judgment, RBI eligibility, and earned-run classification appear only
after the selected result needs them. Runner-only events remain in the
separate issue #18 section on the same page.

## Tap-efficiency review

Counts start after the live page is open and include the final record action.
They are approximate because a scorer may review or change defaults:

| Flow                                | Typical interactions | Notes                                                        |
| ----------------------------------- | -------------------: | ------------------------------------------------------------ |
| Strikeout                           |                    3 | outcome, catcher/putout, record                              |
| Routine ground-ball out             |                    3 | outcome, putout, record; ground ball is the default          |
| Walk, bases empty                   |                    2 | outcome, record                                              |
| Single, bases empty                 |                    2 | outcome, record                                              |
| Single with ordinary runner advance |                    2 | one-base runner defaults are prefilled and reviewed          |
| Single with changed runner advance  |                    3 | outcome, change runner result, record                        |
| Home run                            |                    2 | outcome, record; all occupied runners default to score       |
| Reached on error                    |                    3 | outcome, error fielder, record                               |
| Ground-ball double play             |                    4 | out, runner out, putout, record; force defaults are editable |
| Stolen base                         |                    4 | runner-only jump, classification, destination, record        |

The primary friction that remains is fielder selection for every out. It is
intentional because missing putout attribution makes statistics incomplete.
The page does not add a confirmation dialog to routine plays. Complex plays
receive an inline before/after review without another modal tap.

## Atomic commit flow

1. The editor starts from the replayed source revision.
2. Outcome selection creates a typed local proposal.
3. Outcome-specific runner and attribution fields appear.
4. Forced walk/HBP chains and ordinary hit advances receive editable defaults.
5. Client validation checks occupancy, direction, passing, out count, force
   third-out run handling, batter/runner resolution, and required attribution.
6. One server action submits one `PlateAppearanceRecorded` event with one
   idempotency key.
7. PostgreSQL acceptance authorizes the exact Account/game, strict-replays the
   expected revision, and persists the play transaction and event atomically.
8. The route reloads replayed state and advances batter context.

The submit control is disabled while pending, preventing an ordinary
double-click from submitting twice. An exact retry retains the original
idempotency key and returns the already accepted event. Editing a proposal
requires discarding it and choosing a new result; the next authoritative
revision remount creates a new submission identity.

## Error recovery

Domain errors are mapped to bounded, actionable messages for stale revision,
runner conflict, impossible baseball transition, changed lineup/batter,
pitcher mismatch, lifecycle change, changed-payload idempotency collision, and
authorization denial. A rejected proposal stays editable. The scorer may retry
the same proposal, reload authoritative state, or discard it.

A stale response explicitly revalidates server state. If another scorer,
correction, substitution, or game completion changed the revision, the editor
reconciles from that new state rather than silently applying the old proposal.
A transport failure does not create a second local key; retrying the still
mounted draft uses the same key. Persisting drafts across refresh, sleep, and
offline periods belongs to issue #20.

## Accessibility and responsive behavior

Outcome and record controls use at least 48–56 pixel minimum heights and a
two-column phone grid that expands at larger breakpoints. Native buttons,
selects, checkboxes, fieldsets, legends, and labels work with touch and
keyboard. Each outcome advertises an `aria-keyshortcuts` value. Selection moves
focus to the proposal detail, and action results move focus to the polite
status region.

The status text says `Saved`, `Saving`, or `Needs attention` and never relies on
color alone. Named base occupancy exposes every runner to screen readers; the
decorative diamond is hidden. A separate live region announces runner results,
run scoring, inning completion, and next-batter context.

## Extension points

Issue #19 can add substitution and pitching-change actions around the same
authoritative state header and revision boundary. It must update replayed
lineup/defense/pitcher state rather than modifying setup snapshots or this
proposal locally.

Issue #20 can persist the existing typed, Account/game/setup/revision-scoped
proposal plus idempotency key and schema marker for interruption recovery. It
must not treat local storage as accepted history or blindly replay a queue.
Broad offline conflict merging remains outside this screen.
