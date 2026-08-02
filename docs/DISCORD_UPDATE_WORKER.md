# Discord update worker

Issue #119 executes the versioned Discord settings contract without allowing a
bot to poll application tables. Accepted game-state producers publish a small
authenticated signal to `POST /api/internal/discord-updates/events`. A trusted
scheduler invokes `POST /api/internal/discord-updates/run`; the application
then evaluates current statistics and delivers due messages through Discord.

## Durable state and ordering

`DiscordUpdateEvaluation` pins Account, game, settings revision, source
revision, and trigger. Its unique key makes duplicate source signals harmless.
Only enabled settings with an active installation, an exact tracked
team-season, a selected trigger, and a routable destination can enqueue work.
Scheduled and summary modes coalesce older pending revisions.

`DiscordUpdateDelivery` records one destination-specific message plan per
evaluation. Claims use PostgreSQL row locks with `SKIP LOCKED`, 60-second
leases, and source-revision ordering. Later work for the same
settings/game/destination waits while an earlier revision is pending or
processing. At claim time the worker resolves `CREATE`, `EDIT`, or `APPEND`
against the latest successful prior provider message, so concurrent evaluation
cannot create duplicate live messages.

The delivery UUID is the Discord nonce and idempotency key. Discord create and
append requests enable nonce enforcement. Edits target the pinned prior
provider message. Restarts can therefore retry the same durable delivery
without silently creating another message.

The application owns delivery scheduling timestamps. The worker supplies one
controlled evaluation-completion instant and the repository persists that
instant explicitly as both `createdAt` and the initial `nextAttemptAt`, making
the delivery immediately claimable at that instant without consulting the
database clock. PostgreSQL's `CURRENT_TIMESTAMP` defaults remain only as a
safety fallback for non-application inserts; no application delivery path
depends on them. Retry scheduling continues from the explicit attempt
completion instant.

## Freshness, failure, and recovery

Statistics are loaded only through the authenticated versioned box-score API.
The worker refuses `STALE` or `INCOMPLETE` projections and any response behind
the signaled source revision. It rechecks settings revision, tracked scope,
installation lifecycle, and destination View/Send evidence before delivery.
Changed or revoked configuration cancels work with a reason code rather than
silently dropping it.

Retryable failures use bounded delays of 30 seconds, 2 minutes, 10 minutes,
1 hour, 6 hours, and then 24 hours, while honoring a longer Discord
`Retry-After` up to 24 hours. The eighth failed attempt dead-letters the work.
Authentication failures, missing channels, and revoked permissions are
terminal. Every send attempt is append-only evidence retained with its
delivery for 90 days. Operational events contain only Account IDs, revisions,
operation/trigger, attempt number, duration, and safe reason codes—never bot
tokens, channel IDs, message content, or provider bodies.

An abort signal releases every claimed item that has not started. A crashed
worker is recovered by lease expiry. `lastSuccessfulUpdateAt` advances only in
the same transaction that records a successful Discord attempt.

## Configuration and operation

Keep the feature disabled until the migration and credentials are ready:

- `FEATURE_DISCORD_UPDATES_ENABLED`
- `DISCORD_UPDATE_EVENT_TOKEN` (at least 32 random characters)
- `DISCORD_UPDATE_WORKER_TOKEN` (a separate 32-character token)
- `DISCORD_STATISTICS_API_BASE_URL` (HTTPS application API origin)
- `DISCORD_STATISTICS_API_TOKEN` (dedicated least-privilege read token)
- `DISCORD_UPDATE_BOT_TOKEN` (managed Discord bot credential)
- optional `DISCORD_UPDATE_API_BASE_URL`, defaulting to Discord API v10

The event endpoint returns `202` for accepted, duplicate, unavailable, or
feature-disabled signals and never enumerates cross-Account games. The run
endpoint requires `X-Discord-Update-Worker-Id` with a stable 8–128 character
worker identity and reports only aggregate evaluated/delivered outcomes.

Schedule the run endpoint more frequently than the shortest configured cadence
and allow at most one minute per invocation. Alert on
`discord_update_evaluation` or `discord_update_delivery` events that become
`failed`, repeated `STATISTICS_STALE`, `RATE_LIMITED`,
`PERMISSION_REQUIRED`, or `DESTINATION_UNAVAILABLE` codes, and growth in
`DEAD_LETTER` rows. Repair credentials/permissions or statistics freshness,
then issue a new source signal or manual-refresh request; never mutate attempt
evidence or reset provider IDs.

Migrations `20260801070000_discord_update_delivery` and
`20260801071000_discord_update_delivery_indexes` are forward-only after work
exists. Rollback is feature disablement followed by a roll-forward repair.

The synthetic end-to-end coverage and its failure/isolation matrix are
documented in [Discord end-to-end fixtures](./DISCORD_END_TO_END_FIXTURES.md).
The isolated scheduler process, service credentials, health contract, and
secretless container proof are documented in
[Discord control-plane deployment](./DISCORD_CONTROL_PLANE_DEPLOYMENT.md).
