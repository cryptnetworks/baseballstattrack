# Fantasy league ecosystem

The fantasy product is a downstream consumer of baseball data. It combines the
contracts and implementations from issues #125, #123, #124, #126, and #127;
this document describes how those pieces fit together and records the final
integration review for #122. It does not introduce a second source of baseball
truth.

## Completion map

The prerequisite and child issues were closed before #122 integration work
began:

| Issue | Capability                | Integration role                                                                                 |
| ----- | ------------------------- | ------------------------------------------------------------------------------------------------ |
| #101  | Import portability        | Preserves source, correction, verification, and ruleset lineage at data boundaries.              |
| #106  | Baseball ruleset contract | Supplies immutable baseball ruleset identity and versioning.                                     |
| #107  | League delegation         | Supplies explicit, Account-approved delegated capability evidence.                               |
| #125  | Fantasy rules             | Defines immutable scoring-model versions, eligibility, roster rules, and category extensions.    |
| #123  | Fantasy domain            | Defines Account-owned leagues, teams, canonical-player references, and immutable roster history. |
| #124  | Fantasy transactions      | Defines authorized, idempotent, audited roster and ownership changes.                            |
| #126  | Fantasy scoring           | Derives repeatable team results, matchups, standings, uncertainty, and correction revisions.     |
| #127  | Fantasy experience        | Presents leagues and results and connects consent-aware notifications to the existing outbox.    |

The detailed contracts remain in their child documents. #122 validates the
connections between them instead of copying their implementation.

## One-way architecture

```text
canonical baseball events
          |
          v
verified statistics + ruleset/derivation/correction lineage
          |
          v
immutable fantasy scoring model
          |
          v
Account-owned fantasy league and roster snapshots
          |
          v
audited fantasy transactions
          |
          v
versioned scores, matchups, standings, UI, and notifications
```

The arrows are one-way. Fantasy reads canonical player ids, verified statistic
projections, baseball ruleset versions, statistic-derivation versions, source
revisions, and correction state. It cannot create or update baseball events,
corrections, official statistics, player identity, season history, or ruleset
history. A fantasy correction appends a fantasy result revision; it never
rewrites the baseball record that caused the recalculation.

## League lifecycle and ownership

A fantasy league is one Account-owned aggregate for one immutable baseball
season. Its stable identity binds its Account, owner membership, visibility,
revision, and one sealed fantasy scoring-model family/version/digest. Its
teams, participants, player entries, transaction state, and results must share
that exact Account and league ancestry.

League lifecycle is one-way:

```text
DRAFT -> ACTIVE -> COMPLETED -> ARCHIVED
  +------------------------------^
```

A draft may be archived directly. Activation requires a separately authorized
operation and an active, unchanged scoring model. Completed or archived
seasons cannot return to active state. A later season or model starts a new
league-season record, preserving prior rosters and results.

Visibility is presentation policy, not authority. `PRIVATE` and
`LEAGUE_MEMBERS` remain Account- and league-scoped.
`PUBLIC_METADATA_ONLY` permits only a future allowlisted label/status view; it
does not reveal player identity, rosters, managers, statistics, or
authorization evidence.

## Permissions and delegation

Every server read or mutation begins with a fresh Account capability decision.
Repository checks then narrow that decision to the exact persisted league,
team, membership, and revision. Possession of an id, public visibility, or
membership in a similarly named league grants nothing.

| Actor                                 | Required authority                                                                                                            | Additional boundary                                                                                   |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| League owner or Account administrator | `fantasy.league.manage`, distinct `fantasy.league.activate`, `fantasy.team.manage`, and `fantasy.scoring.calculate` as needed | Exact Account and league; each operation requests only its own capability.                            |
| Participant/team manager              | `fantasy.league.view` and `fantasy.roster.manage`                                                                             | Authenticated Account membership must own the selected team.                                          |
| Viewer                                | `fantasy.league.view` and, for results, `fantasy.scoring.view`                                                                | Read-only unless the separate team-ownership check also identifies the viewer as that team's manager. |
| Delegated organization actor          | Exact #107 capability and Account-approved delegation evidence                                                                | Scope may narrow to one league or team and never widens to a sibling.                                 |

Team creation and lifecycle transitions use `fantasy.team.manage`; league
administration is not substituted for that capability. Roster mutation and
score publication remain separate capabilities. Cross-Account and
cross-league requests fail before mutation, and unauthorized callers do not
receive revision or ownership details as an oracle.

The #107 domain adapter validates exact delegation, expiry, revocation, scope,
and approval evidence. The browser authentication adapter currently emits
direct Account authority only. Delegated browser requests therefore fail
closed until persisted delegation evidence is connected to that adapter.

## Rules and version compatibility

Each active league seals an immutable fantasy scoring-model version and digest.
Every persisted team result, matchup, and standings revision must match that
pair. Result lineage also carries the contributing baseball ruleset version
ids, statistic-derivation versions, statistic-rules versions, source revisions,
and correction revisions.

```text
Baseball Ruleset v3 + Fantasy Scoring Model v2 = one Fantasy Result lineage
```

