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

Add season dashboards, batting, pitching, and fielding summaries, game history,
printable reports, exports, accessibility polish, and responsive performance.
The measured engineering baseline is documented in
[RESPONSIVE_PERFORMANCE_AND_ACCESSIBILITY.md](RESPONSIVE_PERFORMANCE_AND_ACCESSIBILITY.md).

Exit criteria: a coach can answer common season questions and share a trustworthy game report.

## M4 — Production readiness

Harden authorization, auditability, backups, restore, observability, rate limits, performance, dependency security, release automation, and operational documentation.

Exit criteria: a documented production release can be deployed, monitored, rolled back, and recovered.

## M5 — Integrations and ecosystem

Turn the versioned statistics API, Discord bot, webhooks, calendar synchronization, notifications, and exports into a safe integration surface.

Exit criteria: at least one external consumer uses a documented read contract; credentials, quotas, privacy, retries, deprecation, and support workflows are operational.

Owner: `@cryptnetworks` repository maintainers. Target date: 2027-04-02.
Primary epic: [#97](https://github.com/cryptnetworks/baseballstattrack/issues/97).

The accepted production trust tiers, surface ownership, onboarding,
credentials, quotas, compatibility, deprecation, and support contract are in
[Integrations and partner API program](INTEGRATIONS_AND_PARTNER_API_PROGRAM.md).
The implemented Account-scoped, one-way external calendar contract is in
[Calendar synchronization](CALENDAR_SYNCHRONIZATION.md).

Primary issues: #73, #91–#99, #108–#121.

Discord control-plane delivery is tracked by [#108](https://github.com/cryptnetworks/baseballstattrack/issues/108) and its child issues covering settings, installation, web UI, routing, cadence, delivery, permissions, previews, health, testing, and deployment.

## M6 — Advanced analytics

Add optional, explainable analytics such as batted-ball and pitch-location views, lineup and matchup insights, and trend analysis.

The observation-stream feasibility decision and M6 implementation gates are in
[Spray-chart and pitch-chart discovery](SPRAY_AND_PITCH_CHART_DISCOVERY.md).

Exit criteria: advanced insights are reproducible from versioned source data, disclose sample-size and ruleset assumptions, respect privacy, and never become required for core scoring.

Owner: `@cryptnetworks` repository maintainers. Target date: 2027-05-28.
Primary epic: [#102](https://github.com/cryptnetworks/baseballstattrack/issues/102).

Primary issues: #33, #102–#104.

## M7 — Offline and mobile

Make scorekeeping resilient to unreliable connectivity through conflict-safe sync, an installable PWA, and secure device recovery.

The accepted bounded single-writer authority model, M2 reuse map, and M7
go/no-go gates are in
[Offline scoring and conflict-safe sync decision](OFFLINE_SCORING_AND_SYNC_DECISION.md).

Exit criteria: an interrupted or offline game can be recovered without duplicate or lost events, and the mobile scoring workflow meets accessibility and performance targets.

Owner: `@cryptnetworks` repository maintainers. Target date: 2027-07-23.
Primary epic: [#100](https://github.com/cryptnetworks/baseballstattrack/issues/100).

Primary issues: #34, #100, #105.

## M8 — League ecosystem

Support configurable league rulesets, portable historical data, and carefully delegated organization or league administration.

Exit criteria: multiple documented rulesets can coexist without reinterpreting historical games, imports remain auditable, and cross-team access is explicit and least-privilege.

Owner: `@cryptnetworks` repository maintainers. Target date: 2027-09-17.
Primary epic: [#106](https://github.com/cryptnetworks/baseballstattrack/issues/106).

Primary issues: #4, #26, #101, #106–#107, #122–#127.

The low-maintenance fantasy baseball option is defined by [#122](https://github.com/cryptnetworks/baseballstattrack/issues/122): weekly lineup decisions, automatic scoring, scheduled transactions, and low-noise notifications.

Native GitHub milestones M5–M8 are now materialized and assigned to their backlog issues. Use the native milestones together with the title prefixes, Target metadata, roadmap, and Projects Target field; issue #96 tracks final reconciliation of board views and planning metadata.
