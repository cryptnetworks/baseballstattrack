# Fantasy transactions and roster management

Issue [#124](https://github.com/cryptnetworks/baseballstattrack/issues/124)
implements the M8 fantasy roster transaction state machine on the immutable
[fantasy domain model](FANTASY_DOMAIN_MODEL.md). It consumes the transaction
policy sealed by the [fantasy rules contract](FANTASY_RULES_CONTRACT.md) and
Account-approved authorization from the
[league delegation model](LEAGUE_DELEGATION_MODEL.md).

This implementation is framework-independent. It defines deterministic command
acceptance, ownership and roster transitions, waiver processing, locks,
idempotency, rollback, and audit evidence. It does not add a database scheduler,
API, scoring engine (#126), standings, playoffs, result correction, or UI (#127).

## Non-negotiable invariants

1. Every command names one exact Account and fantasy league and carries actor,
   exact authorization, accepted UTC timestamp, operation id, expected revision,
   and audit id.
2. Only an active league with active teams and the league's exact fantasy model
   version/digest can accept roster mutations.
3. Ownership and current roster projections agree before and after every commit.
   One player entry and canonical baseball player can be owned only once.
4. Accepted mutations append ownership and roster revisions; they never edit an
   earlier snapshot.
5. One operation id with one canonical request digest applies at most once.
   Reuse with different content is an idempotency conflict.
6. Optimistic revision checks allow only one concurrent writer to commit.
7. Multi-player trades and waiver conditional drops are atomic. Any failed
   validation leaves every ownership and roster value unchanged.
8. Waivers resolve only at sealed processing instants in deterministic priority,
   submission-time, and claim-id order.
9. A locked lineup is immutable. A commissioner correction is an explicit,
   league-wide, audited roster snapshot; it never edits the locked snapshot.
10. Fantasy transactions cannot write baseball players, games, events,
    statistics, corrections, fantasy results, or historical standings.

## Transaction state

`FantasyTransactionState` is the exact current decision input for one Account
and fantasy league. It records:

- contract and aggregate revision;
- immutable transaction policy;
- current `FantasyPlayerEntry` ownership projections;
- one current `FantasyRosterSnapshot` per active team;
- current waiver priority and every claim status;
- append-only transaction records; and
- append-only audit records.

Initialization rejects a non-active league/team, mismatched fantasy model,
missing or duplicate current roster, cross-Account or cross-league ancestry,
duplicate entry/canonical-player identity, incomplete waiver priority, invalid
lock interval, or any disagreement between ownership and roster slots. It never
normalizes corrupt state.

The state object and all nested arrays/records are frozen. A command returns a
new frozen state only after every validation succeeds. Repositories may persist
the returned state transactionally; partial intermediate values are not an
accepted result.

## Policy and roster-assignment method

The policy selects exactly one initial assignment method:

- `DRAFT`; or
- `COMMISSIONER_ASSIGNMENT`.

`ADD_PLAYER` is restricted to that declared method. The command is the atomic
roster-assignment effect; draft order generation, draft-room interaction, and
UI are not part of this issue. Changing assignment method requires a future
reviewed policy/version decision rather than accepting a command label that does
not match the league. Assignment requires league-wide processor authority and
must commit strictly before the sealed `initialAssignmentDeadline`.

After initial assignment, the implemented acquisition method is
`DAILY_WAIVERS`, as sealed by #125. There is no first-to-click free agency.
Direct player additions cannot silently bypass the declared method or waiver
queue.

## Command envelope and authorization

Every command includes:

| Field                | Contract                                                          |
| -------------------- | ----------------------------------------------------------------- |
| `operationId`        | Stable idempotency key for one semantic request.                  |
| `auditId`            | Stable append-only evidence id.                                   |
| `accountId`          | Exact Account tenant; must match state and league.                |
| `fantasyLeagueId`    | Exact league scope; sibling leagues are denied.                   |
| `expectedRevision`   | Optimistic concurrency token for the transaction state.           |
| `submittedAt`        | Caller-supplied canonical UTC instant; never a database default.  |
| `authority`          | Validated `fantasy.roster.manage` actor/scope/reference evidence. |
| action-specific data | Player, team, slot, schedule, acceptance, or claim references.    |

Authorization is evaluated before the revision response, so an unauthorized
actor cannot use stale-revision behavior as an oracle. Add, drop, lineup, claim,
and cancellation commands may use an exact team-narrowed authority. Trade and
waiver batch processing require Account/league-wide transaction authority
because they can mutate multiple teams atomically.

Trade manager acceptances are separate trusted evidence. Each names the exact
team, its current owner `accountMembershipId`, accepted UTC timestamp, and
authority references. A trade worker's league-wide capability cannot replace
either manager's acceptance. Generic team, commissioner, ruleset, scoring, or
Organization membership grants no implicit transaction authority.

## Idempotency and concurrency

The canonical request digest covers the complete command and authority evidence.
On retry:

- same `operationId` + same digest returns the original record/audit and exact
  state without adding history or incrementing a revision;
- same `operationId` + different digest returns `IDEMPOTENCY_CONFLICT`, appends
  denial audit evidence, and applies no mutation; and
- a new operation with a stale `expectedRevision` returns `STALE_REVISION`,
  appends denial evidence, and applies no mutation.

Persistence must enforce the same unique Account/league/operation id and
compare-and-swap revision in one database transaction. In-memory success is a
proposed commit, not permission to skip that future constraint.

## Add and drop behavior

`ADD_PLAYER` requires:

- exact initial assignment method;
- league-wide processor authority before the assignment deadline;
- an available or released player entry in the exact league;
- exact team authorization;
- an empty target slot; and
- eligibility, slot-count, bench-count, maximum-roster, and duplicate identity
  validation under the league's sealed model.

Success appends a `ROSTERED` ownership revision and successor roster snapshot at
the accepted timestamp.

`DROP_PLAYER` requires that the exact team currently owns and rosters the entry.
Success appends a `RELEASED` ownership revision, removes it from the successor
roster snapshot, and preserves the old roster and ownership snapshots. Drops do
not change canonical baseball roster membership or statistics.

## Trade behavior

A trade exchanges one explicitly named player from each of two teams. The
extension boundary supports reviewed multi-player trade commands later without
changing the authorization or atomicity rules.

The initial trade contract requires:

- exact current ownership by two different active teams;
- exact acceptance from both current team-owner memberships;
- one sealed `tradeProcessingInstant` equal to the worker's accepted time;
- processing strictly before the sealed trade deadline;
- league-wide transaction authority;
- explicit empty target slots; and
- full roster/eligibility validation for both resulting teams.

There is no subjective commissioner veto. A trade is denied only for declared
authorization, acceptance, ownership, schedule/deadline, roster, eligibility,
concurrency, or integrity rules. Both ownership revisions and both successor
rosters are computed before returning a new state. If either roster fails, the
other is rolled back because neither intermediate value is committed.

The manager acceptances may be recorded before the future processing instant.
The mutation executes only when a trusted worker submits the command at that
sealed instant. This pure domain layer does not wake or schedule the worker.

## Waiver claims and deterministic batch processing

`SUBMIT_WAIVER_CLAIM` records a pending claim for a future instant already
present in `waiverProcessingInstants`. It requires exact team authority, an
unowned target, optional conditional drop still owned by that team, a target
slot, and a unique claim id. A pending claim is not ownership and changes no
roster. One team cannot queue the same player twice for one batch.

`CANCEL_WAIVER_CLAIM` is allowed only while pending and only by authority that
covers the claiming team. Cancellation appends transaction/audit history; it
does not delete the claim.

At the exact processing instant, `PROCESS_WAIVERS`:

1. selects pending claims for that instant;
2. sorts by current team priority, then submission time, then stable claim id;
3. rechecks target ownership, conditional drop, roster, eligibility, and limits;
4. applies each successful claim atomically;
5. moves only each successful team to the end of priority;
6. leaves priority unchanged for failed claims; and
7. records each claim as `APPLIED` or `REJECTED` with result code and resolution
   time.

Two teams claiming one player cannot both win: the first successful ownership
revision makes the later claim fail `OWNERSHIP_CONFLICT`. A conditional drop is
computed on claim-local candidate state. If acquisition or roster validation
fails afterward, the drop is discarded. The batch has one audit plus an
immutable applied/denied resolution audit for every processed claim.

## Lineup changes and locks

`LINEUP_CHANGE` supplies the complete successor slot projection. Before a lock,
the same roster ownership, duplicate, eligibility, slot, and maximum-size rules
apply. It creates a new roster snapshot; it does not edit the prior lineup.

Policy lock intervals are sealed UTC `[startsAt, endsAt)` windows. A team-scoped
manager cannot change a lineup during that interval. A league-wide actor may
submit an explicit nonempty `commissionerCorrectionReason`; the correction is a
new audited snapshot. It cannot alter the snapshot that #126 later binds to a
past result. The service/persistence boundary must additionally preserve who
approved the correction and its correlation id.

## Atomicity and rollback

The engine uses pure candidate values. Ownership revisions and roster snapshots
are constructed locally, run through #123 validation, and become current only
when the full command succeeds. A denial:

- retains the prior state revision;
- preserves player ownership, roster snapshots, priority, and pending claims;
- creates no partial successor snapshot; and
- appends a denied transaction/audit result when the command envelope was
  parseable.

Malformed envelopes fail before a safe audit identity can be trusted and must be
rejected/audited by the API boundary. Persistence must atomically write state,
transaction, and audit or roll the whole command back. Retrying after an unknown
commit result uses the same operation id and payload.

## Audit contract

Every accepted, queued, cancelled, and denied transaction records:

- operation/audit id and canonical request digest;
- exact actor, authority source, and authority reference ids;
- Account and fantasy league;
- action and affected fantasy player entry ids;
- accepted and effective UTC timestamps;
- result and safe reason code;
- explicit commissioner-correction reason for a locked-lineup correction;
- before/after transaction-state revision; and
- created roster snapshot ids.

Waiver resolution audits also identify the exact claim-derived operation,
affected acquisition/conditional-drop entries, processor actor, result, reason,
and revision. Audit payloads contain opaque ids, not player names, personal
fields, statistics, notes, or transaction-chat content.

## Historical and scoring boundary

Transaction history is append-only. Ownership projections point forward; old
ownership and roster snapshots remain inspectable. A command accepted after a
lineup lock can affect only a future unlocked roster. There is no path to edit:

- canonical baseball players, rosters, games, events, or statistics;
- a fantasy model version/digest;
- a roster snapshot already referenced by a future scoring result;
- past fantasy results or adjustments; or
- historical standings or playoff state.

#126 now selects exact roster snapshot ids at sealed locks and implements
matchups, scores, standings, playoff/championship results, and late result
revisions in [Fantasy scoring and matchups](FANTASY_SCORING_AND_MATCHUPS.md).
It consumes this history without adding a transaction shortcut back into
baseball truth.

## Privacy and security

Commands, records, claims, and audits carry opaque player-entry/team ids only.
They exclude player names, DOB/age, guardian/contact details, notes, medical or
youth information, private statistics, hidden analytics, credentials, and
provider claims. Stable ids are not bearer authority.

Cross-Account and cross-league requests deny before resource mutation. Public
league visibility does not expose claims, rosters, ownership, manager
membership, authority references, or audit. Logs and metrics use safe action,
result, latency, and correlation metadata, never roster payloads.

## Persistence and execution boundary

No Prisma migration, queue, cron schedule, worker, route, or service is included.
The domain returns the complete atomic commit proposal and deterministic audit.
Production persistence remains a separate reviewed implementation of the now
complete #123/#124/#126 relational boundary so roster snapshots referenced by
results cannot be deleted or rewritten.

A future implementation must add a forward-only migration with Account-prefixed
foreign keys, operation-id uniqueness, compare-and-swap revision, immutable
transaction/audit rows, claim status constraints, exact current ownership
uniqueness, scheduler leases, retry-safe batch identity, and deny-by-default RLS.
The scheduled worker must use the application clock abstraction, claim one batch
with concurrency control, reauthorize at commit, and recover unknown outcomes by
operation id. Database defaults are safety fallbacks, not accepted timestamps.

## Adversarial review findings

### Distributed systems and reliability review

Canonical digests, stable operation ids, optimistic revisions, sealed instants,
deterministic waiver order, claim-local candidates, and all-or-nothing returned
state cover duplicate delivery, concurrent writers, partial trades, conditional-
drop rollback, and unknown commit outcomes. A future repository still needs
database uniqueness and locking; a process-local object is not a distributed
lock.

### Database review

Current ownership is a projection of immutable revisions, not a mutable source
of history. Transaction, roster, ownership, result, and audit writes must share
reviewed atomic boundaries. #126 now supplies durable result references; schema
work remains separate so no partial design can delete scored rosters.

### Fantasy commissioner review

The declared assignment method, daily waiver schedule, rotating priority,
mutual trade acceptance, objective deadline, no subjective veto, and explicit
correction reason are inspectable and predictable. Failed claims do not punish
priority.

### Security and privacy review

Authorization precedes revision disclosure; cross-scope access fails closed;
multi-team processing needs league-wide authority plus manager acceptance; and
audits contain only minimum opaque references. No protected player field is a
transaction or priority input.

### Baseball history review

Transactions append only fantasy ownership/roster history and cannot write the
baseball or scoring domains. Canonical identity remains one opaque reference.

## Focused test contract

Tests cover initialization integrity, authorized add/drop/trade/lineup changes,
denied cross-team and cross-league commands, optimistic concurrency, exact
duplicate replay, idempotency-key conflict, roster rollback, mutual trade
acceptance, two-roster trade rollback, lineup locks/corrections, deterministic
waiver priority, cancellation, duplicate ownership, conditional-drop rollback,
per-claim resolution audit, and frozen append-only history.

## Deferred downstream work

- #126 implements scoring-period identities, lineup-to-result binding, the pure
  scoring engine, matchups, standings, playoff/championship results, uncertainty,
  and append-only corrections.
- #127: draft, waiver, trade, roster, lineup, audit, and correction UI.
- Production fantasy persistence, API routes, scheduler, and worker ship only
  with the complete reviewed relational/operational design.
- Offline fantasy transactions and conflict synchronization remain out of scope.
