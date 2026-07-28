# Product roadmap

This roadmap is deliberately outcome-based. Issue numbers are the source of execution detail; milestones and the Projects board should mirror these targets.

## M0 — Foundation

Choose the stack and architecture, define scoring semantics, establish local development, CI, database migration rules, authentication and privacy boundaries, and observability conventions. See [PRIVACY_AND_THREAT_MODEL.md](PRIVACY_AND_THREAT_MODEL.md).

Exit criteria: a new contributor can run the app and tests; core decisions are recorded; the repository has required checks and protected-main settings.

## M1 — Domain and data

Model organizations or teams, seasons, players, games, lineups, defensive assignments, pitching appearances, and immutable scoring events. Define deterministic stat derivation and correction or replay behavior.

Exit criteria: representative games can be stored, replayed, corrected, and recalculated with stable test fixtures.

## M2 — Scorekeeping MVP

Deliver game setup, lineup management, fast plate-appearance entry, base and out state, substitutions, pitching changes, corrections, autosave or recovery, and a verified box score.

Exit criteria: a scorekeeper can complete a representative game on a touch device without editing raw data.

## M3 — Season experience

Add season dashboards, batting, pitching, and fielding summaries, game history, printable reports, exports, accessibility polish, and responsive performance.

Exit criteria: a coach can answer common season questions and share a trustworthy game report.

## M4 — Production readiness

Harden authorization, auditability, backups, restore, observability, rate limits, performance, dependency security, release automation, and operational documentation.

Exit criteria: a documented production release can be deployed, monitored, rolled back, and recovered.
