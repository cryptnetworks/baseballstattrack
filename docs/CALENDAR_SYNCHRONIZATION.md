# Calendar synchronization

Issue #98 implements one-way synchronization from Baseball Stat Track scheduled
games to Google Calendar. The baseball `Game`, its immutable setup snapshots,
and accepted scoring events remain authoritative. Calendar data is a disposable
projection and no provider response or external edit can create, reorder,
correct, or delete baseball scoring history.

## Ownership, authorization, and connection

Connections belong to exactly one Account. `GET`, `POST`, and `DELETE
/api/admin/calendars` require a current Account-scoped `account.manage`
authorization and same-origin protection for mutations. An administrator
connects a Google calendar with:

- provider calendar id;
- IANA time zone used to render the event instant;
- disclosure level (`PRIVATE`, `OPPONENT`, or `FULL`); and
- a non-secret credential reference.

The database never stores an OAuth access token, refresh token, authorization
code, client secret, or provider response. Operators provision tokens in the
managed `CALENDAR_PROVIDER_TOKENS_JSON` application secret, keyed by the stored
reference. Google Calendar access is limited operationally to the selected
calendar and the event read/write scope needed by the worker. Credential
issuance, refresh, and revocation remain with the deployment's provider/secret
manager; rotate the mapped value without changing the connection.

The initial operational flow is administrator-assisted rather than a public
OAuth callback. Confirm the Account owner, calendar owner, environment,
calendar id, exact provider scope, credential expiry/rotation owner, and privacy
selection before creating the connection. Self-service marketplace installation
and generalized third-party OAuth are deferred.

## Privacy and youth schedules

`PRIVATE` is the default and emits only “Baseball game,” start/end time, and a
private source identifier. `OPPONENT` additionally emits the opponent display
name. `FULL` additionally emits location. All events request provider-private
visibility. Player names, lineups, scores, contacts, age/birth data, account
names, notes, audit evidence, and raw event history are never sent.

Opponent and location can identify a youth team's routine. Use `PRIVATE` unless
the Account owner has confirmed the destination calendar's members, sharing
settings, retention, and purpose. Changing a disclosure level requires a full
disconnect and reconnect in this version so cleanup and the new decision remain
explicit and auditable.
Provider copies remain subject to the calendar owner's sharing, export,
retention, and deletion controls after delivery.

## Reconciliation and idempotency

The worker is invoked through `POST /api/internal/calendar-sync/run` with a
strong `CALENDAR_SYNC_WORKER_TOKEN`, stable worker id, and optional connection
id. Each connection has a bounded lease, so overlapping workers do not process
it concurrently.

Every game receives a deterministic Google event id derived from the connection
and public game ids. Creates can therefore be retried after an ambiguous network
result without duplicating an event. A SHA-256 source fingerprint covers the
rendered content, lifecycle status, game revision, and setup revision; unchanged
runs make no provider call. Updates use the last Google ETag. A provider-side
edit that races a Baseball Stat Track update produces a visible `CONFLICT`
instead of silently overwriting either source.

The sync handles:

- new schedules by creating a private timed event;
- changed time, time zone, opponent, location, setup, or lifecycle by updating
  the deterministic event;
- reschedules as ordinary version-checked updates, preserving one event id;
- `CANCELLED`, `ABANDONED`, archived, or unscheduled games by deleting the
  provider event idempotently; and
- completed, verified, and corrected games as retained calendar events whose
  scoring data remains entirely inside Baseball Stat Track.

There is intentionally no inbound calendar-to-game mutation route. External
calendar edits can affect only the provider copy. They can never silently change
a scheduled game, setup snapshot, accepted play, correction, score, or derived
statistic.

## Failures, conflicts, and recovery

Connection listings include last sync/failure timestamps and up to 100 pending,
failed, or conflicting games with safe failure codes and attempt counts. Worker
telemetry includes only Account scope, bounded counts, lifecycle flags, and a
safe code—never calendar ids, event content, opponent/location, credentials,
headers, or provider bodies.

Transient transport, rate-limit, and provider failures stay durable and are
retried by later worker invocations. Authentication failures require credential
repair/rotation. An administrator uses the `retry` action after investigating a
failure. `force: false` preserves the known ETag; `force: true` explicitly drops
it and reasserts the baseball projection, which is the recovery path for a
reviewed conflict. The force decision is security-audited.

Disconnect is a two-phase state change. `DELETE /api/admin/calendars` marks the
connection `DISCONNECTING`; the worker deletes every linked provider event while
the credential still exists, then marks it `DISCONNECTED`. A failed or
conflicting delete remains visible and recoverable. Revoke the provider token
only after the disconnected state is observed, unless incident containment
requires immediate revocation and accepted orphan cleanup.

## Deployment and rollback

1. Apply migration `20260731213000_calendar_sync`.
2. Provision a least-privilege Google credential in the deployment secret
   manager and add its reference/value mapping to
   `CALENDAR_PROVIDER_TOKENS_JSON`.
3. Configure a separate strong `CALENDAR_SYNC_WORKER_TOKEN`.
4. Connect a non-production calendar with `PRIVATE`, run a targeted sync, and
   verify create/update/reschedule/cancel/disconnect before production approval.
5. Schedule bounded worker calls and monitor connection failures/conflicts.

To contain an incident, stop the scheduler and begin disconnect while the
credential is usable, or revoke the provider credential immediately if exposure
is suspected. Database migrations are forward-only. Application rollback must
retain the new tables; it may stop worker calls, but must not delete sync state
or claim external cleanup succeeded. Resume with the same deterministic ids
after repair.
