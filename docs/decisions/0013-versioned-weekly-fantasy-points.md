# ADR 0013: Versioned weekly head-to-head fantasy points

## Status

Accepted

## Context

M8 needs a fantasy rules foundation that is understandable and low-maintenance
without allowing fantasy concerns to alter baseball truth. The system already
has immutable baseball ruleset bindings, replayable events, versioned statistics,
portable provenance, and explicit Organization/League delegation. It does not
yet have fantasy league, roster, transaction, matchup, or UI entities.

The decision must select an initial scoring format, preserve reproducibility,
support future formats, define period/correction behavior, and avoid private
player traits in eligibility.

## Decision

The initial format is weekly head-to-head points with one full-lineup lock at a
sealed weekly UTC boundary. Verified final statistic counters are multiplied by
signed integer milli-point weights and summed. Equal regular-season totals tie;
a playoff tie advances the higher seed declared before the matchup.

Fantasy scoring model families and versions have stable identities, explicit
owners, semantic registry/category/eligibility/roster/cadence content, one-way
lifecycle, and a SHA-256 semantic digest. Review seals content. Every activation
and result binds an exact version/digest; historical replay never chooses latest.

Fantasy scoring consumes versioned statistics only and produces derived fantasy
lineage. It cannot write baseball events, statistics, ruleset bindings,
corrections, or verification state. Missing, unverified, unsupported, or
incompatible statistics fail explicitly.

Eligibility uses exact Account authorization, roster state at lock, verified
position appearances, and pitching outs. It excludes age, medical, contact,
youth, hidden analytics, and unrelated Account data.

Organization/League owners use separate `fantasy.rules.manage` and
`fantasy.rules.activate` capabilities under ADR 0012. Activation requires an
exact approval. No generic administrator or ruleset capability implies fantasy
authority.

Issue #125 implements the pure rule/digest/scoring/eligibility boundary and
documentation only. Persistence and fantasy entities remain deferred.

## Consequences

- Participants have one required weekly decision and no required daily action.
- Exact integer arithmetic and full lineage make results reproducible.
- New formats and statistic adapters can be added by new versioned engines and
  registries without reinterpreting history.
- Unsupported categories such as wins and saves cannot ship until canonical,
  reproducible statistic sources exist.
- Period finalization needs a bounded grace window; late canonical corrections
  require an explicit append-only fantasy adjustment rather than silent change.
- #123, #124, #126, and #127 can depend on this contract but are not implemented.

## Alternatives rejected

### Daily lineups

Rejected for the initial format because they increase required attention,
deadline errors, notification volume, and postponed-game complexity.

### Head-to-head categories as the initial format

Rejected because category ties and weekly category standings are harder to
explain and implement. It remains a future versioned format.

### Floating-point weights

Rejected because arithmetic and serialization differences can change close
results. Integer milli-points are exact and still support fractional weights.

### Score directly from events

Rejected because that duplicates baseball interpretation and risks fantasy code
changing canonical meaning. Versioned statistics are the only input boundary.

### Recalculate every historical result after a stat correction

Rejected because it silently rewrites completed competition. The initial policy
accepts corrections before finalization and requires an explicit late adjustment
afterward.

## Revisit triggers

Revisit when a new fantasy format has a reviewed engine contract, canonical
statistics add new categories, product research demonstrates a different
acceptable weekly burden, or #123/#126 persistence reveals an unrepresentable
identity or lineage requirement. Revisions must preserve the one-way baseball
boundary and immutable historical bindings.
