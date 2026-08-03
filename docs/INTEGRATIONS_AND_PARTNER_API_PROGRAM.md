# Integrations and partner API program

This is the production trust, ownership, onboarding, compatibility, and support
contract for external consumers of Baseball Stat Track. It builds on the
authenticated statistics API, durable webhooks, controlled exports, read-only
Discord bot, and approved-provider ingestion boundary. It does not create an
anonymous API, a marketplace, or a third-party scoring-write path.

## Program principles

- `Account` is always the tenant boundary. Team, Season, and Game are narrower
  scopes derived from current database relationships.
- A URL, external identifier, browser selection, provider claim, Discord role,
  or partner assertion never creates authority.
- Authority is resolved server-side from a validated session or bearer token
  to an `AppUser`, current membership, capability, target, and exact scope.
- External systems use versioned HTTP or export contracts. They never connect
  to PostgreSQL, Supabase tables, repositories, or internal application
  services.
- Read access never implies score, roster, correction, configuration, export,
  webhook, or administration access.
- Canonical scoring history remains append-only and application-owned.
  Integrations cannot silently reinterpret or rewrite accepted history.
- Privacy, rate limits, compatibility, audit, and revocation are release gates,
  not optional partner customizations.

## Supported tiers and trust boundaries

| Tier                            | Calling identity and Account authority                                                                          | Supported surface                                              | Trust and data boundary                                                                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Authenticated first-party user  | Opaque application cookie or bearer session; current `AppUser`, membership, capability, and target are resolved | Web UI, statistics API, explicit export/admin routes           | Browser state is untrusted. Responses contain only the fields allowed by the requested operation and scope.                                      |
| Managed first-party service     | Dedicated integration identity with one active membership and exact grants                                      | Statistics API v1 and separately authenticated internal worker | No human-session reuse or global system identity. Each operation rechecks current Account authority.                                             |
| Approved partner read consumer  | Dedicated, revocable identity owned by the partner registration and bound to approved Accounts                  | Statistics API v1 only                                         | Admission is manual and least-privilege. No directory, private-player, management, export, audit, or mutation access unless separately approved. |
| Account webhook consumer        | No inbound application identity; endpoint proves HTTPS control and verifies an Account-specific HMAC            | Versioned outbound webhook envelopes                           | At-least-once notification only. A webhook endpoint gains no read-back or write authority.                                                       |
| Authorized export recipient     | Fresh human session with exact `report.export`; one-time token is actor- and Account-bound                      | Versioned canonical JSON download                              | A downloaded copy leaves application custody and cannot be recalled. It is not a reusable API credential.                                        |
| Approved external data provider | Platform worker plus managed provider credential and an approved Account/source registration                    | Versioned ingestion adapter into restricted staging            | Provider evidence is staged and reconciled. It never becomes canonical scoring history merely because ingestion succeeded.                       |

Anonymous consumers, public youth rosters, bearer sharing links, browser-held
service credentials, cross-Account aggregation, database access, unrestricted
partner registration, and third-party score mutation are unsupported.

## Surface ownership

| Surface                       | Product owner | Technical owner       | Security/privacy owner | Operational owner | Canonical contract                                                                               |
| ----------------------------- | ------------- | --------------------- | ---------------------- | ----------------- | ------------------------------------------------------------------------------------------------ |
| Statistics API v1             | Reports       | Application/platform  | Security               | Platform          | `STATISTICS_API_V1.md`, OpenAPI, canonical examples, compatibility digest                        |
| Durable outbound webhooks     | Integrations  | Application/platform  | Security               | Integrations      | `WEBHOOKS.md`, strict event envelopes, signing and replay rules                                  |
| Discord statistics consumer   | Integrations  | Discord service owner | Security/privacy       | Integrations      | `services/discord-bot/README.md`, API v1 consumer tests                                          |
| Account export/import dry run | Data          | Application/data      | Security/privacy       | Data              | `DATA_EXPORT_AND_IMPORT.md`, canonical manifest and replay validation                            |
| Pull-only ICS calendar feeds  | Integrations  | Application/platform  | Security/privacy       | Integrations      | M5 issue #98; game schedule remains authoritative                                                |
| Outbound user notifications   | Integrations  | Application/platform  | Security/privacy       | Integrations      | M5 issue #99; versioned source event and recipient preferences                                   |
| External provider ingestion   | Data          | Data/platform         | Security/privacy/legal | Data              | `EXTERNAL_DATA_INGESTION.md`; written provider approval, staging, provenance, and reconciliation |

