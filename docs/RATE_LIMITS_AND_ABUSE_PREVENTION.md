# Rate limits, abuse prevention, and quotas

This document is the production contract for issue #90. Limits supplement
authentication, exact Account ownership, capability checks, idempotency, and
workload validation; they never grant authority or turn a missing resource into
an enumerable response.

## Enforcement model

Every protected operation is authorized first and then charges two independent
PostgreSQL counters in one serializable transaction:

1. an actor counter keyed by Account, actor kind, actor identity, authorized
   capability, endpoint class, policy version, and database-derived window; and
2. an Account counter keyed independently for the same endpoint class and
   window.

Both counters must have capacity. There is no global tenant pool, so a noisy
Account cannot consume another Account's allowance. PostgreSQL and its clock
are the production authority across application instances; process memory,
browser state, proxy affinity, and caller-supplied headers are not authorities.
Human users and least-privilege service identities have distinct actor keys.

Authorization failures retain their existing generic 401/403/404 behavior.
Only an already authorized caller receives a quota response. This ordering
prevents the limiter from becoming an Account, actor, or resource oracle.

Authentication and OAuth token issuance are hosted by Supabase and must also
use provider-side IP, credential, and bot protections. The application does not
trust `X-Forwarded-For` directly and therefore does not pretend its authenticated
Account limiter protects the upstream provider endpoints.

## Endpoint classes and defaults

Defaults are conservative operational guardrails, not billing entitlements.
Account administrators may override named policies in **Settings → Application
configuration** after strict server-side validation; an Account limit cannot be
lower than its actor limit. Invalid configuration is rejected without changing
the current revision. Legacy `RATE_LIMIT_POLICIES_JSON` is read only by the
reviewed initial seed action.

| Class                     | Actor units | Account units | Window | Current or reserved consumers                                   |
| ------------------------- | ----------: | ------------: | -----: | --------------------------------------------------------------- |
| `AUTHENTICATION`          |          30 |           300 |  1 min | reserved application auth/session callbacks; provider also caps |
| `ACCOUNT_SELECTION`       |         120 |         1,200 |  1 min | authenticated Account-context resolution                        |
| `SCORING_MUTATION`        |         600 |         5,000 |  1 min | accepted scoring mutations                                      |
| `CORRECTION_VERIFICATION` |          60 |           500 |  1 min | corrections, verification, and reverification                   |
| `REPORT_READ`             |         240 |         1,500 |  1 min | box score and report reads                                      |
| `REPORT_GENERATION`       |          40 |           200 | 1 hour | season/report computation and validated import workloads        |
| `EXPORT`                  |          10 |            50 | 1 hour | export prepare, download, and cancellation                      |
| `ADMINISTRATION`          |          60 |           300 | 1 hour | privacy and high-impact administration                          |
| `API_READ`                |         300 |         2,000 |  1 min | reserved for issue #91's versioned read API                     |
| `WEBHOOK_ADMINISTRATION`  |          30 |           200 | 1 hour | reserved for issue #93                                          |
| `INTEGRATION_CONSUMER`    |         600 |         5,000 |  1 min | trusted read consumers and future workers                       |

A unit is normally one request. Workload-aware paths charge more: report
generation costs two units, export preparation costs two, export generation
and download costs five, and import validation costs at least one unit per MiB.
Input size limits remain separate and apply before reading an oversized body.

Normal scoring is intentionally much less constrained than corrections,
exports, or administration. Operators should investigate sustained exhaustion
before raising a policy; ordinary high-frequency scorekeeping and a malicious
bulk-export client do not share a class.

## Retries and response semantics

Accepted mutations may supply a bounded server-validated operation key and a
SHA-256 fingerprint of the authoritative input. The first accepted attempt
charges both counters and stores a short-lived charge record. An exact retry
within 24 hours is allowed without another charge, including when the caller
lost the first response. Reusing the key with changed input fails closed as a
non-retryable HTTP `409` idempotency conflict without `Retry-After`; the client
must reconcile the authoritative operation before creating a new identity.
Rejected quota attempts are charged, so repeated denied traffic does not reset
its own pressure.

Quota exhaustion returns HTTP `429` with a generic body and:

- `Retry-After` in whole seconds;
- `RateLimit-Limit` for the constraining actor or Account counter;
- `RateLimit-Remaining`, never negative; and
- `RateLimit-Reset` as a Unix timestamp.

Clients should retain their exact mutation identity, wait for `Retry-After`,
add bounded jitter, and retry the identical operation. They must not rotate
idempotency keys to evade limits. Background consumers use bounded exponential
backoff and checkpoints; a limiter failure must never trigger an unbounded loop.

## Emergency override and support procedure

There is no header, environment flag, owner-role shortcut, or hidden production
bypass. `POST /api/admin/rate-limit-overrides` and its `DELETE` revocation
operation require same-origin transport, a freshly authorized `account.manage`
actor at exact Account scope, and the separate `ADMINISTRATION` quota. They call
the audited `RateLimitService` rather than editing the database. A temporary
override must:

- name one endpoint class;
- optionally name one exact user or service actor;
- provide an uppercase reason code;
- state explicit actor and Account limits; and
- expire within 24 hours.

Override values are bounded to at most ten times the deployed base policy. If
the administration quota or that bound is itself insufficient, support must
use a reviewed configuration deployment and incident procedure; direct database
editing and caller-supplied bypass headers remain prohibited.

Creating an override atomically supersedes an older override at the same scope
and writes a security audit record. Every use writes another audit record with
the class, cost, result, scope that constrained it, and reason. Revocation also
requires current `account.manage` authority and writes immutable audit evidence.
Expired records are ignored automatically. Support must link the reason code to
an incident or approved change, monitor limiter signals, revoke early when the
event ends, and review the audit trail. Direct production database editing is
not an approved support procedure.

## Observability, retention, and operations

Every decision emits the vendor-neutral `rate_limit_decision` operational event
with Account scope, endpoint class, cost, constrained scope, retry status, and
whether an override applied. It excludes tokens, cookies, request bodies,
provider claims, player data, and raw idempotency keys. Alert on sustained
Account exhaustion, sudden actor-cardinality growth, repeated idempotency
conflicts, or any override outside its linked incident window; a single expected
429 does not page.

Counter and charge rows contain operational identifiers but no request payload.
Operational cleanup may remove counters after 30 days and expired charge rows
after their 24-hour retry window. Override and security-audit retention follows
the security evidence policy. Account lifecycle execution deletes that
Account's ephemeral counters and charges and revokes every active override;
user lifecycle execution deletes the user's actor counters and charges across
their memberships and revokes actor-specific overrides. Override records remain
as restricted audit evidence. Exports never include limiter records.

If PostgreSQL is unavailable or a serializable transaction cannot complete
after bounded retries, the protected operation fails closed. Operators must not
switch to process-local counters. Capacity changes require load evidence from
the production workload budget and a reviewed configuration deployment.

## Verification

PostgreSQL integration tests use independent Prisma clients to prove shared
enforcement across instances, exact retry charging, changed-input rejection,
actor and Account layering, separate Account capacity, service-actor policy,
workload costs, expiring overrides, cross-Account denial, and transactional
audit evidence. Service tests verify safe observable decisions and route tests
verify consistent 429 headers. Future API and webhook issues must consume the
reserved classes before their endpoints are enabled.
