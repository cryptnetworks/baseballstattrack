# Database storage capacity

This runbook defines the storage guardrail for the active PostgreSQL data
volume. It detects risk and directs an operator response; it never deletes
records, shrinks a volume, disables PostgreSQL, corrupts or rejects writes, or
blocks emergency recovery.

## Capacity policy

The PostgreSQL database volume must remain below 75% of the capacity of the
host storage volume on which the PostgreSQL data directory resides. At exactly
75% the volume is still in the warning band, but expansion is immediate work;
usage above 75% is critical.

This headroom preserves room for database writes, WAL, indexes, migrations,
vacuum and other maintenance, temporary work, and recovery operations. A SQL
database-size query is not sufficient because it can omit WAL, temporary,
filesystem, and other host consumption.

| Usage      | Status   | Operator action                                                                                          |
| ---------- | -------- | -------------------------------------------------------------------------------------------------------- |
| Below 70%  | Healthy  | Continue normal operation and growth monitoring.                                                         |
| 70% to 75% | Warning  | Review growth, backup success and size, retention, logs, and artifacts; schedule expansion.              |
| Above 75%  | Critical | Expand storage before normal operation continues; investigate unexpected growth and policy-safe cleanup. |

Policy-safe cleanup means only expired logs, images, artifacts, or retained
operational data whose documented retention permits removal. Never silently
delete application records, accepted baseball events, audits, current backups,
or PostgreSQL files.

## Self-hosted PostgreSQL check

`npm run db:storage:check` reads filesystem totals through `df` and reports the
configured volume label, total and used capacity, usage percentage, status,
action, and the portable metric `database_storage_usage_percent`. It does not
connect to PostgreSQL, enumerate files, print a device path, or read secrets.

The checker defaults to the Compose data path and safe thresholds:

```text
DB_STORAGE_PATH=/var/lib/postgresql/data
DB_STORAGE_VOLUME_NAME=postgres-production-data
DB_STORAGE_WARNING_PERCENT=70
DB_STORAGE_CRITICAL_PERCENT=75
```

Operators may lower either threshold to alert earlier. The checker rejects a
warning value above 70, a critical value above 75, non-integer values, or a
warning value that is not lower than critical. Configuration therefore cannot
bypass the production ceiling.

For the repository Compose deployment, use a checkout matching the deployed
image SHA and execute its checked-in script inside the PostgreSQL container so
`df` observes the filesystem that actually backs the named data volume:

```sh
docker compose \
  --env-file /etc/baseballstattrack/production.env \
  exec --no-TTY \
  -e DB_STORAGE_PATH=/var/lib/postgresql/data \
  -e DB_STORAGE_VOLUME_NAME=postgres-production-data \
  -e DB_STORAGE_WARNING_PERCENT=70 \
  -e DB_STORAGE_CRITICAL_PERCENT=75 \
  db bash -s < scripts/check-database-storage.sh
```

Run it at least every five minutes from host monitoring and after unexpected
database growth, a large migration, or a restore. Exit codes are `0` healthy,
`1` warning, `2` critical, and `3` unknown/configuration failure. Route warning,
critical, and unknown results to operators. A critical result may gate ordinary
deployments, but it must not prevent an explicitly authorized emergency backup,
restore, repair, or capacity expansion.

The application `/api/health` and `/api/ready` endpoints intentionally do not
run this check: the application container cannot reliably see the database
host filesystem, and capacity risk should not restart or remove a healthy
database from service.

## Managed PostgreSQL and Supabase

For a managed database, the provider—not the application host—owns and observes
the database filesystem. Use the provider-reported database disk usage and
capacity, normalize it to `database_storage_usage_percent`, and apply the same
70% warning and above-75% critical routes. Supabase Database Reports and the
Compute and Disk settings are the Cloud visibility boundary; self-hosted
Supabase does not provide the Cloud Reports surface.

Do not substitute PostgreSQL relation size or the app host's free space for the
provider disk metric. Provider auto-scaling or read-only protection is a last
resort, not compliance with this policy; operators must preserve the 25%
headroom themselves.

## Whole-host and backup capacity

The 75% ceiling applies to the filesystem containing active PostgreSQL data. It
does not make backup, log, artifact, temporary, or container-image storage
unlimited. Monitor each separate storage volume and the host overall. Keep
backup archives on a separate failure domain with capacity for the documented
retention and restore drills, and ensure migrations and restores have temporary
working space before starting them.
