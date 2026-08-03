# Fantasy rules, scoring, and eligibility contract

Issue [#125](https://github.com/cryptnetworks/baseballstattrack/issues/125)
defines the M8 fantasy-rules foundation. It depends on the
[ruleset contract](RULESET_CONTRACT.md),
[import portability contract](IMPORT_PORTABILITY.md), and
[league delegation model](LEAGUE_DELEGATION_MODEL.md). This contract defines
rules only. It does not create fantasy leagues, managers, rosters, transactions,
matchup execution, standings, playoffs, UI, or notifications.

## Non-negotiable invariants

1. Baseball events and their replay remain canonical baseball truth.
2. Baseball statistics are derived from those events under their recorded
   baseball ruleset and statistic derivation versions.
3. Fantasy scoring consumes a versioned statistics projection. It never writes
   baseball events, scores, decisions, corrections, verification state, or
   statistics.
4. One fantasy result binds to one immutable fantasy model version and its
   content digest; replay never selects "latest."
5. Missing, unverified, incompatible, or private inputs fail explicitly. They
   are never guessed, treated as zero, or obtained from another Account.
6. Eligibility uses authorized roster and baseball-participation evidence, not
   age, health, contact, youth, or other protected traits.
7. Organization and League ownership grants no Account data access. #107 scope
   and approval remain mandatory.
8. Corrections can revise fantasy output under an explicit revision policy but
   can never rewrite the underlying baseball history.

```text
Baseball ruleset version
        -> accepted baseball events
        -> versioned statistics projection
        -> immutable fantasy scoring model version
        -> derived fantasy score + complete lineage
```

The arrows are one-way. Fantasy state is never an input to baseball replay,
statistics, verification, reports, or corrections.

## Existing foundation and implementation boundary

The repository already provides replayable Account-scoped events, immutable
baseball ruleset bindings, derived player statistics with derivation/rules
versions, correction lineage, verification state, privacy overlays, portable
data provenance, and the #107 Organization/League authorization evaluator.

Issue #125 adds a pure fantasy-rule model, lifecycle/digest verification,
statistics-to-points boundary, eligibility evaluator, and explicit #107 fantasy
rule capabilities. It adds no persistence and no production route. The test
fixtures are rule definitions and statistic facts, not #123 fantasy entities.

## Fantasy scoring identity

A fantasy scoring family has stable `modelId`; every semantic version has a
unique `modelVersionId`.

| Field                      | Contract                                                                   |
| -------------------------- | -------------------------------------------------------------------------- |
| `contractVersion`          | Version of this outer fantasy-rules envelope.                              |
| `modelId`                  | Immutable stable family id; names are never identity.                      |
| `modelVersionId`           | Immutable opaque id for one semantic version.                              |
| `owner`                    | Exact `PLATFORM`, `ORGANIZATION`, `LEAGUE`, or `ACCOUNT` principal and id. |
| `version`                  | Positive monotonically increasing integer within the family.               |
| `name`                     | Human-readable version name, included in sealed history.                   |
| `format`                   | Explicit scoring format; initially `WEEKLY_HEAD_TO_HEAD_POINTS`.           |
| `statisticRegistryVersion` | Exact registry mapping category inputs to derived baseball statistics.     |
| `categories`               | Ordered stable category definitions and exact integer weights.             |
| `eligibility`              | Roster/position evidence and threshold rules.                              |
| `roster`                   | Active slots, bench size, lock, missing-lineup, and bench-scoring rules.   |
| `cadence`                  | Period, grace, correction, tie, and playoff tie-break rules.               |
| `lifecycle`                | `DRAFT`, `REVIEWED`, `ACTIVE`, `DEPRECATED`, or `RETIRED`.                 |
| `contentDigest`            | `sha256:v1` digest of the canonical semantic envelope.                     |

The digest covers ids, owner, version, name, format, statistic registry,
categories, eligibility, roster, and cadence. Lifecycle projection is excluded
so an unchanged version retains one digest as it advances. Canonicalization is
ordered, locale-independent JSON. Changing any covered value creates a new
digest and, after review, must create a new version.

Fantasy result lineage records the model family/version/digest, every baseball
ruleset version consumed, statistic derivation/rules versions, source revision,
correction revision, and statistic-registry version. Display names, current
defaults, or league names cannot substitute for these identifiers.

## Initial format and low-maintenance rationale

The initial platform format is **weekly head-to-head points**. Each lineup's
verified statistics are multiplied by the sealed point weights and summed.
The higher total wins the period. The choice is deliberate:

- one lineup decision per week instead of daily changes;
- one comparable score is easier to explain than many category tie-breaks;
- negative and positive weights support batting and pitching tradeoffs;
- automated scoring needs no commissioner interpretation; and
- future category, roto, season-points, or custom formats can use new format and
  engine versions without reinterpreting an existing result.

The platform default is a template, not a global mutable singleton. A league
activates one immutable copied/versioned model before its first period. No model
is selected merely because it is newest or platform-owned.

## Scoring categories and extension registry

A category has stable id, display label, domain, exact `sourceStatistic`, and
signed `milliPointsPerUnit`. Scores use safe integer milli-points; `1000` is one
point and `-500` is negative half a point. Floating-point arithmetic, localized
numbers, implicit rounding, and last-write-wins category replacement are not
allowed.

The initial baseball-statistics adapter exposes these extension points:

| Domain   | Initial statistic codes                                                       |
| -------- | ----------------------------------------------------------------------------- |
| Batting  | runs, hits, doubles, triples, home runs, RBI, walks, stolen bases, strikeouts |
| Pitching | outs recorded (innings in thirds), strikeouts, earned runs, walks             |

Wins and saves are valid future pitching categories but are not currently
available in the canonical player projection. A fantasy model must not infer
them from final score, pitcher order, names, or external feeds. They become
usable only after a reviewed statistic-registry version provides reproducible,
versioned values.

The engine does not hardcode every format or statistic. A new statistic ships
through a versioned registry entry declaring:

- stable statistic code and domain;
- exact source projection field and aggregation semantics;
- unit and integer scaling;
- required baseball ruleset/statistic compatibility;
- missing/unverified behavior (always explicit, never silent zero);
- correction and replay behavior; and
- privacy classification.

A model binds the registry version. Unknown codes, missing values, registry
drift, unsafe arithmetic, and unsupported baseball lineage fail closed.
Organization custom codes cannot shadow platform codes.

## Illustrative initial points template

This table is the reviewable platform starting template, not constants embedded
in the scoring engine. Activation seals the exact chosen values.

| Category              | Points per unit |
| --------------------- | --------------: |
| Batting run           |               1 |
| Hit                   |               1 |
| Double bonus          |               1 |
| Triple bonus          |               2 |
| Home-run bonus        |               3 |
| RBI                   |               1 |
| Walk                  |               1 |
| Stolen base           |               2 |
| Batting strikeout     |            -0.5 |
| Pitching out recorded |               1 |
| Pitching strikeout    |               1 |
| Earned run            |              -2 |
| Pitching walk         |              -1 |

Hit and extra-base bonuses are additive only when the activated model contains
both categories. The review screen must show an example calculation to prevent
double-counting surprises. #127 owns that future presentation.

## Eligibility contract

Eligibility is a deterministic answer for one requested lineup slot at one
sealed period lock. Its inputs are limited to:

- exact Account authorization and roster membership at lock;
- verified baseball position assignments;
- appearances at a position in a declared lookback window;
- pitching outs (never decimal innings); and
- the activated model version.

Position rules declare stable position code, minimum appearances, and minimum
pitching outs where relevant. A lineup slot lists the allowed position codes.
Unknown positions, missing evidence, incomplete ancestry, or a threshold not met
means ineligible. Name matching and external provider labels are not evidence.

The first template uses season-to-date verified appearances with a preseason
carry-forward snapshot declared before the first period. A default non-pitching
position needs five appearances; pitcher eligibility needs fifteen recorded
outs (exactly five innings). League customization may change minimum
appearances or minimum innings only by activating a new model version for a
future period; innings are always stored and compared as outs.

Roster eligibility means the player reference belongs to the exact authorized
Account roster at lock. It does not create the roster, establish player
identity, or grant private-player access; those belong to #123. A traded or
released player's past locked periods remain unchanged.

## Roster and lineup rules

Each model declares maximum roster size, bench count, and counted active slots.
Every slot has a stable id, positive count, and one or more eligibility codes.
Active plus bench slots cannot exceed maximum roster size.

The initial format uses one full-lineup lock at the weekly period start:

- the submitted lineup snapshot is immutable for that period;
- bench statistics do not score;
- an empty or invalid active slot scores zero, without auto-selecting a player;
- no daily substitutions or best-ball optimization occur; and
- the next period starts from the last valid lineup as a convenience only after
  fresh roster and eligibility validation.

This is a rule contract, not a lineup or roster entity implementation.

## Weekly cadence and participant obligations

The platform template derives Monday-to-Monday boundaries in the League's
declared IANA time zone, then seals explicit UTC `[start, end)` instants before
the season. Stored UTC boundaries, not repeated local-time calculations, govern
locks across daylight-saving changes. The persisted boundary source is
`SEALED_UTC_INTERVALS`.

A participant's required weekly work is:

1. Review and submit one lineup before the published period start.
2. Resolve any visible ineligible or empty slot before that lock.
3. Take no required daily action; scoring is automatic.

Expected required attention is approximately five to ten minutes weekly.
Waivers, trades, and lineup changes are optional strategy. Every lock and
deadline is published at least seven days ahead and displayed in the League's
time zone plus an unambiguous UTC instant.

## Transaction boundary

Issue #124 owns waiver, trade, acquisition, release, and scheduling mechanics.
It must implement these sealed initial-format rules:

- every acquisition uses a daily waiver batch rather than first-to-click free
  agency;
- processing instants are published as sealed UTC timestamps at least seven
  days ahead;
- initial priority is reverse draft order; each successful claim moves that
  manager to the end, while failed claims leave priority unchanged;
- one manager cannot receive the same player twice, and roster/eligibility
  constraints are rechecked atomically at acceptance;
- a trade needs explicit acceptance from every participating manager, has no
  subjective commissioner veto, and may be rejected only by declared roster,
  eligibility, authorization, deadline, or integrity rules;
- accepted trades apply at the next transaction processing instant; and
- a sealed regular-season trade deadline blocks new acceptances before the
  first playoff period.

The transaction effect boundary is:

- a transaction committed before a period lock may affect that period after
  fresh roster/eligibility validation;
- a transaction committed at or after lock affects the next eligible period;
- queued or pending transactions are not roster authority;
- no transaction changes a locked lineup or prior score; and
- retries preserve one accepted effective timestamp and cannot apply twice.

Claim cancellation, concurrent batches, trade retries, recovery, and audit must
be implemented and tested by #124. No transaction entity, queue, or scheduler
is introduced here.

## Game lifecycle, corrections, and stat changes

Only verified final game statistic projections score. Period association and
finalization are deterministic:

- a game that starts within a sealed period belongs to that period;
- a game postponed before starting and rescheduled outside the period moves to
  the period in which it actually starts;
- a suspended game remains with its original start period;
- incomplete, abandoned, cancelled, or unverified games contribute no values;
- period finalization waits the model's bounded completion grace (48 hours in
  the initial template) for suspended games and verification;
