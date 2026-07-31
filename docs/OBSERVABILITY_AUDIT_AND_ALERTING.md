# Observability, audit, and alerting

This is the vendor-neutral M4 operations contract. It separates diagnostic
application signals from the transactional security and baseball histories that
already exist. A log line is never authorization evidence and never replaces a
required `SecurityAuditRecord` or immutable scoring event.

Numeric service objectives, error-budget decisions, incident severity and
roles, and the representative stale-projection drill are defined in
[`PRODUCTION_RELIABILITY.md`](PRODUCTION_RELIABILITY.md).

## Signal classes

| Class            | Purpose                                  | Authority and examples                                                                                   |
| ---------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Security audit   | Durable evidence for privileged actions  | Account-scoped `SecurityAuditRecord`; export, import validation, setup, roster, correction, verification |
| Application log  | Diagnose one request or operation        | JSON event with safe request/correlation IDs, category, outcome, code, and duration                      |
| Metric           | Aggregate service behavior               | counts, latency histograms, readiness, freshness, queue lag                                              |
| Trace            | Correlate work across boundaries         | vendor adapter may derive spans from request/correlation IDs                                             |
| Domain rejection | Expected baseball or concurrency refusal | typed code; not an application failure or paging alert                                                   |
| Business event   | Immutable scoring meaning                | accepted source event; never copied wholesale into logs                                                  |

The JSON sink writes one event per line to standard output for collection by the
deployment platform. Provider adapters may transform this contract, but must
preserve field meaning and redaction.

## Correlation and safe fields

`X-Request-Id` and `X-Correlation-Id` accept only 8–128 characters from a
restricted identifier alphabet. Invalid input is replaced with a UUID.
Liveness and readiness echo both safe identifiers. Async jobs must carry the
correlation ID into retry metadata, while migrations use the immutable migration
name as their safe operation code.

Allowed operational context is limited to Account scope, capability, target
type, typed code, duration, counts, revisions, and coarse lifecycle state.
Sensitive keys and structured values are redacted. Never log tokens, cookies,
secrets, provider claims, connection strings, player names, birth/age data,
notes, contact data, raw events, request bodies, exports, or arbitrary errors.

Operational access is restricted by environment and Account. Support tooling
must require `audit.view` for the exact Account and must never provide a
cross-Account search surface to ordinary Account members.

## Required signals

- authentication: success, expired/invalid session, provider or provisioning
  failure;
- authorization: allowed or rejected capability and target type, without
  resource enumeration;
- scoring: acceptance success, typed rejection, idempotent retry, revision
  conflict, and unexpected persistence failure;
- corrections and verification: the durable audit/source event plus safe
  application outcome;
- projections and reports: source/privacy/derivation revision, current/stale
  result, rebuild failure, and completion latency;
- background jobs: start, completion, retry, terminal failure, checkpoint, and
  lag;
- migrations: revision, start, completion, failure, and applied-schema pin;
- health: process liveness and dependency/schema/migration readiness.

## Alerts and ownership

| Condition                                                          | Severity                                                | Action                                                                                               | Owner                |
| ------------------------------------------------------------------ | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------- |
| Required audit write fails                                         | Critical/page                                           | fail the operation; preserve transaction evidence; investigate database and authorization boundaries | Security/on-call     |
| Readiness fails for 2 consecutive minutes                          | Critical/page                                           | stop traffic or deployment; compare configuration, database, schema, and migration checks            | Platform/on-call     |
| Unexpected scoring acceptance failures exceed 1% for 5 minutes     | Critical/page                                           | pause rollout; preserve correlation IDs; verify accepted history before retry                        | Scorekeeping/on-call |
| Projection/report freshness exceeds 5 minutes                      | Warning/ticket                                          | inspect checkpoint, source/privacy revisions, and rebuild worker                                     | Reports              |
| Background job exhausts retries                                    | Warning/ticket, critical if scoring recovery is blocked | inspect typed failure and checkpoint; do not skip failed work silently                               | Owning service       |
| Authorization rejection rate changes by 3× baseline for 10 minutes | Warning/security review                                 | distinguish expired membership and expected denial from attack or deploy regression                  | Security             |

Expected domain rejections, validation errors, and idempotent retries do not page.
Owners review alert thresholds after each incident and at least quarterly.

## Retention, privacy, and access

- security audit: retained according to the privacy lifecycle and available only
  through exact-Account authorized tooling;
- production application logs/traces: 30 days by default, restricted to on-call
  and security operators;
- metrics: 13 months when aggregate and privacy-safe;
- raw diagnostic exports are prohibited;
- deletion and privacy overlays do not rewrite immutable baseball or security
  history, but derived labels and external telemetry must follow the privacy
  lifecycle.

## Incident playbook

1. Declare severity, incident commander, scribe, and affected environment.
2. Freeze unsafe deploys and record release, migration, request, correlation, and
   Account scope without copying sensitive payloads.
3. For scoring loss, compare accepted immutable events, effective corrected
   history, revision, projection checkpoint, and client recovery state. Never
   invent or edit an accepted event.
4. For a bad deploy, remove traffic, roll back only to a schema-compatible
   artifact, and verify readiness plus a synthetic authorized scoring journey.
5. For unauthorized access, revoke sessions/credentials, preserve security
   audit evidence, verify Account boundaries, and use the private security
   communication path.
6. Confirm recovery through liveness, readiness, Account isolation, replay,
   correction/verification, reports, and audit persistence.
7. Document user impact, evidence, decisions, follow-up owner, and regression
   tests. Do not claim recovery from log silence alone.

Retention configuration, hosted dashboards, paging integrations, and vendor
credentials belong to the deployment environment; this repository defines the
portable signal and response contract without pretending a vendor is configured.
