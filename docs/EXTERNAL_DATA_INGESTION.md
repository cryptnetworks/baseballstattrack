# External baseball data ingestion

Issue #143 adds a fail-closed provider ingestion boundary for approved baseball
feeds. It does not authorize scraping. External records are staged as immutable,
versioned, Account-scoped evidence; they never bypass canonical event replay,
tenant authorization, corrections, or statistic reconciliation.

## Provider approval and current MLB decision

The production connector key is `MLB_LICENSED_JSON_V1`. It targets a separately
licensed HTTPS JSON feed conforming to the repository contract. No default URL
is configured and the application does not call `statsapi.mlb.com`, MLB.com,
Baseball Reference, or any HTML page.

The official MLB.com Terms of Use reviewed on 2026-07-31 prohibit automated
scripts that collect information from or interact with MLB digital properties
and limit reuse without permission. Therefore an MLB source may be `ACTIVE`
only after the operator records a written license/permission reference, reviewed
terms version, required attribution, permitted capability set, cadence, quota,
retention, and backfill window. See the
[MLB Terms of Use](https://www.mlb.com/official-information/terms-of-use) and
[MLB legal notices](https://www.mlb.com/official-information/legal-notices).
Baseball Reference or another provider requires its own independent written
review; similarity to public web access is not approval.

Database and application checks require an `APPROVED:...` reference before an
active source can run. The synthetic fixture connector is hard-disabled in
production. Removing these gates or pointing the licensed connector at a public
site is a security/legal defect.

## Version 1 provider contract

Every adapter declares:

- stable provider key and display name;
- supported record capabilities;
- authentication scheme;
- cursor pagination and maximum page size;
- minimum cadence and freshness expectation;
- retryable status codes and rate-limit semantics; and
- attribution requirement.

`LicensedJsonFeedProvider` uses HTTPS bearer authentication, no redirects,
10-second timeouts, a 5 MB response limit, cursor pagination, provider
checkpoints, `Cache-Control: no-store`, and a managed server-only API key. It
accepts only strict schema-v1 normalized records. Authentication credentials
never enter source configuration rows, logs, records, quarantine diagnostics,
API output, or backups intended for ordinary operators.

Pages return provider version, checkpoint, next cursor, remaining quota/reset,
and at most 1,000 records. HTTP 408/429 and selected 5xx responses are retryable;
other non-2xx responses fail visibly. Cursor cycles and more than 100 pages fail
the run rather than loop or silently truncate.

## Normalized record catalog

The strict catalog covers `TEAM`, `PLAYER`, `SEASON`, `GAME`, `ROSTER_ENTRY`,
`PLAY`, `BOX_SCORE`, and `STAT_LINE`. Each record carries stable provider ID,
provider version, optional effective time, optional correction predecessor, and
a type-specific allowlisted payload. Free-form play descriptions, URLs, HTML,
images, contacts, notes, credentials, and arbitrary metadata are rejected.

The Account-scoped staging layer retains:

- source, run, type, stable provider ID/version, retrieval/effective times;
- normalized schema version, canonical SHA-256 digest, and normalized payload;
- published/quarantined/superseded state and correction lineage; and
- optional canonical external reference only after an authorized publisher has
  validated identity, ruleset, completeness, order, and reconciliation.

Provider evidence identity and payload are database-immutable. A corrected
version creates a new row and supersedes the prior published row only when its
declared lineage matches. Same-content renumbering, mismatched lineage,
malformed records, ambiguous identity, unsupported ruleset, missing dependency,
manual-history collision, ordering failure, and stat mismatch are quarantined.
Malformed raw payloads are not retained; quarantine stores only a digest,
redacted marker, and bounded diagnostic code.

## Canonical publication safety

Staging success is not canonical publication. A provider cannot update or
delete accepted `SourceEvent`, `PlayTransaction`, correction, setup snapshot,
or manually scored game history. A future publisher maps stable identities
under exact Account scope, checks provider capability and ruleset, replays
available play-by-play, derives statistics, and reconciles provider box/stat
totals before setting a canonical external reference.

If a game has manual accepted history, upstream changes remain staged or
quarantined for authorized review. An approved correction becomes ordinary
append-only correction/replacement evidence; it never rewrites the old event.
The versioned read API may expose only authorized canonical/published data with
provider attribution, source version, retrieval time, freshness, confidence,
and correction status. Staged/quarantined payloads are restricted admin data.

This repository intentionally leaves live MLB activation and canonical
publication disabled until written provider approval and the final identity/
ruleset publisher review are attached to the release. Synthetic contract
fixtures prove the adapter, pagination, normalization, idempotency, correction,
quarantine, checkpoint, and retry boundaries without copying provider data.

## Worker, retry, checkpoint, and backfill

`POST /api/internal/external-ingestion/run` requires a strong
`EXTERNAL_INGESTION_WORKER_TOKEN`. The scheduler supplies exact Account/source,
stable run key, scheduled/backfill mode, and bounded time window. Source lookup
is always Account-scoped.

A duplicate run key returns the existing run. Record uniqueness is source,
type, provider ID, and provider version. Successful pages increment safe counts;
the source checkpoint advances only after the complete run succeeds. Failures
retain the prior checkpoint and schedule exponential retry from 30 seconds up
to six hours. Configured cadence cannot exceed the adapter's approved rate.
Backfill windows are source-configured and database-bounded.

Operational events report provider key, Account scope, success/failure, and safe
failure code. Source health stores last success/failure, next attempt, consecutive
failures, checkpoint, quota remaining/reset, page/record/published/quarantine
counts, and run timing. Never log payloads, identities, URLs, credentials, names,
or provider response bodies. Alert on repeated failures, freshness lag, open
quarantine growth, quota exhaustion, correction mismatch, and checkpoint stall.

## Deployment and rollback

1. Apply migration `20260731190000_external_ingestion`.
2. Obtain written provider permission/license and record terms, attribution,
   retention, capabilities, cadence, quota, and approval reference.
3. Store provider API key and worker token in managed secrets; configure the
   licensed base URL. Never use a public MLB/HTML URL.
4. Create the source disabled, validate a synthetic/contract fixture, then
   activate it with the approved configuration.
5. Run a narrow backfill, review quarantine/reconciliation, and only then
   increase the window or schedule.

Contain incidents by suspending/revoking the source or stopping the scheduler.
Revoking/deleting an Account revokes its sources. Rollback does not reverse the
migration or delete provenance; repair forward, rotate credentials, preserve
minimum evidence, and resume from the last successful checkpoint. Provider-term
withdrawal immediately disables polling and publication while retention/deletion
follows the recorded license and privacy obligations.
