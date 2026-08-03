# ADR 0016: Versioned fantasy results, matchups, and standings

## Status

Accepted

## Context

ADRs 0013–0015 define immutable fantasy rules, Account-owned league/roster
aggregates, and append-only roster transactions. M8 now needs deterministic
weekly results, matchups, standings, playoff qualification, and corrections
without treating incomplete data as final or allowing fantasy output to mutate
baseball truth.

Storing only current points or standings would lose the exact locked roster,
model, baseball ruleset, statistic derivation, source revision, correction, and
prior result that produced them. Recalculating every historical result in place
would silently rewrite competition history.

## Decision

Implement a framework-independent scoring engine with three immutable result
layers:

1. a team-period result derived from one locked active lineup, exact fantasy
   model, and verified statistic sources;
2. a matchup result derived from two exact team-period result revisions; and
3. standings derived from exact regular-season matchup result revisions.

Every layer has a stable result id, monotonically ordered predecessor chain,
source digest, result digest, calculation version, caller-supplied accepted UTC
time, direct fantasy-model/baseball-ruleset/statistic/source version lineage,
and minimal authorization audit. Aggregate layers reject mixed fantasy model
versions. Corrections append new revisions with an explicit reason and preserve
the previous result/digest.

Incomplete, unverified, missing, and insufficient-sample sources do not score.
They remain visible uncertainty through the declared completion grace. After
the grace deadline they remain visibly excluded so the period may finalize
without inventing values.

The initial format aggregates exact integer category units/milli-points and
total milli-points. Regular ties remain ties. Playoff/championship ties use the
higher predeclared seed. Standings rank by standing points, differential,
points for, predeclared seed, then stable team id. Qualification is final only
after the regular season and its supplied matchups are final.

All calculations require exact Account/league
`fantasy.scoring.calculate` authority. No database schema, API, worker, UI, or
offline behavior is added.

## Consequences

- Replaying sealed inputs is deterministic and byte-equivalent.
- Every result retains fantasy model, baseball ruleset, statistic derivation,
  statistic-rules, source, correction, roster, and predecessor lineage.
- Corrected statistics produce new team, matchup, and standings revisions
  without changing prior competition history.
- Participants can receive explicit matchup status, projected completion,
  uncertainty, standings, streak, and qualification facts once #127 supplies a
  privacy-reviewed read surface.
- A future relational design now has complete immutable period/result reference
  identities, but must still add transactionality, RLS, workers, and APIs.

## Alternatives rejected

### Score directly from baseball events

Rejected because it duplicates baseball interpretation and could drift from
the canonical statistic derivation.

### Treat incomplete or missing statistics as silent zero

Rejected because it hides uncertainty and can finalize a misleading matchup.

### Update current results and standings in place

Rejected because corrections would destroy historical lineage and audit.

### Use floating-point points or hidden tie precision

Rejected because runtime/serialization drift and invisible values can change a
winner.

### Give Organization membership implicit scoring access

Rejected because verified statistics and fantasy results remain exact-Account
data under ADR 0012.

## Revisit triggers

Revisit when a new scoring format needs category wins or roto ranking, a future
worker/persistence design cannot represent the immutable revision chains, or a
privacy review changes which aggregate facts can be presented. Any superseding
decision must preserve the one-way baseball boundary, exact version lineage,
visible uncertainty, deterministic replay, Account isolation, and append-only
corrections.
