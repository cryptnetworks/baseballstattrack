# Design choices

This section explains why the production system is structured as it is. These
pages document supported architecture, security, privacy, data, integration,
and user-experience decisions. They do not provide local-development, test,
contribution, issue, branch, or pull-request procedures.

Calculation formulas and baseball rulings are indexed separately in
[Rules and calculations](RULES_AND_CALCULATIONS.md).

## Source of truth and data model

- [Immutable game-event model](IMMUTABLE_GAME_EVENT_MODEL.md)
- [Persistence and Account tenancy](PERSISTENCE_AND_TENANCY.md)
- [Relational domain schema](RELATIONAL_DOMAIN_SCHEMA.md)
- [Correction audit and replay](CORRECTION_AUDIT_AND_REPLAY.md)
- [Data-quality reconciliation](DATA_QUALITY_RECONCILIATION.md)

Accepted game events remain immutable. Corrections append new evidence, and
statistics are rebuilt deterministically from effective event history. Every
Account-owned relationship carries an explicit tenant boundary.

## Identity, security, and privacy

- [Authentication and authorization](AUTHENTICATION_AND_AUTHORIZATION.md)
- [Authentication provider boundaries](AUTHENTICATION_PROVIDERS.md)
- [Production authentication and team isolation](PRODUCTION_AUTHENTICATION_AND_TEAM_ISOLATION.md)
- [Privacy and threat model](PRIVACY_AND_THREAT_MODEL.md)
- [Privacy lifecycle](PRIVACY_LIFECYCLE.md)
- [Rate limits and abuse prevention](RATE_LIMITS_AND_ABUSE_PREVENTION.md)

Identity-provider authentication establishes identity only. Application-owned
memberships and capabilities establish authority, with exact Account and
resource scope checked server-side.

## APIs and integrations

- [Statistics API v1](STATISTICS_API_V1.md)
- [API versioning and compatibility](API_VERSIONING_AND_COMPATIBILITY.md)
- [External data ingestion](EXTERNAL_DATA_INGESTION.md)
- [Outbound notifications](OUTBOUND_NOTIFICATIONS.md)
- [Webhooks](WEBHOOKS.md)
- [Calendar synchronization](CALENDAR_SYNCHRONIZATION.md)

External boundaries preserve Account authorization, source provenance,
versioned contracts, retries, correction state, privacy allowlists, and
failure isolation.

## Product and experience

- [Product scope](PRODUCT_SCOPE.md)
- [Progressive Web App](PWA_APPLICATION_EXPERIENCE.md)
- [Responsive performance and accessibility](RESPONSIVE_PERFORMANCE_AND_ACCESSIBILITY.md)
- [Scorekeeping usability and accessibility](SCOREKEEPING_USABILITY_AND_ACCESSIBILITY.md)
- [Performance and load budgets](PERFORMANCE_AND_LOAD_BUDGETS.md)

The experience is online-first, touch-friendly, keyboard-operable, responsive,
and server-authoritative. Accessibility and performance claims remain bounded
by documented evidence rather than inferred from implementation alone.

## Fantasy architecture

- [Fantasy league ecosystem](FANTASY_LEAGUE_ECOSYSTEM.md)
- [Fantasy domain model](FANTASY_DOMAIN_MODEL.md)
- [Fantasy transactions](FANTASY_TRANSACTIONS.md)
- [Fantasy scoring and matchups](FANTASY_SCORING_AND_MATCHUPS.md)

Fantasy consumes verified baseball data and immutable scoring-model versions.
It cannot mutate canonical baseball history, identity, corrections, or
official statistics.
