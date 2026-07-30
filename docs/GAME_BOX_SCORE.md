# Game box score

## Purpose

The game box score is a versioned, Account-scoped report derived from the
accepted setup snapshot and current effective event history. It is not a new
source of baseball truth. Corrections, lifecycle transitions, and verification
remain immutable events.

The report is available at `/games/{gameId}/box-score` to members with
`report.view` authorization for the exact Account and game.

## Data contract

Every report includes:

- Account, game, and setup-snapshot identity;
- setup and source revisions;
- correction count and latest correction revision;
- statistic derivation and statistic-rules versions;
- ruleset version;
- current privacy-overlay revision;
- verification and lifecycle state;
- source-derived freshness and optional exact projection-checkpoint freshness;
- generated timestamp;
- team and opponent snapshot names;
- lineup participation and current-position state;
- batting, pitching, and fielding player lines and team totals;
- inning lines and current or final score; and
- explicit reconciliation status and checks.

An in-progress or suspended score is labeled current and provisional. Completed,
corrected, and verified reports are labeled final. Abandoned and cancelled
reports are labeled terminated rather than final.

## Freshness

The report rebuilds statistics from accepted source history for every request.
Its `CURRENT_SOURCE_DERIVED` label means the history revision was compared with
the current game revision while report presentation was loaded.

A stored projection checkpoint is attached only when all of these match:

- Account and game;
- source revision;
- privacy-overlay revision;
- statistic derivation version;
- game projection scope; and
- `CURRENT` checkpoint status.

The report does not consume aggregate payloads from stale checkpoints. A
supplied mismatched checkpoint fails with `STALE_PROJECTION`; no stale numbers
are silently rendered.

## Reconciliation

Report construction fails closed unless:

- every batting counter sums from player lines to team totals;
- every pitching counter sums from player lines to team totals;
- every fielding counter sums from player lines to team totals;
- inning runs equal the displayed score;
- batting hits equal opponent pitching hits allowed;
- fielding errors reconcile with player credits;
- pitching outs reconcile with pitcher lines;
- report setup and source revisions match replay; and
- the statistic derivation version is current.

The underlying statistic derivation boundary additionally reconciles batting,
pitching, fielding, runs, hits, outs, and attribution while replaying effective
events.

## Report states

- `DRAFT` — accepted ready setup with no started game.
- `IN_PROGRESS` — provisional live report.
- `SUSPENDED` — provisional suspended report.
- `COMPLETED` — final score awaiting first verification.
- `CORRECTED` — corrected final score that has never been verified.
- `AWAITING_REVERIFICATION` — a previously verified game was reopened and
  corrected.
- `VERIFIED` — the displayed source revision is verified.
- `ABANDONED` — terminated without a verified final result.
- `CANCELLED` — cancelled before play.

Correction count and revision remain visible even after reverification.

## Verification and reverification

The report offers an action only for eligible lifecycle states:

- completed games use `game.verify`;
- corrected or awaiting-reverification games use `game.reverify`.

The action requires exact Account/game authorization, same-origin validation,
the selected Account cookie, stable idempotency identity, current source
revision, and an explicit confirmation checkbox. The event reducer remains the
final lifecycle authority. Any concurrent scoring or correction change causes
a stale-revision failure and requires a fresh review.

No public sharing or publishing is implemented.

## Privacy

Accepted setup names are never mutated. Presentation resolves
`PLAYER_DISPLAY_NAME` fields through Account-scoped append-only privacy overlays
in effective order. A lineup-slot-specific replacement or player-level
replacement changes only the displayed report identity. Baseball replay,
statistics, and source revision do not change.

The privacy-overlay revision is part of both report and projection freshness.
Contacts, private player fields, raw event payloads, and security-audit records
are not included.

## Responsive, accessible, and print behavior

Lineups and statistics use semantic tables with captions, column headers, and
row headers. Narrow viewports retain the table and its header relationships in
a horizontal overflow region instead of converting data into unrelated divs.
Verification state and warnings use text, not color alone. Interactive controls
have keyboard-native labels and minimum touch-target sizing.

The route includes print-oriented spacing, hides interactive controls when
printing, and avoids team-section breaks where practical. Export and formally
designed print artifacts remain future scope.

## M3 extension points

M3 may add dashboards, comparison views, exports, public-sharing policy, and
cached report payloads. Those consumers must preserve this version contract,
privacy overlay resolution, freshness checks, reconciliation boundary, and
authorization model.
