# Rules and calculations

This is the single index for documentation that explains how Baseball Stat
Track determines outcomes. Start here when reviewing a baseball ruling, a
calculated statistic, a replayed correction, an analytical result, or a fantasy
result.

## Scoring truth

- [Scoring semantics and event vocabulary](SCORING_SEMANTICS.md) defines the
  supported baseball outcomes and their meaning.
- [Immutable game-event model](IMMUTABLE_GAME_EVENT_MODEL.md) defines the event
  history that calculations replay.
- [Deterministic statistic derivation](STATISTIC_DERIVATION.md) defines exact
  batting, pitching, fielding, and team formulas.
- [Scoring fixtures](SCORING_FIXTURES.md) provides representative executable
  examples for those rules.

## Corrections and data quality

- [Correction audit and replay workflow](CORRECTION_AUDIT_AND_REPLAY.md)
- [Data-quality reconciliation](DATA_QUALITY_RECONCILIATION.md)

Corrections preserve the original history and produce a new deterministic
result. They do not silently rewrite the event that was originally recorded.

## Fantasy results

- [Fantasy domain model](FANTASY_DOMAIN_MODEL.md)
- [Fantasy transactions and roster management](FANTASY_TRANSACTIONS.md)
- [Fantasy scoring, matchups, and standings](FANTASY_SCORING_AND_MATCHUPS.md)

## Analytics and interpretation

- [Analytics charter](ANALYTICS_CHARTER.md)
- [Analytics observation stream](ANALYTICS_OBSERVATION_STREAM.md)
- [Consent-aware product analytics and privacy review](PRODUCT_ANALYTICS_AND_PRIVACY.md)
- [Spray-chart and pitch-chart discovery](SPRAY_AND_PITCH_CHART_DISCOVERY.md)

These documents distinguish deterministic product calculations from
descriptive analytics and exploratory future capabilities.
