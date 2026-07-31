# M6 analytics observation stream

M6 now exposes optional, Account-scoped analytics observations without changing
the canonical scoring event model.

## Current release

- Verified season reports expose descriptive lineup, batter–pitcher matchup, and
  recent scoring-trend insights.
- Insight envelopes include source games, source revisions, ruleset and
  derivation versions, sample sizes, confidence, limitations, and freshness.
- Batted-ball classes continue to come from the canonical plate-appearance
  event. Missing classifications remain missing.
- Optional manual spray-sector and coarse pitch-zone observations are stored in
  `AnalyticsObservation` and linked to an accepted plate appearance.
- Observation writes require exact game-scoped `game.score` authority; reads
  require exact game-scoped `report.view` authority.
- Observations are append-only. A correction is represented by a new row that
  supersedes the current row at the same source-event/type/ordinal boundary.
- The report renders observed spray sectors and pitch-zone cells as counts. It
  never infers omitted pitches or locations from a plate-appearance outcome.

## Deliberate boundaries

The first release accepts only manual observations, bounded coarse cells, and
the two approved observation types. It does not collect video, audio, velocity,
spin, biometrics, GPS, body dimensions, or free text. It does not make claims
about defensive positioning, pitch quality, injury risk, player potential, or
causality.

Observation persistence is separate from source-event replay and statistics
derivation. Malformed or absent observations cannot change outs, bases, runs,
verification, box scores, or canonical statistics. The API returns only the
validated typed observation envelope; player names are resolved through the
existing authorized report path.

## Validation and rollout

The feature is disabled by absence of observations and remains safe for all
existing games. Rollout requires migration verification, relational
representability checks, Account-isolation tests, append-only/supersession
tests, accessible report checks, performance checks, and the final M6 suite.
