# Operations and security

Use this section to deploy, protect, observe, recover, and maintain Baseball
Stat Track. Installation commands are collected in
[Production installation](PRODUCTION_INSTALLATION.md).

## Identity, authorization, and privacy

- [Authentication and authorization boundaries](AUTHENTICATION_AND_AUTHORIZATION.md)
- [Authentication providers, sessions, and migration](AUTHENTICATION_PROVIDERS.md)
- [Production authentication and team isolation](PRODUCTION_AUTHENTICATION_AND_TEAM_ISOLATION.md)
- [Application configuration management](CONFIGURATION_MANAGEMENT.md)
- [Privacy and threat model](PRIVACY_AND_THREAT_MODEL.md)
- [Privacy lifecycle, export, and deletion](PRIVACY_LIFECYCLE.md)
- [Rate limits, abuse prevention, and quotas](RATE_LIMITS_AND_ABUSE_PREVENTION.md)

## Reliability and recovery

- [Backup and restore](BACKUP_AND_RESTORE.md)
- [Database storage capacity](DATABASE_STORAGE_CAPACITY.md)
- [Production reliability and incident response](PRODUCTION_RELIABILITY.md)
- [Observability, audit, and alerting](OBSERVABILITY_AUDIT_AND_ALERTING.md)

## Production service quality

- [Performance and load budgets](PERFORMANCE_AND_LOAD_BUDGETS.md)
- [Production reliability and incident response](PRODUCTION_RELIABILITY.md)
- [Container operations](CONTAINER_OPERATIONS.md)
- [Production Docker Compose deployment](PRODUCTION_COMPOSE.md)

Raw repository audits, source-release procedures, development quality gates,
and security finding evidence remain repository-only. The public Wiki contains
supported controls and operating guidance, not development workflow or
sensitive finding detail.

Treat credentials, player information, account data, exports, backups, logs,
and integration payloads according to these controls. Report suspected
vulnerabilities through the repository's private security-reporting process,
not through a public issue.
