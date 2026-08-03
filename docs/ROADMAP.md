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

Turn the versioned statistics API, Discord bot, webhooks, pull-only calendar feeds, notifications, and exports into a safe integration surface.

Exit criteria: at least one external consumer uses a documented read contract; credentials, quotas, privacy, retries, deprecation, and support workflows are operational.

Owner: `@cryptnetworks` repository maintainers. Target date: 2027-04-02.
Primary epic: [#97](https://github.com/cryptnetworks/baseballstattrack/issues/97).

The accepted production trust tiers, surface ownership, onboarding,
credentials, quotas, compatibility, deprecation, and support contract are in
[Integrations and partner API program](INTEGRATIONS_AND_PARTNER_API_PROGRAM.md).
The implemented Account-scoped, pull-only ICS contract is in
[Calendar feeds](CALENDAR_SYNCHRONIZATION.md).

Primary issues: #73, #91–#99, #108–#121.

Discord control-plane delivery is complete under
[#108](https://github.com/cryptnetworks/baseballstattrack/issues/108). Its
settings, installation, web UI, routing, cadence, delivery, permissions,
preview, health, testing, and deployment evidence is recorded in the
[M5 Discord control-plane reconciliation](M5_DISCORD_CONTROL_PLANE_RECONCILIATION.md).
The implemented trigger, message-strategy, correction-presentation, and payload
budget contract is in [Discord update content](DISCORD_UPDATE_CONTENT.md).
The durable, version-aware execution boundary is in
[Discord update worker](DISCORD_UPDATE_WORKER.md).

## M6 — Advanced analytics

Add optional, explainable analytics such as batted-ball and pitch-location views, lineup and matchup insights, and trend analysis.

The M6 analytics charter and future insight contract are defined in
[Analytics charter](ANALYTICS_CHARTER.md). It establishes evidence,
uncertainty, privacy, correction, lifecycle, delivery, and disablement gates
before implementation work begins.

The observation-stream feasibility decision and M6 implementation gates are in
[Spray-chart and pitch-chart discovery](SPRAY_AND_PITCH_CHART_DISCOVERY.md).

Exit criteria: advanced insights are reproducible from versioned source data, disclose sample-size and ruleset assumptions, respect privacy, and never become required for core scoring.

Owner: `@cryptnetworks` repository maintainers. Target date: 2027-05-28.
Primary epic: [#102](https://github.com/cryptnetworks/baseballstattrack/issues/102).

Primary issues: #33, #102–#104.

## M7 — Progressive web application experience

Deliver an installable, mobile-first, online-only PWA shell with safe static
asset caching, visible connectivity state, secure authentication behavior,
and field-friendly navigation.

The implementation boundary is documented in
[PWA application experience](PWA_APPLICATION_EXPERIENCE.md). Offline scoring,
local event acceptance, background synchronization, conflict resolution,
offline authentication, and replicated local databases remain explicitly
deferred; the existing offline strategy is a future decision/design boundary.

Exit criteria: the application is installable, the service-worker cache cannot
serve private or scoring data, connection loss is explained without claiming
offline support, and the mobile shell meets accessibility and performance
targets.

Owner: `@cryptnetworks` repository maintainers. Target date: 2027-07-23.
Primary issue: [#105](https://github.com/cryptnetworks/baseballstattrack/issues/105).

Offline strategy and conflict-safe synchronization remain deferred under
[#100](https://github.com/cryptnetworks/baseballstattrack/issues/100) and
[#34](https://github.com/cryptnetworks/baseballstattrack/issues/34); they are
not part of this M7 implementation.

## M8 — League ecosystem

Support configurable league rulesets, portable historical data, and carefully delegated organization or league administration.

Exit criteria: multiple documented rulesets can coexist without reinterpreting historical games, imports remain auditable, and cross-team access is explicit and least-privilege.

Owner: `@cryptnetworks` repository maintainers. Target date: 2027-09-17.
Primary epic: [#106](https://github.com/cryptnetworks/baseballstattrack/issues/106).

Primary issues: #4, #26, #101, #106–#107, #122–#127.

The identity, immutable-version, ownership, activation, compatibility, and
historical game-binding foundation is defined in the
[Ruleset contract](RULESET_CONTRACT.md) and
[ADR 0010](decisions/0010-ruleset-identity-versioning-and-historical-binding.md).
The producer, provenance, ruleset-resolution, identity-review, quarantine, and
atomic-promotion boundary for portable baseball history is defined in
[Import portability](IMPORT_PORTABILITY.md) and
[ADR 0011](decisions/0011-import-portability-quarantine-and-atomic-promotion.md).
The separate Organization/League principal, Account-consent delegation,
capability, approval, audit, revocation, and minimum-field sharing boundary is
defined in the
[League delegation model](LEAGUE_DELEGATION_MODEL.md) and
[ADR 0012](decisions/0012-organization-and-league-delegation.md).
The independent fantasy scoring identity, weekly points format, category
extension, eligibility, lifecycle, correction, and privacy boundary is defined
in the [Fantasy rules contract](FANTASY_RULES_CONTRACT.md) and
[ADR 0013](decisions/0013-versioned-weekly-fantasy-points.md).
The Account-owned fantasy league, team, canonical player-reference, roster
snapshot, lifecycle, privacy, and exact authorization foundation is defined in
the [Fantasy domain model](FANTASY_DOMAIN_MODEL.md) and
[ADR 0014](decisions/0014-account-scoped-immutable-fantasy-aggregates.md).
The authorized add/drop/trade/lineup state machine, deterministic daily waiver
processing, concurrency/idempotency, rollback, locks, and audit contract is
defined in [Fantasy transactions](FANTASY_TRANSACTIONS.md) and
[ADR 0015](decisions/0015-deterministic-fantasy-roster-transactions.md).

The low-maintenance fantasy baseball option is defined by [#122](https://github.com/cryptnetworks/baseballstattrack/issues/122): weekly lineup decisions, automatic scoring, scheduled transactions, and low-noise notifications.

Native GitHub milestones M5–M8 are now materialized and assigned to their backlog issues. Use the native milestones together with the title prefixes, Target metadata, roadmap, and Projects Target field; issue #96 tracks final reconciliation of board views and planning metadata.
