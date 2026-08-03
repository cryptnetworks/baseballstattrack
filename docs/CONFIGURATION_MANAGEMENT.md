# Application configuration management

Baseball Stat Track stores non-secret, Account-scoped operational behavior in
the application database. Account administrators manage it at
`/settings/configuration`; normal changes do not require a deployment or
application restart.

Secrets and deployment topology remain outside the database. The application
does not offer a secret-shaped field, the domain schema rejects unknown fields,
and the database rejects JSON keys that resemble tokens, passwords, secrets, or
private/signing/API keys.

## Architecture and ownership

```text
Admin UI
   |
   v
Account authorization (configuration.view / configuration.manage)
   |
   v
ApplicationConfigurationService
   |
   v
Account-scoped current configuration + immutable revisions + security audit
   |
   v
Runtime cache and typed consumers
```

Application code receives typed configuration from the configuration service.
It does not inspect arbitrary environment variables. The named
`runtime-environment` boundary is the only server-side reader for secrets and
deployment values; `runtime-mode` is the browser-safe compile-time deployment
mode boundary.

Configuration is Account-scoped. A valid administrator for Account A cannot
view, preview, update, refresh, seed, or roll back Account B. Background workers
resolve configuration using the Account identifier on each claimed item so a
setting from one Account cannot affect another.

## Stored configuration categories

| Category      | Database-owned values                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Features      | Calendar feeds, email notifications, Discord notifications, Discord updates                                                     |
| Calendar      | Feed detail level (`private`, `opponent`, or `full`)                                                                            |
| Notifications | Destination allowlist, SMTP host/port/TLS/from identity, Discord API base URL                                                   |
| Integrations  | Licensed-provider base URL, Discord credential reference, Discord installation/statistics/update API URLs, installation timeout |
| Rate limits   | Complete typed policy for every protected endpoint class                                                                        |

Destination values may contain an email address or Discord channel identifier,
so they remain Account-private. They are never returned to another Account or
copied into security-audit metadata.

## Environment classification

The following classification covers the application, migration/container
runtime, documentation publisher, Discord bot, and Discord update scheduler
environment examples currently in the repository.

### Category A: secrets retained externally

These stay in a protected `.env`, orchestrator secret, or secret manager. They
are never accepted by the configuration schema.

- Database and infrastructure credentials: `DATABASE_URL`, `DIRECT_URL`,
  `POSTGRES_PASSWORD`, `CLOUDFLARE_TUNNEL_TOKEN`.
- Authentication secrets: `AUTHENTICATION_ENCRYPTION_KEY`,
  `AUTHENTIK_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_CLIENT_SECRET`,
  `DISCORD_LOGIN_CLIENT_SECRET`, `FACEBOOK_OAUTH_CLIENT_SECRET`, and
  `APPLE_OAUTH_PRIVATE_KEY`.
- Signing and worker secrets: `WEBHOOK_SIGNING_MASTER_KEY`,
  `WEBHOOK_WORKER_TOKEN`, `EXTERNAL_INGESTION_WORKER_TOKEN`,
  `ICS_FEED_SIGNING_KEY`, `NOTIFICATION_WORKER_TOKEN`,
  `NOTIFICATION_EVENT_TOKEN`, `DISCORD_OAUTH_STATE_SECRET`,
  `DISCORD_UPDATE_EVENT_TOKEN`, `DISCORD_UPDATE_WORKER_TOKEN`.
- Provider and OAuth credentials: `EXTERNAL_DATA_PROVIDER_API_KEY`,
  `SMTP_USERNAME`, `SMTP_PASSWORD`, `NOTIFICATION_DISCORD_BOT_TOKEN`,
  `DISCORD_OAUTH_CLIENT_SECRET`, `DISCORD_INSTALLATION_BOT_TOKEN`,
  `DISCORD_STATISTICS_API_TOKEN`, `DISCORD_UPDATE_BOT_TOKEN`, `DISCORD_TOKEN`,
  `BST_API_TOKEN`.
- Publication credentials: `WIKI_PUBLISH_TOKEN` and GitHub credential material
  supplied to CI.

### Category B: database-owned runtime configuration

These legacy names are accepted only by the explicit initial seed action. The
normal runtime ignores them after deployment; administrators review and manage
their database equivalents.

