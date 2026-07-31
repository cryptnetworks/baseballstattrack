# Analytics charter

Status: M6 foundation for issue [#102](https://github.com/cryptnetworks/baseballstattrack/issues/102). This document defines contracts and safety gates; it does not implement analytics features.

## Purpose

Baseball Stat Track analytics help authorized coaches and team staff understand
verified baseball performance without weakening the scorekeeping source of
truth. The first analytics questions should support:

- coaching decisions grounded in recorded games;
- player development conversations within an authorized team context;
- lineup-history and matchup review; and
- trend discovery with explicit sample and data-quality limits.

Analytics are descriptive decision support. They are not a replacement for a
coach, a guarantee about future performance, or a claim that an observed
association is causal.

Analytics must not provide:

- automatic coaching decisions or player selection;
- player rankings without context, scope, or sample disclosure;
- medical, health, injury, or protected-trait evaluation;
- predictions presented as certainty; or
- cross-Account or hidden player comparisons.

## Scope and non-goals

Core scoring events, replay, corrections, verification, and deterministic
statistics remain authoritative. An insight is a derived presentation with a
bounded purpose, never a new source of scoring truth. Analytics cannot mutate a
game, correction, roster, authorization record, or provider evidence.

The initial M6 scope is limited to explainable, optional analytics built from
existing event-derived data. Advanced capture is a separate gate owned by
issue [#104](https://github.com/cryptnetworks/baseballstattrack/issues/104).

## Principles

### Evidence first

Every insight must be traceable to the evidence used to produce it:

- source games and the relevant source players or teams;
- effective events and derived statistics;
- the statistic derivation version;
- the active ruleset version;
- the source or provider revision;
- correction and verification state; and
- the retrieval or generation time and freshness state.

An insight that cannot expose this lineage is not releasable. Explanations must
describe the observed evidence and calculation, not invent a narrative about
intent, ability, health, or future outcomes.

### Reproducibility

The same authorized source revisions, ruleset, derivation version, feature
configuration, and privacy-overlay revision must produce the same insight
envelope and ordering. A feature must record the contract or implementation
revision used to generate it. Randomness, current roster lookups, wall-clock
state, locale, and database row order must not change a historical result.

### Uncertainty is visible

Sample size is a release gate, not a promise of statistical certainty. The
minimum thresholds below are product guardrails for descriptive reporting and
must be reviewed with each feature's denominator and population:

| Use case                                   |                                   Limited display |                                  Supported display | Required denominator                           |
| ------------------------------------------ | ------------------------------------------------: | -------------------------------------------------: | ---------------------------------------------- |
| Overall batting, pitching, or season trend |            20 opportunities and 3 completed games |             50 opportunities and 5 completed games | Relevant PA, BF, or other declared opportunity |
| Lineup history or team trend               | 3 observed lineup instances and 5 completed games | 5 observed lineup instances and 10 completed games | Declared lineup or team observations           |
| Player matchup summary                     |                     10 relevant PA across 3 games |                      25 relevant PA across 5 games | Matching PA only                               |
| Batted-ball analysis                       |                   20 balls in play across 3 games |                    50 balls in play across 5 games | Observed balls in play                         |
| Pitch-location analysis                    |                        100 pitches across 3 games |                         250 pitches across 5 games | Observed pitches with valid location           |

These thresholds do not make a result predictive or causal. Each insight must
also disclose the population, exclusions, missingness, correction state,
ruleset, and selection limitations.

Confidence is an explicit product state:

- `INSUFFICIENT`: below the declared minimum or missing a required dependency;
  do not present a trend or comparison as an insight.
- `LIMITED`: meets the limited threshold; show a prominent small-sample and
  uncertainty warning.
- `SUPPORTED`: meets the supported threshold and data-quality gates; show
  limitations and source counts, and use descriptive language only.
- `STRONG`: reserved for a feature-specific, documented evidence gate beyond
  `SUPPORTED`; it never means guaranteed, causal, or predictive.

Confidence is not inferred from sample size alone. Stale, incomplete,
unverified, integrity-failure, or unresolved-correction data must lower or block
confidence according to the feature policy. Missing observations remain
unknown; they are never converted to zero.

If data is sparse, incomplete, stale, corrected but not reverified, or missing
from an upstream provider, the UI and API must say so. A neutral or unavailable
result is safer than a fabricated zero or an apparently precise conclusion.

## Privacy and authorization

Analytics may use only authorized baseball-performance data needed for the
declared question. Server-side Account, team, season, game, and capability
checks run before source selection, aggregation, quota disclosure, or response
generation. A browser filter, external identifier, provider claim, or Discord
role name never creates authority.

Explicitly prohibited analytics include:

- medical, injury, health, disability, or physical-condition inference;
- protected personal information or unrelated personal profiling;
- youth profiling beyond the authorized baseball-performance context;
- hidden comparisons between players, teams, or Accounts;
- public discovery of youth players or private rosters; and
- re-identification from small groups or suppressed views.

Visibility boundaries are:

- **Coach or team staff:** insights for the current authorized Account and
  selected team or season, subject to the capability required by the report.
- **Team scope:** aggregations must remain inside the selected team and its
  authorized seasons; historical team membership must not be replaced by the
  current roster silently.
- **Account scope:** Account administrators may see only Account-authorized
  teams and the minimum aggregate needed for their role. No cross-Account
  comparison is implied.
- **Future parent or player scope:** no access is granted by this charter.
  A future portal must define its own subject scope, consent, minimization,
  export, deletion, and denial behavior before using analytics.

Privacy overlays, deletion, revocation, and authorization changes invalidate
affected insight projections. Analytics APIs and exports must apply the same
field allowlists and correction/freshness labels as the underlying report
contract.

## Corrections, replay, and freshness

Analytics must follow the existing append-only correction and replay model:

- a changed game advances its source revision and invalidates affected
  insights;
- a correction triggers a bounded rebuild or marks the insight unavailable
  until rebuild and verification complete;
- a provider update is staged and reconciled before it can affect canonical
  analytics;
- a stale projection cannot be presented as current;
- a corrected game remains visibly corrected, even after a successful rebuild;
  and
- when a player changes teams, historical insights retain the original game,
  season, team, and ruleset scope rather than silently moving history to the
  current roster.

Insight consumers must replace or annotate derived output after a correction.
They must not cache an old value as current merely because the request still
uses the same player or team identifier.

## Analytics data contract

The future contract is an envelope around a derived result. It is a conceptual
contract for M6 planning, not a request to add a database model now. Adapt
field names to the existing external-identifier and authorization conventions;
do not expose internal database, membership, event-row, or provider-subject
identifiers.

```text
Insight {
  id
  type
  accountScope
  teamScope
  seasonScope
  createdAt
  generatedAt

  sourceGames[]
  sourcePlayers[]
  sourceRevision
  derivationVersion
  rulesetVersion
  featureVersion

  sampleSize {
    games
    opportunities
    denominator
    missingObservations
  }
  confidence
  limitations[]
  generatedFrom
  correctionState
  verificationState
  freshness
}
```

Required contract behavior:

- `type` maps to a documented question and declared denominator;
- scope is explicit and authorized before data is read;
- source arrays identify the games and subjects needed to reproduce the result;
- versions identify the rules, derivation, feature, and source revisions;
- sample size includes the denominator and meaningful missing observations;
- confidence and limitations are machine-readable and human-visible;
- correction, verification, and freshness states prevent stale presentation;
- `generatedFrom` identifies the query or fixture contract, not a secret or
  internal database query; and
- disabled or unauthorized insight requests fail closed without revealing
  hidden data or whether a private subject exists.

## Feature lifecycle and ownership

Every analytics feature must declare an owner, documentation, supported
question, data contract, privacy review, sample policy, disable mechanism, and
rollback path. Lifecycle states are:

1. **Experimental** — internal fixtures and adversarial review only.
2. **Internal** — authorized staff or test Accounts; no general user promise.
3. **Beta** — opt-in, observable, reversible, and clearly caveated.
4. **Released** — documented, versioned, monitored, and covered by compatibility
   and privacy tests.
5. **Deprecated** — replacement and migration guidance exist; new use is
   blocked.
6. **Disabled** — the feature cannot publish results; existing derived output
   is hidden or labeled according to the retention and privacy policy.

Disablement must stop publication without mutating canonical scoring history.
Rollback must be able to restore the prior feature version or safely remove
only the affected derived output. A release cannot depend on an analytics
feature being enabled for scorekeeping, reports, authorization, or data
integrity.

## Supported categories

### Existing-data analytics

The current event and statistic architecture can support, subject to this
charter and the feature's own contract:

- batting trends;
- pitching trends;
- lineup history;
- matchup summaries; and
- season patterns.

These categories must use verified, replayable source data and must distinguish
observation from prediction.

### Future-capture analytics

These categories require additional data decisions and are not supported merely
because the UI can draw a chart:

- spray charts;
- pitch-location charts; and
- detailed batted-ball analysis.

Missing advanced fields must remain missing. Existing games remain interpretable
when those fields are absent.

## Boundary for #103

Issue [#103](https://github.com/cryptnetworks/baseballstattrack/issues/103)
may build lineup insights, matchup summaries, and trends from existing verified
data. It must:

- answer a named coach question;
- use the Insight contract and declared denominator;
- show sample size, confidence, limitations, ruleset, derivation, and source
  games;
- produce a neutral or unavailable response for sparse, unsupported, stale, or
  unauthorized data;
- avoid automatic player selection, context-free rankings, medical claims, and
  causal or guaranteed language; and
- provide a per-Account or per-team disable path.

#103 must not expand into batted-ball capture, pitch location, provider
activation, fantasy scoring, Discord control-plane work, or M7 offline work.

## Boundary for #104

Issue [#104](https://github.com/cryptnetworks/baseballstattrack/issues/104)
may design and implement optional batted-ball and pitch-location capture and
visualization only after it resolves:

- the permitted data source and whether the input is observed or derived;
- privacy and youth-data minimization;
- storage and retention boundaries;
- ingestion and canonical-publication behavior;
- missingness, confidence, and correction semantics; and
- device and query performance budgets.

This charter does not add event fields, database columns, provider mappings, or
chart components. Mandatory pitch-by-pitch capture remains out of scope for the
core scoring workflow.

## External data boundary

The approved-provider ingestion framework exists, but live MLB activation and
canonical publication remain gated by written provider approval, terms,
attribution, capability, quota, retention, and identity/ruleset publisher
review. The application does not treat public web access as permission to
automate collection.

Only authorized, published, correction-aware data may feed analytics. Staged,
quarantined, malformed, ambiguous, or provider evidence that has not passed
canonical reconciliation cannot appear as an insight. Analytics must work from
available first-party event data and must not claim coverage from an unavailable
provider.

## Delivery API boundary

Future analytics may be delivered through the web application, a versioned API,
Discord, or exports. This issue implements none of those surfaces. Each surface
must define:

- an explicit version and compatibility policy;
- Account/team/season permissions and privacy filtering;
- freshness, correction, verification, and confidence fields;
- disabled, unsupported, and insufficient-data responses; and
- redaction and audit behavior appropriate to the surface.

API v1, webhooks, Discord, and exports remain separate contracts. Approval for
one surface does not authorize another.

## Testing and release gates

Charter-level tests must protect policy rather than fabricate analytics values.
At minimum they verify that the documented contract:

- classifies existing-data and future-capture categories;
- requires confidence and sample disclosure;
- rejects or neutralizes unsupported and insufficient-data cases;
- treats missing observations as unknown rather than zero;
- requires stale/corrected/verification state handling; and
- keeps privacy prohibitions and lifecycle controls explicit.

Before any analytics feature moves beyond experimental, review it from six
perspectives:

- **Coach:** does it answer a useful question without hiding the evidence?
- **Statistician:** are denominators, thresholds, uncertainty, and comparison
  populations explicit?
- **Privacy engineer:** are scope, field allowlists, revocation, and audit
  behavior enforced server-side?
- **Youth-data reviewer:** does the feature avoid profiling, re-identification,
  and unnecessary personal data?
- **Data scientist:** are missingness, selection bias, correction state, and
  non-causal language disclosed?
- **Product manager:** does the feature have an owner, lifecycle state, success
  measure, disable path, and rollback plan?

Material findings block release until the contract, implementation, or scope is
revised and retested. The review does not authorize #103, #104, M5 Discord
work, or M7 implementation from this charter.

## Decisions deferred to implementation issues

- exact analytics formulas and feature-specific denominators;
- the versioned API or report shape for each released insight;
- provider activation and canonical publication;
- additional event or storage fields for #104;
- visualization and device interaction design; and
- delivery through Discord, notifications, or exports.

These decisions must remain consistent with this charter and be documented in
their implementation or architecture changes.
