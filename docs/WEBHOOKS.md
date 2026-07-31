# Durable integration webhooks

Baseball Stat Track webhooks are an authenticated, Account-scoped, outbound
integration boundary. They notify authorized systems after durable application
changes without granting database access or write-back authority. A consumer
failure can delay only that endpoint's delivery queue; it cannot roll back or
block scoring, replay, projection, verification, or another endpoint.

## Endpoint lifecycle and authorization

`/api/admin/webhooks` requires an authenticated current member with exact
Account `account.manage`, same-origin protection for mutations, and the
`WEBHOOK_ADMINISTRATION` quota. Endpoint and event identifiers returned to
operators are external UUIDs. Internal Account, game, season, team, membership,
setup, event, and projection keys never enter payloads.

An endpoint is created as `PENDING_VERIFICATION`. Its URL must be HTTPS on the
standard TLS port, contain no credentials/query/fragment, use a DNS hostname,
and resolve only to public addresses. Redirects are not followed. Verification
sends a signed `endpoint.verification` challenge; the endpoint must return a 2xx
response and the exact challenge in `X-Webhook-Challenge`. Only then does it
become `ACTIVE` and receive new events.

The create and rotate responses contain the endpoint signing secret. This is
the only time clients should copy it into their secret store. The database
stores only a secret version; the deploy-time
`WEBHOOK_SIGNING_MASTER_KEY` derives each endpoint/version key. Rotation
increments that version. Already queued deliveries retain their prior version,
so rotation does not invalidate or drop them. Revocation is terminal, cancels
pending/leased deliveries transactionally, and is rechecked immediately before
network I/O. Changing a URL requires revocation and a newly verified endpoint.

Create, verification, rotation, replay, and revocation produce restricted
security-audit evidence. Secrets and response bodies are never stored or logged.

## Event contract

Every request body is a versioned envelope:

```json
{
  "id": "event external UUID",
  "deliveryId": "delivery external UUID",
  "accountId": "Account external UUID",
  "sequence": "monotonic Account sequence",
  "type": "game.verified",
  "version": 1,
  "occurredAt": "2026-07-31T19:00:00.000Z",
  "replay": false,
  "data": {}
}
```

Initial event names and allowlisted data are:

| Event                   | Data                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------- |
| `game.verified`         | external game, season, and team IDs; source revision; `VERIFIED` state                                  |
| `game.corrected`        | external game, season, and team IDs; source revision; `UNVERIFIED` and `CORRECTED` states               |
| `report.ready`          | `GAME`/`SEASON` scope, external target ID, source/privacy/derivation revisions, and `CURRENT` freshness |
| `season.report.updated` | external season, team, and source-game IDs; source revision; `GAME_VERIFIED` or `GAME_CORRECTED` reason |

Version 1 payload schemas are strict. They contain no player names, lineup
details, raw accepted events, notes, contact data, provider claims, membership
IDs, setup lineage, internal keys, or report bodies. New fields or event
versions require privacy and compatibility review.

## Signing and replay protection

Requests include:

- `Webhook-Id`: immutable event UUID and consumer idempotency key;
- `Webhook-Delivery-Id`: attempt-series UUID, new for an operator replay;
- `Webhook-Timestamp`: Unix seconds;
- `Webhook-Signature`: `v1=` plus lowercase HMAC-SHA256; and
- `Content-Type: application/json`.

The signed bytes are exactly `<timestamp>.<raw request body>`. Consumers must
verify the signature before parsing, reject timestamps outside five minutes,
and persist `Webhook-Id` before applying effects. A retry reuses the event and
delivery IDs, so duplicate HTTP requests are safe. An authorized replay creates
a new delivery ID but retains the original event ID, sequence, occurrence time,
and payload; consumers can choose to acknowledge it idempotently or perform a
documented replay action.

## Ordering, retries, dead letters, and replay

Initial deliveries are ordered by durable Account sequence for each endpoint.
A retryable head delivery delays later initial deliveries for that endpoint,
but never another endpoint or application work. Concurrent workers claim rows
with database leases and `FOR UPDATE SKIP LOCKED`; an expired lease is safe to
reclaim. Delivery is at-least-once, not exactly-once.

Attempts occur immediately, then after approximately 30 seconds, 2 minutes, 10
minutes, 1 hour, 6 hours, and 24 hours, with one final 24-hour attempt. Network
failures, timeouts, 408, 429, and 5xx responses retry. Other 4xx responses are
terminal. Eight unsuccessful attempts enter `DEAD_LETTER`. Each attempt stores
only its authenticated worker identity, safe status/failure category, duration,
and timestamps.

An authorized operator can replay a retained event to the same active,
same-Account endpoint. Replay is intentionally outside the live ordering queue
and is visibly labeled. Cross-Account lookup returns the same unavailable
result as a missing resource.

## Worker, observability, retention, and operations

The scheduler invokes `POST /api/internal/webhooks/deliver` with a strong
`WEBHOOK_WORKER_TOKEN` bearer credential and a safe, stable
`X-Webhook-Worker-Id`. This is a platform job: it enumerates only due queue
records, and every claimed record carries an explicit Account ID. The worker
token and signing master key are server-only variables and must never use a
`NEXT_PUBLIC_` prefix.

Operational events report delivery start/outcome, safe failure category,
attempt number, event type, Account scope, duration, replay state, retry, and
dead-letter transition. Alert on dead letters, sustained retry backlog, expired
leases, verification failures, and oldest-due age. Do not log URL query data,
secrets, bodies, response bodies, player data, or headers.

Outbox events are retained for 90 days so authorized replay remains bounded.
Ordinary terminal deliveries are retained for 30 days; dead letters for 90
days. A future cleanup job may delete expired terminal deliveries, attempts,
then unreferenced expired events. It must never delete live pending/processing
work.

Rollout order is migration, application, signing/worker secrets, then scheduler.
To contain an incident, stop the scheduler or revoke the affected endpoint;
queued data remains durable. Rollback never reverses the migration or rewrites
accepted scoring history. Repair forward, rotate endpoint secrets after a
suspected disclosure, and replay retained events only after the consumer is
safe.