- corrections accepted before finalization replace the prior derived fantasy
  revision through full statistic replay; and
- after finalization, canonical stat changes never silently mutate standings.

The initial correction policy is `BEFORE_FINALIZATION_ONLY`. A material late
correction requires a future #126 append-only adjustment record showing old and
new lineage, reason, authority, affected results, and revision. The original
result remains inspectable. Commissioners cannot edit fantasy points to change
baseball truth.

## Matchups, ties, and playoffs boundary

Issue #126 implements matchup scoring, standings, and playoffs. The rule inputs
are fixed here:

- regular-season periods compare exact total milli-points;
- equal totals are recorded as a tie; hidden decimal precision or arbitrary
  commissioner choice cannot break it;
- playoff periods use the same activated model version unless a future version
  was explicitly scheduled before the postseason;
- a playoff tie advances the higher predeclared seed; seed is sealed before the
  matchup and never calculated from the tied score; and
- byes, bracket size, reseeding, number of playoff periods, and championship
  schedule are declared before the first scored period.

No matchup, standings, bracket, or playoff code is introduced by #125.

## Ownership and delegation

| Owner        | Creation and management authority                                                      | Activation authority                                                    |
| ------------ | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Platform     | Restricted reviewed release identity                                                   | Separate platform release approval                                      |
| Organization | Exact active Organization membership plus `fantasy.rules.manage`                       | Exact `fantasy.rules.activate` grant and separate Organization approval |
| League       | Exact active membership and exact League-scoped `fantasy.rules.manage`                 | Exact League-scoped `fantasy.rules.activate` and separate approval      |
| Account      | Current Account membership plus future exact Account `fantasy.rules.manage` capability | Future Account `fantasy.rules.activate` capability and Account approval |

