# Fantasy domain model

Issue [#123](https://github.com/cryptnetworks/baseballstattrack/issues/123)
defines the M8 fantasy league, team, player-reference, eligibility, and roster
snapshot domain. It consumes the [fantasy rules contract](FANTASY_RULES_CONTRACT.md)
from #125 and the [delegation model](LEAGUE_DELEGATION_MODEL.md) from #107.

This is a framework-independent aggregate contract. The downstream
[fantasy transaction contract](FANTASY_TRANSACTIONS.md) and
[fantasy scoring engine](FANTASY_SCORING_AND_MATCHUPS.md) consume these entities
without changing them in place. This document itself does not add persistence,
UI (#127), notifications, or offline behavior.

## Non-negotiable invariants

1. Fantasy is derived from canonical baseball identity and verified statistics;
   no fantasy operation writes baseball players, events, results, corrections,
   statistics, or ruleset bindings.
2. Every fantasy aggregate has an exact Account owner and Account boundary.
3. A fantasy player entry stores one opaque `baseballPlayerId`; it never copies
   or replaces canonical player identity.
4. A league season binds one exact fantasy model family, version, digest, owner,
   and statistic-registry version. It never resolves `latest` or a name.
5. Activated/completed history and roster snapshots are append-only. A rule,
   roster, ownership, or correction change creates a new version or snapshot.
6. Account permission and #107 delegation are separate evidence sources, but
   both require the exact fantasy capability and exact Account/aggregate scope.
7. Organization membership or League association alone grants no Account,
   roster, private-player, or commissioner authority.
8. Fantasy inputs and records exclude birth dates, ages, contacts, notes,
   medical information, youth classifications, and hidden analytics.
9. Ambiguous identity, ownership, ancestry, eligibility, or authority fails
   closed; it is never repaired by name matching or a default rule.
10. Transactions and scoring may consume these entities later, but cannot alter
    their historical snapshots in place.

## One-way architecture

```text
Canonical baseball identity and events
                 |
                 v
      versioned statistics
                 |
                 v
    immutable fantasy rules (#125)
                 |
                 v
      fantasy domain entities (#123)
                 |
          +------+------+
          v             v
   transactions      scoring/matchups
      (#124)             (#126)
```

The arrows are one-way. A fantasy league references a baseball season and a
fantasy player entry references a baseball player, but neither owns or embeds
those source records. Fantasy corrections are future append-only fantasy facts;
they cannot become baseball corrections.

## Identity and ownership

All ids are opaque, stable, nonempty identifiers. Display names are mutable
metadata and never identity or authorization evidence.

| Aggregate               | Stable identity              | Owner and boundary                                      |
| ----------------------- | ---------------------------- | ------------------------------------------------------- |
| Fantasy league season   | `FantasyLeague.id`           | Exact `Account`; one immutable baseball `seasonId`      |
| Fantasy team            | `FantasyTeam.id`             | Exact Account membership inside one fantasy league      |
| Fantasy player entry    | `FantasyPlayerEntry.id`      | Exact Account and league; references `baseballPlayerId` |
| Fantasy roster snapshot | `FantasyRosterSnapshot.id`   | Exact Account, fantasy league, and fantasy team         |
| Fantasy scoring model   | `modelId` + `modelVersionId` | #125 owner principal and semantic digest                |

A fantasy league may record an optional `administrativeScope` containing an
exact #107 Organization and League. This association does not change Account
ownership or grant access. An Organization- or League-owned fantasy model is
usable only when its owner id matches that exact administrative scope. An
Account-owned model must match the league's Account; a platform model is a
reviewed shared template.

The current contract is one Account per fantasy league season. Cross-Account
competitions require a later reviewed sharing and privacy design; no aggregate
may infer cross-Account access from schedule membership.

## Fantasy league

`FantasyLeague` records:

- stable id, contract version, exact Account owner, and optional administrative
  scope;
- immutable baseball `seasonId` reference;
- name and explicit `PRIVATE`, `LEAGUE_MEMBERS`, or
  `PUBLIC_METADATA_ONLY` visibility;
- exact fantasy model family/version/digest/owner/statistic-registry binding;
- lifecycle, revision, created, activated, completed, and archived instants.

The lifecycle is one-way:

```text
DRAFT -> ACTIVE -> COMPLETED -> ARCHIVED
  +------------------------------^
```

A draft can be archived without activation. Activation requires an `ACTIVE`
fantasy model and the distinct `fantasy.league.activate` capability. A reviewed
model may be selected while the league is a draft, but cannot activate the
league until that exact unchanged model is active. Completion cannot return to
active. A different season or rules version creates a new league-season record;
historical seasons are never mutated.

Visibility controls presentation only. `PUBLIC_METADATA_ONLY` permits a future
allowlisted league label/status surface, not rosters, player identity,
eligibility evidence, statistics, manager membership, or authority.

## Fantasy team and manager ownership

`FantasyTeam` records exact Account and fantasy-league ancestry, a stable id,
name, lifecycle, timestamps, and an owner reference containing the exact
`accountMembershipId`. The membership reference is the manager identity for
authorization; the aggregate does not copy email, contact, profile, or private
identity fields.

The lifecycle is:

```text
DRAFT -> ACTIVE -> WITHDRAWN -> ARCHIVED
  +-----------------------------^
```

Only an active team in an active league may receive a roster snapshot. Team
creation or transition requires `fantasy.team.manage` in the exact Account and
league/team scope. Commissioner authority is an explicit capability; neither
team ownership nor generic league settings authority implies it.

Multiple managers, co-manager invitations, ownership transfer, and manager
offboarding require audited membership-history records in a future persistence
change. They must preserve the owner reference that governed each historical
snapshot rather than rewriting it.

## Fantasy player entry

`FantasyPlayerEntry` is a league-local reference, not a player clone. It stores:

- its own fantasy entry id, Account, and fantasy league;
- exactly one canonical `baseballPlayerId`;
- one verified eligibility snapshot tied to the league's exact fantasy model
  version and digest; and
- one versioned ownership snapshot.

It deliberately has no player name, date of birth, age, contact information,
notes, medical information, youth classification, or private analytics. The
strict input boundary rejects unknown fields rather than dropping them after
acceptance.

The same `baseballPlayerId` can have a different fantasy entry in each fantasy
league. One roster snapshot cannot contain the same baseball identity twice,
even through two different fantasy entry ids. Name-only, fuzzy, or provider-
label matching is forbidden. Source identity resolution follows #101 and only
consumes available, Account-authorized canonical ids.

## Eligibility and ownership snapshots

Eligibility is evidence, not identity. A snapshot records:

- exact fantasy model version and digest;
- unique eligible position codes;
- canonical roster and statistic source revisions;
- `VERIFIED` state; and
- accepted UTC evaluation time.

Missing or unverified eligibility fails closed. Active slot validation compares
the snapshot only to the exact #125 lineup slot rule. It does not inspect age,
medical state, subjective notes, names, or hidden analytics.

Ownership state is `AVAILABLE`, `ROSTERED`, `INACTIVE`, or `RELEASED`, with an
exact fantasy team where the state is rostered/inactive, a monotonic revision,
and effective instant. #123 defines and validates this shape; #124 implements
the atomic commands and audit history that produce future ownership snapshots
in the [fantasy transaction contract](FANTASY_TRANSACTIONS.md).

## Roster slots and append-only history

A roster snapshot records an exact Account/league/team ancestry, revision,
previous snapshot id, effective UTC instant, exact rules binding, and ordered
slots. Slots are:

- `ACTIVE`, bound to one exact lineup-slot rule;
- `BENCH`, not bound to an active rule; or
- `INACTIVE`, requiring an inactive ownership snapshot.

Empty slots are valid. A populated entry can appear only once, the underlying
baseball player can appear only once, active-slot counts and bench counts cannot
exceed the sealed model, and active entries must have a qualifying position.
Maximum roster size counts populated entries, not empty capacity.

The first snapshot has revision `0` and no predecessor. Every successor names
the exact prior snapshot, increments by one, uses the same league/team/rules
ancestry, and has a strictly later effective time. Returned aggregates and
nested arrays are frozen. Trades, drops, source corrections, model changes, or
new periods cannot edit an older snapshot; downstream work appends a new one.

This contract does not define a scoring-period entity. #126 now binds an exact
roster snapshot to a sealed period and immutable result revision in
[Fantasy scoring and matchups](FANTASY_SCORING_AND_MATCHUPS.md).

## Authorization and delegation

The domain accepts a validated authority context, never browser-provided role
flags. Its evidence includes exact Account, actor, source, capability, scope,
authority-reference ids, and authorization time.

| Capability                  | Purpose                                 | #107 Account delegation | Approval |
| --------------------------- | --------------------------------------- | ----------------------- | -------- |
| `fantasy.league.manage`     | Create/complete/archive exact league    | Required for org actor  | No       |
| `fantasy.league.activate`   | Activate exact league and rules         | Required for org actor  | Yes      |
| `fantasy.team.manage`       | Create/transition exact fantasy team    | Required for org actor  | No       |
| `fantasy.roster.manage`     | Create player/roster snapshots          | Required for org actor  | No       |
| `fantasy.scoring.calculate` | Calculate exact-league result revisions | Required for org actor  | No       |

Direct Account operations require the corresponding future Account permission
from a freshly validated Account membership. Delegated Organization operations
must first pass #107 for the same exact Account. The adapter accepts only an
allowed `ACCOUNT`-scope decision whose capability and Account match, and carries
its membership/grant/delegation/approval references forward.

Account scope may be narrowed to one fantasy league or team after authorization.
A narrow scope never widens. Sibling Accounts, leagues, teams, mismatched rules,
revoked delegation, wrong capability, missing approval, and incomplete evidence
fail closed. Services must reauthorize at mutation commit and atomically persist
the authority/audit evidence when persistence is introduced.

## Privacy and security

- Private baseball fields are resolved only behind the existing Account
  authorization/privacy overlay and are not stored in fantasy aggregates.
- Public metadata never includes roster entries, membership ids, eligibility
  evidence, ownership state, statistics, or source Account ids.
- Stable ids are references, not bearer credentials; every read and write
  still resolves ownership and scope.
- Audit records use ids, capability, outcome, revision, and timestamps only.
- Import packages cannot select fantasy ownership or manufacture authorization.
- Cache keys must include Account, fantasy league/team, model version/digest,
  roster revision, source revisions, and privacy-overlay revision.

## Persistence boundary

No Prisma model or migration is included. Persisting these aggregates requires
a future forward-only design with Account-prefixed composite keys, exact foreign
keys to canonical player/season identity, immutable rule bindings, unique
revision chains, non-overlapping current ownership projections, atomic audit,
and deny-by-default RLS. Existing migrations must not be edited.

The in-memory contract intentionally establishes representability and failure
semantics before persistence. #124 defines ownership transaction and audit
semantics, while #126 now defines period, team-result, matchup-result, standings,
correction, digest, and audit references. A separate reviewed forward migration
must implement the complete lifecycle atomically rather than adding partial
mutable fantasy tables.

## Adversarial review findings

### Data and baseball-history review

Fantasy entries reference stable canonical player ids and never copy baseball
truth. Exact rules/model/source revisions and immutable snapshots prevent a
current roster or correction from rewriting an old season.

### Authorization review

The fantasy capability namespace is separate from generic team, league,
ruleset, and scoring capabilities. #107 delegation is Account-approved and
exact-scope; Organization or League membership alone cannot reach private data.

### Privacy review

Strict inputs reject extra personal fields. Eligibility stores position and
revision evidence only. Public visibility is metadata-only and not authority.

### Reliability and database review

Caller-supplied accepted UTC instants, one-way lifecycles, immutable nested
values, exact predecessor links, monotonically increasing revisions, and sealed
digests remove hidden wall-clock, last-write-wins, and mutable-history behavior.
Persistence remains a separate reviewed implementation even though transaction
and scoring references are now known, avoiding a partial schema that would
later corrupt lineage.

## Focused test contract

Tests prove exact ownership/rules identity, lifecycle authorization, sibling
Account isolation, #107 decision adaptation, activation approval, canonical
player references, strict privacy rejection, position/roster rules, duplicate
identity prevention, immutable ordered snapshots, and completed-history denial.

## Deferred downstream work

- #124 implements draft/assignment effects, add/drop, waivers, trades, lineup
  changes, atomic ownership transitions, and audit in
  [Fantasy transactions](FANTASY_TRANSACTIONS.md).
- #126 implements scoring periods, locked-roster scoring, matchups, standings,
  playoff/championship results, corrections, and immutable result identities in
  [Fantasy scoring and matchups](FANTASY_SCORING_AND_MATCHUPS.md).
- #127: league/team/roster UI is now provided by the Account-authorized
  [fantasy experience](FANTASY_USER_INTERFACE_AND_NOTIFICATIONS.md). Public
  presentation remains deferred.
- Offline fantasy behavior and synchronization remain out of scope.