Names and “latest” versions never establish compatibility. A result from a
different fantasy model, Account, league, team, roster snapshot, or scoring
period is rejected rather than coerced. Changing a model creates a future
explicit binding; it does not reinterpret a completed period.

## Transactions and roster history

Adds, drops, waivers, trades, and lineup changes carry an actor, exact league,
accepted timestamp, idempotency key, expected revision, and audit identity.
The transaction engine builds candidate ownership and roster snapshots and
commits them only after the whole command passes authorization, ownership,
eligibility, roster-limit, lock, and duplicate checks.

Successful changes append ownership revisions, roster snapshots, league
events, and audit evidence. Denials leave the previous projection unchanged.
The same operation id and request digest replays the original outcome; a
changed payload conflicts. A new operation with a stale revision is rejected,
and the database locks the league workspace while applying compare-and-swap
semantics. Trades and waiver processing change every affected roster
atomically, so a partial ownership transfer cannot become visible.

Past roster snapshots remain addressable after current ownership changes. A
lineup correction creates a new, reasoned snapshot and cannot replace a roster
already bound to a result. Transactions have no write path to baseball rosters,
statistics, past fantasy results, or standings.

## Scoring, matchups, and standings

Scoring is a deterministic function of a locked roster snapshot, verified
statistics, and one sealed fantasy model. Integer category units and
milli-points avoid floating-point ambiguity. Canonical source and result
digests make a replay mismatch observable.

Incomplete games, missing statistics, unverified sources, and insufficient
samples remain explicit uncertainty. They are excluded with a reason rather
than guessed or silently treated as completed evidence. Finalization is an
explicit transition after the model's timing rules are met.

Matchups compare two exact-team results from the same Account, league, period,
and model lineage. Standings aggregate versioned matchups with declared,
deterministic tie-breaks. A corrected statistic creates a new team-result
revision, then new dependent matchup and standings revisions. Each revision
names and verifies its exact predecessor; old revisions remain immutable and
addressable. Persistence rejects incompatible model lineage and team ids that
are not members of the league.

## Notifications and experience

The fantasy experience uses the existing notification preference,
transactional outbox, webhook, and delivery-worker foundations. It does not add
another dispatcher or poll the database directly. The supported events are
`FANTASY_TRANSACTION_UPDATED`, `FANTASY_SCORING_UPDATED`, and
`FANTASY_MATCHUP_FINAL`.

Delivery requires an active recipient-enabled preference for the exact scope.
Opt-out, channel enablement, selected event types, quiet hours, time zone, and
digest mode are honored. Payloads contain only opaque fantasy identity,
revision, status, period, and aggregate outcome fields; they exclude player
names, lineups, contact destinations, youth data, and private analytics.

The UI uses server-derived scores and never calculates baseball or fantasy
truth in the browser. Native controls, semantic tables, programmatic focus,
textual uncertainty/correction state, and responsive layouts preserve the
accessibility contract from #127.

## Privacy and retention

Fantasy aggregates use opaque application ids and allowlisted display fields.
They do not introduce birth dates, ages, contacts, medical information,
private notes, youth classifications, hidden analytics, authentication data,
or unrelated Account data. A fantasy player entry references the canonical
`baseballPlayerId`; it never duplicates player identity.

Player labels are resolved only after Account authorization and the current
privacy overlay. Hidden or unavailable identity is rendered as `Private
player`. Exports and notification payloads apply narrower allowlists and omit
authority evidence and delivery destinations. Historical fantasy records
follow the Account's accepted retention and deletion policy; an ordinary UI
operation does not cascade-delete audit or result history.

## Integration review

The final review used the commissioner, league administrator, baseball
statistician, security, privacy, and database perspectives. It identified and
resolved three material integration gaps:

1. Production authorization now registers the domain's distinct
   `fantasy.team.manage` capability and league provisioning requests it instead
   of substituting broader league authority.
2. Persisted scoring correction lookup follows the exact predecessor result id,
   allowing more than one correction while retaining a single logical result
   chain and immutable snapshots.
3. Result persistence verifies the league's sealed model version/digest and
   rejects teams outside the workspace before committing a result.

Focused PostgreSQL coverage exercises team ownership, Account isolation,
duplicate transaction replay, multi-revision correction lineage, append-only
database enforcement, model compatibility, and sibling-team rejection. The
existing child suites cover lifecycle, delegation, roster rules, deterministic
scoring, uncertainty, notifications, privacy filtering, responsive behavior,
and keyboard/screen-reader semantics.

## Future extensions and remaining risks

Automatic scoring-period orchestration, persisted delegated browser authority,
multi-manager ownership transfer, public metadata presentation,
multi-Account competitions, and offline fantasy operation require separate
reviewed designs. Current browser delegation fails closed, and scoring remains
an explicitly authorized operation rather than an automatic worker schedule.

These are extension boundaries, not permission to weaken the current Account,
version, audit, privacy, or append-only constraints. M9 work is not part of
this integration issue and was not started.