The two fantasy capabilities are separate from generic organization, league,
ruleset, and competition capabilities. #107 lifecycle, expiration, revocation,
scope comparison, minimal audit, and fail-closed rules apply. Organization
authority cannot activate a model for an Account, inspect its roster, or select
its private players. Account-owned private models cannot be discovered by
another Account or by name.

An Account-owned capability is reserved here but is not added to a production
route or default role. Future persistence must register it as an exact Account
capability and require explicit approval before activation.

## Version lifecycle and historical binding

The only progression is:

```text
DRAFT -> REVIEWED -> ACTIVE -> DEPRECATED -> RETIRED
```

- **DRAFT:** editable, unselectable, and may recompute its digest.
- **REVIEWED:** semantic content sealed; rejection creates another draft rather
  than reopening content.
- **ACTIVE:** eligible for explicit future period activation.
- **DEPRECATED:** no new implicit selection; existing scheduled/historical
  bindings continue.
- **RETIRED:** no new bindings; historical replay remains available forever.

Review seals semantics before activation. Any scoring, eligibility, roster,
cadence, owner, statistic registry, or format change creates a new version.
Activation records exact model version/digest and a half-open effective period
range. Deprecation, retirement, renaming a family, or changing a default cannot
reinterpret an existing matchup or season.

