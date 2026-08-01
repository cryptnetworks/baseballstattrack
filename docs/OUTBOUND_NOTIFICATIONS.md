# Outbound notifications

Issue #99 adds production notification delivery for game completion,
verification, correction, current reports, season-report changes, and bounded
operational failures. It does not evaluate analytics, trends, recommendations,
or player performance.

## Shared event contract

`WebhookEvent` is the immutable, Account-scoped integration event source for all
three channels. Webhook endpoints retain their signed delivery path. Active
email and Discord recipient rules fan out from the same event row and retain
its sequence, payload version, correction state, and occurrence time.

Version 1 events are:

- `game.completed`, `game.verified`, and `game.corrected`;
- `report.ready` and `season.report.updated`;
- `operational.failure` with only service, safe failure code, correlation ID,
  severity, and optional team identity.

Event and delivery creation occur in the same transaction as the owning game
or report publication. Duplicate source keys and the unique preference/event
key make retries idempotent. A completion notice says verification may still be
pending; correction notices never imply that a corrected report is verified.

## Recipients and privacy

Administrators configure Account- or team-scoped rules through
`/api/admin/notifications`. Each rule names one active Account membership, one
channel, an explicit event set, and a managed destination reference. Raw email
addresses and Discord channel IDs live only in deployment-managed
`NOTIFICATION_DESTINATIONS_JSON`; database records and audit history retain the
reference, never the resolved destination or provider credential.

Notification text contains identifiers, revisions, lifecycle state, and a link
instruction only. It never contains player names, statistics, report bodies,
notes, contact data, analytics, or provider secrets. `sensitiveContent` is
stored as an explicit false-only policy guard. Viewing the report remains a
separate authenticated `report.view` action inside the application.

Members can inspect their own rule states and opt out through
`/api/notifications/preferences`. Opt-out cancels pending or leased work in the
same transaction and cannot be silently reactivated by an administrator.
Disabled memberships and disabled rules are ineligible for worker claims.

## Delivery and recovery

`POST /api/internal/notifications/deliver` requires a dedicated bearer token
and a stable `x-notification-worker-id`. Workers lease at most 25 due rows per
call, preserve per-recipient event order, and re-claim expired leases safely.
Email uses a stable Message-ID and delivery header; Discord uses an enforced
nonce. SMTP servers do not provide universal idempotency, so a connection loss
after acceptance can result in a duplicate email.

Retry delays are 30 seconds, 2 minutes, 10 minutes, 1 hour, 6 hours, and then
daily, with at most eight attempts. Authentication and invalid-destination
failures dead-letter immediately; timeouts, rate limits, and provider 5xx
responses retry. Every attempt is append-only. Operators can inspect a bounded,
payload-free delivery history from the administration API and correlate
dead-letter operational events without seeing destinations or message bodies.

Operational services may publish a minimized failure event through
`POST /api/internal/notifications/events` using a separate token. The caller
must supply an Account, safe service/failure code, and correlation ID. This
boundary is not an arbitrary messaging API.

## Configuration and operations

Enable each channel independently with
`FEATURE_EMAIL_NOTIFICATIONS_ENABLED` and
`FEATURE_DISCORD_NOTIFICATIONS_ENABLED`. Disabled channels reject new
destinations and do not require their credentials. Shared worker configuration:

- `NOTIFICATION_WORKER_TOKEN` and the separate `NOTIFICATION_EVENT_TOKEN`;
- `NOTIFICATION_DESTINATIONS_JSON` mapping opaque references to channel and
  destination;
- standard SMTP credentials: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`,
  `SMTP_USERNAME`, `SMTP_PASSWORD`, and `SMTP_FROM`;
- `NOTIFICATION_DISCORD_BOT_TOKEN` and optional
  `NOTIFICATION_DISCORD_API_BASE_URL`.

Apply migration `20260731223000_outbound_notifications`, deploy the application,
and start a scheduler that invokes the delivery endpoint. To contain an
incident, stop the scheduler, disable the affected rule, rotate the relevant
provider credential or destination mapping, and preserve delivery/attempt rows
for audit. Application rollback does not reverse the forward-only migration.
