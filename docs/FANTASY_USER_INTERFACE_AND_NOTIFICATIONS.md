# Fantasy user interface and notifications

Issue [#127](https://github.com/cryptnetworks/baseballstattrack/issues/127)
completes the M8 fantasy read and control surface. It presents the immutable
rules, domain, transaction, and scoring contracts from #123–#126 without adding
a second source of baseball truth. [ADR 0017](decisions/0017-account-scoped-fantasy-experience-persistence.md)
records the persistence and delivery boundary.

## Experience model

The `/fantasy` workspace is available only after an authenticated user selects
an Account. It provides:

- an Account-scoped league chooser and administrator-only league creation;
- league status, lineup deadline, roster health, and next-action summary;
- fantasy team and roster views that resolve display names from canonical
  baseball players through current privacy overlays;
- atomic lineup swap, drop, and daily-waiver submission controls;
- append-only transaction history;
- matchup, category/point, standings, correction, and uncertainty views;
- recipient-controlled transaction, score, and final-matchup notifications;
- commissioner pause, resume, archive, deletion-request, week-reset-review,
  approval, and dispute controls; and
- a privacy-filtered commissioner export.

The browser never receives stored destination references, private player
fields, authorization evidence, credentials, or raw baseball events.

```text
verified baseball events
  -> versioned statistics
  -> immutable fantasy model
  -> append-only roster snapshots
  -> versioned fantasy results
  -> Account-authorized presentation and notifications
```

There is no reverse edge. A league control, roster submission, result display,
notification, or export cannot mutate a baseball player, event, statistic,
verification state, ruleset binding, or correction.

## Persistence and atomicity

`FantasyLeagueWorkspace` is the current Account-owned aggregate projection. It
stores the exact season, owner membership, immutable model version/digest,
lineup deadline, lifecycle, monotonic revision, and validated #123/#124
snapshot. Its database trigger prevents identity changes and requires every
update to advance exactly one revision.

`FantasyLeagueEvent` is append-only. League creation, roster transactions,
commissioner controls, and recipient notification-setting changes commit an
operation id, payload digest, actor, time, and outcome in the same database
transaction as their state change. A repeated roster operation returns its
stored outcome; a conflicting or stale revision fails without a partial roster.

`FantasyResultSnapshot` is append-only. Team-period, matchup, and standings
revisions retain exact fantasy model version/digest, baseball ruleset versions,
statistic derivation versions, source revisions, source/result digests,
calculation time, predecessor, and correction lineage. Result insertion and its
security audit commit together. Corrections add a new result; they never update
the prior row.

All foreign keys and lookup indexes start with Account and league ancestry.
New fantasy tables have RLS enabled and direct Supabase API roles have no table
privileges. The trusted server repository uses exact `(accountId, externalId)`
lookups and short row-locked write transactions.

## Authorization and delegated access

Every page read requires `fantasy.league.view` for the selected Account. Every
server action independently verifies same-origin submission, the selected
Account cookie, the authenticated identity, and the exact required capability.

- A team manager needs `fantasy.roster.manage`; the repository additionally
  requires that the authenticated Account membership owns the selected fantasy
  team.
- A commissioner needs `fantasy.league.manage` and may manage a team only
  through that explicit capability.
- League activation requires the distinct `fantasy.league.activate`
  capability.
- Result publication requires `fantasy.scoring.calculate`; result reading
  requires league-view authority at the presentation boundary.
- Export requires `fantasy.league.manage` and the exact selected Account and
  league.

#107 delegated authority remains an explicit authority source. The current web
authentication adapter issues direct Account permission evidence only; it does
not infer delegated authority from Organization or League membership. Until the
#107 adapter is persisted, delegated browser requests therefore fail closed and
cannot bypass Account permissions.

## Notifications and consent

The existing transactional outbox and delivery worker now accept three strict,
versioned events:

- `FANTASY_TRANSACTION_UPDATED`;
- `FANTASY_SCORING_UPDATED`; and
- `FANTASY_MATCHUP_FINAL`.

Payloads contain opaque league/team/result identity, status, revision, period,
and aggregate points/outcome only. Player names, lineups, contacts, youth data,
hidden analytics, and destination addresses are excluded.

League creation copies at most one active, recipient-enabled Account-level
preference per channel into league scope. It reuses the already managed
destination and consent; it never invents a channel or re-enables an opted-out
recipient. Recipients can disable a destination, select event types, choose
immediate or daily-digest delivery, set an IANA time zone, and apply quiet
hours. Delivery is delayed to the next allowed local minute. Account-, team-,
and fantasy-league-scoped subscriptions are matched separately.

## Accessibility and responsive behavior

- All operations use native links, buttons, form fields, checkboxes, selects,
  and text areas in normal keyboard order.
- Every form field has a visible label and destructive commissioner operations
  require a reason and explicit confirmation.
- Feedback uses `status` or `alert`; the main region is a programmatic focus
  target after navigation.
- League navigation exposes `aria-current`.
- Transaction, roster, and standings tables include captions and column/row
  scopes, with local horizontal scrolling on narrow screens.
- Controls have at least 44px (`min-h-11`) targets and responsive grids avoid
  fixed-width layouts.
- Scoring status, corrections, and uncertainty are conveyed in text, not color
  alone.

## Privacy and retention

Fantasy player entries hold only a canonical `baseballPlayerId`. Presentation
loads allowlisted display names in the exact Account and applies the most recent
privacy overlay. Missing or hidden identity renders as `Private player`; name
matching is never used for identity or ownership.

Exports omit authority references, authentication data, notification
destinations, and all private player attributes. Deletion is a reviewed request
state. Append-only transaction, result, and audit retention follows the
Account's accepted deletion policy; UI controls do not cascade-delete history.

## Operational boundary

This issue persists results produced through the deterministic #126 service
boundary and delivers resulting notifications. Automatic period creation,
scoring cadence orchestration, retryable calculation workers, public league
pages, multi-Account competitions, and offline fantasy operation are deferred.
The UI reports “no result” until a trusted calculation publisher records one;
it never synthesizes a score in the browser.

## Focused validation contract

Focused tests cover privacy-overlay player presentation, owner/commissioner
roster authorization, paused/archived history, Account-bound action/export
checks, notification rendering and delivery timing, responsive semantic tables,
keyboard-native controls, append-only migration guards, Account-prefixed keys,
RLS, and direct-role privilege denial. The M8 exit audit records the full suite
and operational validation in [M8 exit audit](M8_EXIT_AUDIT.md).