## Privacy and security

Fantasy rule evaluation receives opaque player references and minimum verified
statistic/eligibility facts after Account authorization. Pure rule inputs carry
the exact Account id, trusted authority reference ids, and authorization time;
the production service must derive that evidence from the existing trusted
Account/#107 boundary, never from a browser boolean. It must not receive or
publish:

- birth date, age, youth classification, medical or eligibility notes;
- guardian/contact information or private player names;
- private analytics or fields disabled by Account privacy overlays;
- raw events, correction notes, provider claims, or credentials; or
- rosters, statistics, or identities from unrelated Accounts.

Public fantasy presentation needs a separate field allowlist and privacy review.
Hidden analytics cannot become a scoring input merely because an administrator
can view them. Cache keys include Account, model version/digest, source revision,
correction revision, and privacy-overlay revision. Revocation prevents cached
results from authorizing new reads.

## Audit and reproducibility

Create, edit, review, activate, deprecate, retire, and late-adjustment decisions
record actor, owner, model/version/digest, capability, scope, authority
references, accepted UTC timestamp, prior/resulting lifecycle, result, reason,
and correlation id. Activation and mutation fail if append-only audit cannot be
written atomically.

One fantasy score records all lineage fields defined above plus per-category
units and milli-points. Recalculation with the same sealed inputs must be byte-
equivalent. A mismatch is a reliability incident; it cannot be resolved by
changing historical model content.

## Portability

A portable fantasy rules envelope may carry family/version identity, semantic
content, digest, owner claim, registry compatibility, and provenance. Following
#101, the owner claim is evidence only. Import resolution requires an exact
digest match, reviewed mapping to a semantically identical local version, or
quarantine. Imports cannot choose an Account owner, activate a model, or rewrite
historical fantasy results.

Fantasy score/result packages remain deferred until #126 defines their
identities. #123 fantasy aggregates use stable references and sealed rule
bindings but do not manufacture fantasy points during baseball import.

## Database and implementation deferral

No schema or migration is included in #125. Persisting model families, versions,
activations, period bindings, eligibility snapshots, or fantasy results depends
on #124/#126 transaction and result decisions. A future implementation uses forward-only
migrations, preserved ids/digests, owner-scoped composite constraints, immutable
semantic columns after review, non-overlapping activation intervals, and
rollback by disabling selection rather than deleting history.

No fantasy domain entity, transaction, matchup, standings, playoff, UI,
notification, or offline implementation is introduced here.

## Focused test contract

Executable tests prove:

- deterministic identity/digest and new-version differentiation;
- one-way lifecycle, semantic tamper detection, and historical availability;
- exact integer scoring from verified final statistics only;
- registry extensibility without changing the scoring engine;
- missing, unverified, malformed, and registry-drift inputs fail closed;
- Account authorization, roster-at-lock, slot, appearance, and pitching-out
  eligibility;
- owner identity changes the digest;
- draft management and activation use separate #107 capabilities/approval; and
- sibling-League scope is denied.

Documentation tests lock the architecture, initial format, cadence, lifecycle,
privacy exclusions, correction rules, dependency boundaries, and deferrals.

## Adversarial review findings

### Fantasy commissioner

The weekly lock, single point total, explicit grace window, tie policy, and
published deadlines minimize manual intervention. Separate activation approval
prevents an accidental draft from changing live competition.

### Baseball rules and statistics maintainer

The fantasy engine consumes versioned aggregate projections only. Unsupported
wins/saves, missing values, and registry drift fail instead of inferring facts.
Fantasy code has no path back into canonical events or statistics.

### Security and SaaS authorization reviewer

Owner kind/id and exact League scope are digest-bound. Fantasy capabilities are
separate, activation requires approval, and Organization authority supplies no
Account or private-player access.

### Privacy reviewer

Eligibility needs appearances, pitching outs, roster-at-lock, and authorization
only. Protected youth, contact, medical, hidden analytics, and unrelated Account
data are explicitly excluded.

### Reliability reviewer

Integer scoring, sealed UTC periods, immutable versions, full lineage, bounded
finalization, append-only late adjustments, and explicit missing-data failure
remove wall-clock, floating-point, and silent-recalculation ambiguity.

## Deferred downstream work

- #123 defines fantasy league, manager, roster-snapshot, and player-reference
  entities in the [fantasy domain model](FANTASY_DOMAIN_MODEL.md).
- #124 owns transactions, waivers, trades, and their schedulers.
- #126 owns matchup execution, score persistence, standings, and playoffs.
- #127 owns configuration, lineup, results, and notification experiences.

Offline fantasy behavior and all M9 work remain out of scope.