The named owner reviews contract changes, privacy fields, credentials, quota
evidence, and operational readiness. A support request cannot transfer
ownership or authorize an exception.

## Partner admission and onboarding

There is no self-service partner credential issuance. A maintainer-approved
registration must record:

1. legal entity, technical contact, operational contact, use case, data flow,
   requested environment, and named Baseball Stat Track owner;
2. exact Accounts, Teams, Seasons, or Games; required API operations and fields;
   expected request volume, freshness, retention, and downstream recipients;
3. privacy classification, youth-data minimization, deletion/export handling,
   incident channel, and any provider/license obligations;
4. one dedicated identity per environment and consumer, with only the required
   membership and named grants;
5. applicable rate-limit classes, bounded timeouts/retries, idempotency,
   correction/staleness behavior, and support expectations;
6. synthetic sandbox or contract-fixture proof, authorization and
   cross-Account denial tests, compatibility-suite results, and rollback; and
7. security, privacy, technical-owner, and release approval before production
   access is enabled.

Approval for one surface does not approve another. API access does not approve
webhook administration or export. A provider license does not approve partner
read access. Production data is prohibited in local, CI, preview, and fixture
environments.

The current production-like reference consumer is the Python Discord bot. It
uses a dedicated bearer identity with exact-team `report.view`, calls only API
v1, consumes the canonical corrected-data examples in tests, and has no
database or score-mutation access.

## Credential lifecycle

Every credential has a named owner, environment, consumer, Account scope,
purpose, creation time, rotation procedure, and revocation procedure.

- Human OAuth sessions remain provider-owned and are never partner service
  credentials.
- API consumers receive a dedicated provider identity. They may not reuse an
  Account owner or operator session.
- Webhook endpoint secrets are shown only at creation/rotation; the application
  derives stored secret versions from its managed signing key.
- Provider API keys and worker tokens are server-only managed secrets.
- Tokens, cookies, secrets, database URLs, and raw authorization headers never
  enter URLs, source control, browser storage, exports, logs, telemetry, audits,
  fixtures, issue comments, or support tickets.

Rotate by creating the replacement first, updating one bounded consumer,
proving an authorized request and denial outside scope, then revoking the old
credential. Immediately revoke on owner departure, Account removal, purpose
change, suspected disclosure, unexplained access, or provider termination.
Current membership and grants are rechecked on every operation, so application
revocation takes effect without trusting token claims or waiting for a client
cache.

## Data, privacy, and correctness

The API and webhook contracts use external UUIDs and strict field allowlists.
Internal database, membership, setup, source-event, projection-lineage, and
provider-subject identifiers are never contract fields. Corrected, incomplete,
stale, unverified, and privacy-overlaid data remains visibly labeled.

No integration surface includes birth date/year, player or guardian contact,
free-form notes, credentials, private audit content, raw accepted-event
payloads, or superseded private identity values. Player display names and
statistics are released only when the exact authorized report contract needs
them. Public reports, public player profiles, and unauthenticated discovery are
not supported.

Consumers must retain provenance sufficient to interpret the API version,
source revision, correction state, projection freshness, derivation version,
and retrieval time. They must replace or annotate derived output after a
correction rather than presenting the prior value as current.

## Quotas, retries, and failure behavior

Authorization and target resolution occur before quota disclosure. API
consumers use the Account- and actor-scoped `API_READ` or
`INTEGRATION_CONSUMER` policy; quotas are operational guardrails, not billing
entitlements. A partner cannot rotate actors, Accounts, or idempotency keys to
evade limits.

