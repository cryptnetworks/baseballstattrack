# Live substitutions and pitching changes

Issue #19 adds lineup, runner, defensive-position, and pitching changes to the
live scorekeeping route. Every accepted change is an immutable typed event tied
to the current setup snapshot, inning state, source revision, and Account/game
authorization boundary. The accepted setup snapshot is never edited.

## Supported changes

The live panel offers four focused flows:

- **Batter / runner** records a pinch hitter, pinch runner, or other batting-side
  replacement with `DefensiveSubstitutionMade`. The incoming player inherits the
  outgoing batting slot and future defensive role. A pinch runner also replaces
  the outgoing runner on base while retaining the pitcher responsible for that
  runner.
- **Defensive replacement** uses the same typed substitution event for the
  fielding side. The leaving player becomes inactive and the unused, eligible
  player enters the batting slot and selected defensive role.
- **Position swap** records one `DefensiveAlignmentChanged` event containing
  both assignments. Batting order is unchanged, and the swap either validates
  and accepts completely or does not alter state.
- **Pitching change** records `PitchingChangeMade` with the exact outgoing
  pitcher and all occupied-base runner identifiers. The event begins the
  incoming appearance and preserves each inherited runner's existing pitcher
  responsibility. If an active defender moves to pitcher, the outgoing pitcher
  takes that defender's prior role in the same atomic change; an unused incoming
  player instead replaces the outgoing pitcher's batting slot.

The MVP ruleset uses permanent substitution: a player already listed in
`participatedPlayers` cannot reenter after becoming inactive. Courtesy runners
and ruleset-specific free substitution remain unavailable until a ruleset
defines their eligibility and statistical treatment.

## Authoritative state and effective point

The panel receives state from strict replay of one accepted setup snapshot and
its effective ordered event history. It displays the inning/half, outs, current
batter, on-deck batter, active pitcher, occupied bases, and source revision. The
effective point is the event accepted immediately after that replay state.

The browser creates a local typed proposal and previews it with the same pure
reducer used by authoritative replay. The preview never changes accepted state.
After server acceptance, route revalidation reloads the event history and
reconciles lineup, defense, pitcher, and derived statistics from replay.

## Validation

Replay rejects:

- a player who is inactive, already active, on the other game side, or
  prohibited from reentry;
- a substitution that removes the active pitcher instead of using the pitching
  change event;
- a defensive role collision or an alignment that displaces a player not
  included in the atomic alignment change;
- duplicate players or positions in one alignment;
- an alignment with no valid active pitcher;
- a pitching change for the batting side, the wrong outgoing pitcher, a missing
  or ineligible incoming pitcher, or incomplete inherited-runner evidence;
- an active incoming pitcher that would remove an occupied batting slot without
  a replacement;
- a stale source revision, wrong setup/game/Account, or non-live lifecycle; and
- a changed payload retried with a previously used idempotency key.

These rules are reducer behavior, not UI-only checks. Corrections and historical
replay therefore use the same validation.

## Pitching presentation and statistics

Before confirmation, the pitching flow shows the pitcher leaving and entering,
current batter, outs, inherited-runner count, inning/half, and source revision.
The resulting preview shows the incoming pitcher in the active lineup and
defense.

The UI does not calculate a pitching line. Statistic derivation consumes the
effective event stream: `PitchingChangeMade` starts one appearance and records
the inherited-runner count, while later plate appearances and runner movements
credit batters faced, outs, hits, walks, runs, and inherited runners scored.
Runners on base retain the pitcher responsibility established when they
reached.

## Confirmation, retry, and reconciliation

Each flow requires an explicit confirmation of the leaving player, entering
player, role, and effective game state. One server action submits one event with
one client submission identity. Controls lock while submitting.

On a retryable or uncertain failure, the proposed change remains fixed so
`Retry unchanged change` reuses the same identity. The scorer may instead reload
authoritative state or discard the failed change. A stale response revalidates
the route. No multi-event sequence is used for a position swap or pitching
change, so partial acceptance cannot leave half a proposed change applied.

## Accessibility and field use

Change-type buttons, selects, confirmation, and action buttons use native
keyboard semantics and minimum 48-pixel heights. Labels name every leaving and
entering player, batting slot, and role. Status and errors use live regions and
text rather than color alone. Before/after lineups remain readable in one
column on portrait phones and form a side-by-side comparison on larger screens.

The screen deliberately separates lineup changes from the frequent
plate-appearance controls. It does not add substitution choices to the primary
outcome grid or calculate statistics independently in the browser.