- `FEATURE_ICS_CALENDAR_ENABLED`
- `FEATURE_EMAIL_NOTIFICATIONS_ENABLED`
- `FEATURE_DISCORD_NOTIFICATIONS_ENABLED`
- `FEATURE_DISCORD_UPDATES_ENABLED`
- `ICS_FEED_DETAIL_LEVEL`
- `NOTIFICATION_DESTINATIONS_JSON`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_FROM`
- `NOTIFICATION_DISCORD_API_BASE_URL`
- `EXTERNAL_DATA_PROVIDER_BASE_URL`
- `DISCORD_INSTALLATION_CREDENTIAL_REFERENCE`
- `DISCORD_INSTALLATION_API_BASE_URL`
- `DISCORD_INSTALLATION_TIMEOUT_MS`
- `DISCORD_STATISTICS_API_BASE_URL`
- `DISCORD_UPDATE_API_BASE_URL`
- `RATE_LIMIT_POLICIES_JSON`

### Category C: deployment configuration retained externally

These determine process identity, bootstrapping, networking, or container
topology and remain deployment-owned.

- Application/runtime identity: `NODE_ENV`, `NEXT_PUBLIC_APP_ENV`,
  `npm_package_version`, `REQUIRED_DATABASE_MIGRATION`.
- Public/authentication topology: `NEXT_PUBLIC_SITE_URL`,
  `AUTHENTICATION_ENABLED_PROVIDERS`, `OAUTH_CALLBACK_URL`, provider issuer and
  client identifiers, Apple team/key identifiers, `DISCORD_OAUTH_CLIENT_ID`,
  and `DISCORD_OAUTH_REDIRECT_URI`.
- Credential routing boundary: `EXTERNAL_DATA_PROVIDER_ALLOWED_ORIGIN`. This
  must be the HTTPS origin authorized to receive
  `EXTERNAL_DATA_PROVIDER_API_KEY`; an Account administrator may choose a path
  on that origin but cannot redirect the credential to another host.
- Container/process networking: `HOSTNAME`, `PORT`, `APP_BIND_ADDRESS`,
  `APP_PORT`, `HEALTH_HOST`, `HEALTH_PORT`,
  `DISCORD_UPDATE_WORKER_HEALTH_HOST`, `DISCORD_UPDATE_WORKER_HEALTH_PORT`.
- Immutable images and Compose controls: `APP_IMAGE`, `MIGRATION_IMAGE`,
  `DISCORD_BOT_IMAGE`, `IMAGE_PULL_POLICY`, `APP_ENV_FILE`,
  `COMPOSE_PROFILES`, `POSTGRES_DB`, `POSTGRES_USER`.
- Service routing and scheduling: `DISCORD_PROVIDER_MODE`, `BST_API_BASE_URL`,
  `BST_WEB_BASE_URL`, `BST_API_TIMEOUT_SECONDS`,
  `DISCORD_UPDATE_WORKER_BASE_URL`, `DISCORD_UPDATE_WORKER_ID`,
  `DISCORD_UPDATE_WORKER_INTERVAL_SECONDS`,
  `DISCORD_UPDATE_WORKER_TIMEOUT_SECONDS`.
- Independently deployed gateway bootstrap: `DISCORD_TEAM_BINDINGS`. Discord
  guild/team/channel/role scope is already authoritative in database entities;
  this allowlist only routes gateway traffic and cannot grant an application
  capability. Replacing it requires a separately versioned gateway discovery
  protocol rather than duplicating bindings in generic configuration.
- Test/rehearsal switches: `PERFORMANCE_MEASURE`, `EXPERIENCE_MEASURE` and
  explicit fixture/stub modes.

## Version and audit model

`ApplicationConfiguration` is the Account's current projection. It records the
schema version, current revision, canonical digest, creator, last updater, and
timestamps.

Every seed, save, and rollback appends an
`ApplicationConfigurationRevision`. A revision stores its exact validated
values, digest, reason, actor, source, predecessor, timestamp, and (for a
rollback) the historical revision selected. Database triggers prevent revision
updates or deletes and require the current projection to advance exactly one
revision at a time.

The same transaction writes an Account-scoped `SecurityAuditRecord`. Audit
metadata contains only the revision, digest, changed category names, and
rollback source revision. It never duplicates destinations or configuration
values.

## Authorization and admin procedure

`configuration.view` and `configuration.manage` are Account-only capabilities.
Owner and Administrator roles receive both. Every server action reauthenticates,
checks same-origin request metadata, verifies the selected Account cookie, and
authorizes the exact Account target.

To change configuration:

1. Select the intended Account and open **Settings → Application
   configuration**.
2. Edit one or more category documents. Unknown fields and malformed values are
   rejected.
3. Enter a specific operational reason and choose **Preview changes**. Review
   the changed category list, next revision, and digest.
4. Choose **Save new revision**. A stale expected revision fails with a conflict
   and must be reloaded; it is never silently overwritten.
5. Confirm the new revision in history. Normal runtime reads see it immediately
   after cache invalidation.

## Initial environment migration

Existing settings are not silently removed or interpreted on every startup.
For each Account:

1. Deploy the schema migration while retaining the legacy Category B variables.
2. Open the admin portal and choose **Seed reviewed environment values**.
3. The allowlisted seed parser copies only Category B values, validates the
   complete snapshot, creates revision 1 with source `ENVIRONMENT_SEED`, and
   writes an audit record. Secret variables are neither read nor serialized by
   this parser.
4. Review the resulting category values and runtime behavior.
5. Remove the migrated Category B variables from the deployment only after all
   Accounts have an accepted seed revision. Category A and C variables remain.

Seeding is idempotent: if an Account already has configuration, the action does
not replace or merge it.

## Cache, startup, refresh, and rollback

- Runtime reads use a bounded 30-second in-process cache keyed by Account.
- Application readiness preloads current configuration for active configured
  Accounts after database and migration checks pass.
- Save, seed, and rollback invalidate the affected Account immediately.
- **Refresh runtime cache** evicts and reloads one Account without restarting
  the process.
- A cache miss or unseeded Account uses safe disabled defaults. It never falls
  back to arbitrary environment behavior.
- Rollback copies a validated historical snapshot into a new head revision. It
  does not mutate the selected historical row.

## Failure and recovery operations

- Validation failure: correct the named category; nothing is written.
- Authorization failure: verify active Account membership and the
  `configuration.manage` capability. Do not grant cross-Account access.
- Revision conflict: reload, compare the intervening revision, preview again,
  and save intentionally.
- Bad operational change: create a rollback revision with a reason, then verify
  the runtime cache refresh and audit entry.
- Missing secret: restore it in the external secret manager. Never add a secret
  field to database configuration.
- Startup preload failure: readiness fails closed until database access and the
  configuration schema are available.