| Surface         | Retry and idempotency rule                                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Statistics API  | Retry 408/429/selected 5xx and network failures with bounded exponential backoff and jitter; honor `Retry-After`; do not retry 401/403. |
| Webhooks        | Delivery is at-least-once; verify HMAC/timestamp and persist `Webhook-Id` before effects; terminal 4xx does not retry.                  |
| Export          | Preparation is idempotent by the bounded client key; download token is one-time and must never be retried as a different actor.         |
| Provider ingest | Stable run key, record version identity, bounded pages/backfill, checkpoint advance only after complete success.                        |
| Notifications   | M5 issue #99 defines recipient preferences and a versioned delivery source; no delivery may alter its source event.                     |

Timeouts are bounded. Retries never broaden authority, bypass a revoked
credential, reorder canonical history, or become an unbounded loop. A stale or
unavailable dependency fails visibly. Cross-Account and missing-resource
responses remain non-enumerating.

## Versioning, compatibility, and deprecation

Statistics API v1 is additive-only. Removing or narrowing a path, status,
field, enum, identity, authorization, correction, or freshness meaning requires
a new major path and media type. Webhook payloads and exports carry independent
explicit versions; compatibility approval for one does not change another.

Before deprecation:

1. publish and deploy the replacement contract and migration guide;
2. update canonical examples and the repeatable consumer compatibility suite;
3. identify registered consumers and an approved support window;
4. notify technical/operational contacts without disclosing another partner;
5. observe safe version-usage and failure metrics; and
6. remove only in a new major version after release approval and the announced
   date.

The OpenAPI digest comparison rejects removal or narrowing of v1. Discord bot
tests consume the same corrected and failure examples, providing the initial
external-consumer compatibility proof. Updating a digest to hide a breaking
change is prohibited.

## Observability, support, and incident response

Every integration operation carries a safe request/correlation ID and emits
allowlisted operation, Account scope, consumer class, version, outcome, safe
failure category, duration, retry, quota, freshness, and queue/checkpoint data
where applicable. Logs and metrics exclude payloads, player names, URLs with
parameters, credentials, headers, provider claims, and response bodies.

| Condition                                      | Owner/action                                                                                                     |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 401/403 or revoked membership/grant            | Consumer owner stops retries; Account owner reviews identity and grants; security reviews unexplained access.    |
| Sustained 429                                  | Consumer honors reset; integrations owner reviews traffic evidence before any audited limit change.              |
| Breaking contract or invalid response          | Technical owner stops rollout, preserves safe examples/version evidence, and repairs or versions forward.        |
| Webhook dead letter or notification exhaustion | Integrations owner inspects bounded attempt history and replays only after the consumer is safe.                 |
| Suspected secret or data exposure              | Revoke/rotate, stop the affected surface, preserve restricted audit evidence, and use the private security path. |
| Stale/corrected data shown as current          | Disable affected presentation, reconcile source/projection versions, correct downstream output, and test it.     |

Support never asks for tokens, raw payloads, player data, database rows, or
production exports in tickets. It records correlation ID, safe Account scope,
contract/version, timestamp, operation, status, retry state, release, and
consumer registration. Security reports use the private route in `SECURITY.md`.
There is no partner availability or response-time SLA until an approved
commercial and operational policy names one.

## Production and compatibility gate

A consumer is production-ready only when:

- registration, owners, exact scopes, credentials, rotation, and revocation are
  recorded;
- field allowlists and privacy review pass with synthetic fixtures;
- authorization, cross-Account denial, quotas, retries, stale/correction,
  compatibility, and redaction tests pass;
- readiness, failure signals, alert owner, incident containment, rollback, and
  support intake are documented; and
- the exact artifact and contract versions pass the release workflow.

The reference Discord consumer satisfies the documented read-contract and
repeatable compatibility requirements. Pull-only calendar feeds, outbound
notifications, and the Discord configuration control plane remain separate M5
delivery issues and cannot claim production readiness from this program
document alone.

## Explicit deferrals

Marketplace discovery/billing, self-service third-party credentials,
organization-wide aggregation, anonymous/public data, unrestricted imports,
external score mutation, arbitrary webhook payloads, AI-generated commentary,
and partner access to internal support tooling are not part of M5. Advanced
analytics remains M6 and is not started or implied by this program.
