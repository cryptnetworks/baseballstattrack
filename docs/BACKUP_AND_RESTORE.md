# Backup and restore

Production PostgreSQL backups are encrypted, access-controlled operational
artifacts. They are not exports and never grant Account access. The baseline is
daily full logical backups plus provider point-in-time recovery where supported,
with an RPO target of 24 hours for logical backup alone and 15 minutes when PITR
is enabled. The restore-verification RTO target is four hours.

## Production policy

- use PostgreSQL 17-compatible `pg_dump`/`pg_restore`;
- encrypt in transit with verified TLS and at rest with a provider-managed key;
- store backup encryption keys separately from database credentials;
- restrict create/read/delete access to the backup service and named recovery
  operators; application identities cannot list or restore archives;
- keep daily archives 35 days, monthly archives 12 months, and restore-drill
  evidence 13 months;
- enable object immutability for the short incident-recovery window, then enforce
  lifecycle deletion;
- record archive version, database engine, application revision, migration pin,
  size, checksum, creation outcome, and retention class without credentials;
- alert on missed backup, checksum failure, unexpected size change, restore
  failure, key failure, or an archive exceeding retention.

`npm run db:backup` creates a custom archive and SHA-256 sidecar with mode 0600.
`npm run db:restore` requires the sidecar, validates the archive, rejects a
nonempty target, and restores in one transaction. Run these commands in a
controlled PostgreSQL 17 tool image; never place database URLs in arguments,
logs, source control, or image layers.

## Restore procedure

1. Declare a recovery incident and authorize two operators.
2. Select an archive by timestamp, checksum, application revision, migration
   pin, deletion ledger, and privacy-overlay checkpoint.
3. Create an isolated empty target with networking restricted to recovery
   operators. Revoke restored sessions, provider tokens, webhook secrets, and
   service credentials before allowing application traffic.
4. Verify the archive checksum and list; restore with `--exit-on-error`,
   `--single-transaction`, `--no-owner`, and `--no-acl`.
5. Apply only forward-compatible migrations using the matching application
   revision. Never edit an applied migration.
6. Reapply privacy/deletion actions after the backup timestamp, honor active
   legal/operational holds, rebuild projections, and reconcile source events,
   corrections, verification state, reports, and exports.
7. Verify Accounts/memberships, tenant joins, teams, seasons, rosters, games,
   immutable events, corrections, audits, projections, and any external
   identifiers. Confirm disabled or removed authority remains disabled.
8. Run readiness and a synthetic authorized journey. Promote through the
   deployment change process; do not expose the isolated recovery database
   directly.

Application secrets and provider configuration are recovered from the managed
secret system, never from a database archive. A backup cannot silently reverse a
privacy deletion: recovery remains isolated until the deletion/overlay ledger
after the recovery point is reapplied. Expired archives and keys are destroyed
according to retention; active legal holds must be explicit, scoped, reviewed,
and audited.

## Restore drill

`npm run db:restore:verify` creates independent source and target PostgreSQL 17
containers, deploys the complete migration chain, seeds two synthetic Accounts,
and creates membership, team/season/roster, corrected immutable game history,
audit, and projection evidence. It creates and checksums a custom archive,
restores into the empty target transactionally, compares ordered event hashes,
checks migration state and Account joins, and proves a truncated archive fails.

The drill uses synthetic data and measures technical restore correctness. Hosted
PITR, KMS access, object retention, production scale, and the four-hour RTO must
be demonstrated in the selected production environment before launch. Record
each quarterly production-like drill with archive age/size, start/end time,
observed RPO/RTO, operator, application revision, failures, and follow-up owner.
