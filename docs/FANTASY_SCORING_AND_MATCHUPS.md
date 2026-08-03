# Fantasy scoring, matchups, and standings

This framework-independent engine calculates deterministic weekly fantasy
results from the
[fantasy rules contract](FANTASY_RULES_CONTRACT.md),
[fantasy domain model](FANTASY_DOMAIN_MODEL.md), and
[fantasy transactions](FANTASY_TRANSACTIONS.md). It does not add UI (#127),
notifications, persistence, APIs, scheduling, proprietary projections, or
offline behavior. The work was tracked in
[#126](https://github.com/cryptnetworks/baseballstattrack/issues/126), and
[ADR 0016](decisions/0016-versioned-fantasy-results-and-standings.md) records the
result and correction decision.

## Non-negotiable invariants

1. Verified baseball statistics plus one exact immutable fantasy model produce
   fantasy results. Fantasy output never changes baseball events, statistics,
   verification, corrections, or ruleset bindings.
2. A team-period result binds one exact Account, fantasy league, team, scoring
   period, locked roster snapshot, fantasy model version/digest, calculation
   version, and source lineage.
3. Only populated `ACTIVE` roster slots score. Bench/inactive slots and later
   roster revisions never affect an already locked period.
4. Incomplete, unverified, missing, or insufficient-sample inputs remain
   explicit uncertainty. They are never guessed, projected, or silently zeroed.
5. Exact replay of the same sealed inputs is byte-equivalent.
6. Corrections append a new result revision, source digest, explanation, audit,
   matchup revision, and standings revision. Prior results remain inspectable.
7. Regular-season ties remain ties. Playoff and championship ties use the
   higher predeclared seed from #125, never a hidden score or commissioner
   choice.
8. Every calculation requires exact `fantasy.scoring.calculate` Account/league
   authority. Organization membership alone grants no statistic or result
   access.
9. Account, league, team, period, roster, model, and source ancestry mismatch
   fails closed before a result is returned.
10. Result and audit payloads use opaque ids and aggregate statistics only; they
    contain no private player identity or protected traits.

```text
verified baseball events
       -> versioned statistic projection
       -> immutable fantasy model version
       -> locked active fantasy lineup
       -> team-period category/point total
       -> matchup result
       -> standings and playoff qualification
```

The arrows are one-way. A fantasy result is never an input to baseball replay.

## Scoring period identity

`FantasyScoringPeriod` has a stable id, exact Account and fantasy league,
positive sequence, phase, and sealed UTC boundaries:

- `REGULAR_SEASON`, `PLAYOFF`, or `CHAMPIONSHIP` phase;
- inclusive `startsAt` and exclusive `endsAt`; and
- `finalizationDeadline` at or after the period end.

The period identity and all boundaries are included in source/result digests.
They are not recalculated from a time zone at scoring time. A playoff or
championship period uses the same exact model binding unless the league was
created with another explicitly scheduled immutable version.

## Team-period calculation

`calculateFantasyTeamPeriodResult` consumes:

- one exact fantasy league and team;
- the immutable roster snapshot locked for the period;
- the league's exact scoring model version/digest;
- one statistics-source disposition for each populated active slot;
- exact `fantasy.scoring.calculate` authority;
- a caller-supplied canonical calculation timestamp; and
- revision/predecessor/correction data when recalculating.

The engine maps sources by roster slot and player-entry id. Duplicate sources,
bench sources, cross-team sources, missing ancestry, changed rules bindings,
and mismatched Accounts or leagues are rejected. Empty active slots follow the
#125 zero-point rule but remain visible as `EMPTY_LINEUP_SLOT`.

For each final verified source, the #125 scoring boundary produces signed exact
integer milli-points. The team result aggregates, in model order:

- category id and source-statistic identity;
- total integer units;
- category milli-points; and
- total milli-points.

Category totals explain a points result. They do not turn the initial weekly
points format into head-to-head categories. A future category-wins format needs
a new immutable format/calculation version.

## Result lineage and deterministic replay

Every `FantasyTeamPeriodResult` records:

- scoring contract and calculation versions;
- fantasy model family/version/digest;
- locked roster snapshot id/revision;
- every scored active-slot/player-entry reference;
- baseball ruleset version ids;
- statistic derivation and statistic-rules versions;
- source and correction revisions;
- per-category units and milli-points;
- source and result SHA-256 canonical digests;
- calculation/finalization instants; and
- append-only authorization/audit evidence.

The source digest covers the period, roster, model, source dispositions,
statistics, verification, authority lineage, and correction lineage. The result
digest covers the complete semantic result and minimized audit. Replaying the
same inputs produces the same objects and digests. A mismatch is a reliability
incident, not permission to patch a historical total.

## Uncertainty and completion

Each populated active slot has one disposition:

- `FINAL_VERIFIED`: score the verified final projection;
- `CORRECTED_FINAL`: score the corrected verified projection and preserve its
  positive correction revision;
- `INCOMPLETE_GAME`: do not score yet; show completed/expected games and an
  explicit projected-completion instant when known;
- `UNVERIFIED`: do not score; expose verification uncertainty; or
- `INSUFFICIENT_SAMPLE`: do not infer eligibility or statistics; expose the
  insufficient evidence.

An absent source is `MISSING_STATISTICS`. The result exposes uncertainty code,
slot/player references, completed/expected games, and projected completion.
When any unresolved source lacks an honest completion estimate, the aggregate
projected-completion field is `null`; the engine never invents one.

Result status is deterministic:

- `IN_PROGRESS` before the period end;
- `AWAITING_FINAL_DATA` after the end while uncertainty remains and the grace
  deadline has not passed;
- `READY` when all sources resolve or the declared grace deadline passes; and
- `FINAL` only after an explicit finalization request at a permitted time.

After the deadline, unresolved sources remain excluded with visible uncertainty
instead of blocking the league forever or becoming silent zeroes.

## Matchup calculation

`calculateFantasyMatchup` requires two distinct exact-team results for the same
Account, league, and period. It preserves each team-result id, revision, digest,
category totals, and total milli-points.

- A matchup remains `IN_PROGRESS` until both team results are `FINAL`.
- Higher total milli-points wins.
- Equal regular-season totals produce `TIE`.
- Equal playoff/championship totals advance the numerically higher
  predeclared seed (seed `1` is higher than seed `2`).
- Playoff opponents must have distinct positive predeclared seeds.

The matchup output records `winnerTeamId`, `loserTeamId`, outcome, tie-break,
period phase, source-result references, direct aggregate fantasy-model/baseball
ruleset/statistic-derivation/source-revision lineage, source/result digests,
revision, and audit. Opponents derived under different fantasy model versions
cannot be compared. No hidden decimal, best-player score, live estimate, or
subjective veto breaks a tie.

## Standings and playoff qualification

`calculateFantasyStandings` consumes exact regular-season matchup results and a
sealed list of teams/predeclared seeds. At least one versioned matchup is
required so every standings result directly preserves the fantasy model,
baseball ruleset, statistic derivation, source revision, and correction
revision lineage it aggregates. Each completed matchup contributes:

- win, loss, or tie;
- two standing points per win and one per tie;
- points for, against, and differential;
- aggregate category units/milli-points; and
- ordered current streak (`Wn`, `Ln`, or `Tn`).

Pending matchups are counted and excluded from completed records. A team may
appear in at most one matchup per scoring-period sequence.

Ranking is deterministic and declared here in order:

1. standing points;
2. points differential;
3. points for;
4. higher predeclared seed; and
5. stable fantasy-team id using locale-fixed ordering.

Before the regular season is complete, teams above the configured cutoff show
`CURRENT_CUTOFF`. Once all supplied regular-season matchups are final and the
season-complete flag is sealed, they show `QUALIFIED`. Other teams show
`NOT_QUALIFIED`. Bracket construction and presentation remain outside this pure
calculation boundary, while playoff/championship matchup results use the same
deterministic matchup function.

## Corrections and result revisions

An initial result starts at revision `0` without a predecessor. Finalization or
source changes create a new result id, increment revision by exactly one, name
the exact predecessor, and use a strictly later accepted timestamp.

When source bytes change, recalculation requires a nonempty correction reason.
The new result stores the previous id/digest and new source/result digests.
Final results never move backward to provisional state. A corrected team result
causes a new matchup revision, which causes a new standings revision. The old
team result, matchup, and standings remain unchanged and addressable.

Model versions and locked roster snapshots cannot change within a correction.
A new fantasy model version applies only to a future explicitly bound period or
league season; it cannot reinterpret an existing result.

## Authorization, isolation, and audit

Direct Account and #107-delegated calculation use the exact
`fantasy.scoring.calculate` capability. It is Account-scoped, requires an
Account-approved delegation for an Organization actor, and does not imply
roster mutation, rules activation, exports, or private player reads.

Every team-period, matchup, and standings result contains minimized audit:

- audit and actor id;
- authority source/reference ids;
- exact Account and fantasy league;
- target kind/id and affected team ids;
- period id where applicable;
- calculate/recalculate/finalize action;
- accepted timestamp and result revision;
- predecessor id; and
- correction reason when sources changed.

No uploaded id, model owner, public league status, cache entry, or possession of
a prior result grants authority. Cross-Account and sibling-league requests fail
without exposing whether the other result exists. Persistence must commit a
result and its audit atomically or fail closed.

## Privacy and presentation boundary

Calculation inputs and results use opaque Account, league, team, roster-slot,
player-entry, model, period, and statistic identifiers. They do not contain
player names, DOB/age, youth classification, contacts, guardians, notes, medical
information, hidden analytics, raw events, correction notes, or credentials.

Category/points totals, matchup status, completion uncertainty, standings,
streaks, and qualification are presentation-ready domain facts, not public
authorization. #127 must apply an explicit field allowlist, Account privacy
overlay, and read capability before displaying them.

## Persistence and execution boundary

No Prisma model or migration is included. This issue completes the domain
identity needed by a future joint #123/#124/#126 forward migration:

- Account-prefixed period, team-result, matchup-result, and standings keys;
- immutable model/roster/source-result foreign keys;
- unique revision/predecessor chains and source/result digests;
- atomic result plus audit writes;
- current-result projections derived from immutable revisions;
- compare-and-swap/idempotent worker semantics;
- no deletion of roster snapshots referenced by results; and
- deny-by-default RLS/service boundaries.

A production worker must select verified statistic revisions, reauthorize at
commit, persist each immutable result/audit atomically, and retry unknown
outcomes by stable calculation identity. This pure engine does not schedule,
poll, or publish results.

## Adversarial review findings

### Baseball/statistics reviewer

Only the existing verified statistic boundary can score. Ruleset, derivation,
statistic-rules, source, correction, registry, model, and roster versions remain
attached. Fantasy code has no baseball mutation path.

### Fantasy commissioner

Period/grace states, regular ties, playoff seed ties, standings ranking,
qualification, and late corrections are explicit and reproducible. No hidden
commissioner judgment changes points.

### Security and privacy reviewer

The new capability is exact-Account delegated and non-bundled. Inputs/results
exclude identity and protected fields; cross-tenant ancestry fails before
calculation.

### Reliability reviewer

Canonical digests, safe integer math, caller-supplied UTC instants, immutable
revisions, explicit source dispositions, and full replay tests prevent float,
wall-clock, last-write-wins, and silent-correction drift.

### Database architect

Result identities and immutable reference requirements are defined without a
partial schema. A future migration can now preserve locked rosters and source
lineage rather than storing only mutable current standings.

## Focused test contract

Tests cover deterministic replay, exact category/point totals, active-slot-only
scoring, incomplete/unverified/insufficient evidence, finalization gates, model
version binding, correction chains, regular/playoff ties, standings totals,
streaks, qualification, correction propagation, permissions, Account/league
isolation, safe integer behavior, and immutable outputs.

## Deferred downstream work

- #127 presents league, lineup, uncertainty, matchup, standings, correction,
  and notification state through the Account-authorized
  [fantasy experience](FANTASY_USER_INTERFACE_AND_NOTIFICATIONS.md).
- Production persistence, result APIs, background calculation workers, and
  scheduling require a separate reviewed implementation using the boundary
  above.
- Offline fantasy scoring and synchronization remain out of scope.
