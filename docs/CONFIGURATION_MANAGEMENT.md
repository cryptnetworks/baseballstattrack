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
Protected environment / secret manager
   |
   v
Validated infrastructure and authentication bootstrap
   |
   v
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

The environment is a bootstrap input, not a competing runtime configuration
store. After an Account has revision 1, runtime behavior is always resolved as
`configuration service -> database head -> typed consumer`. An unconfigured
Account receives the documented safe disabled defaults until an administrator
creates revision 1; arbitrary environment values are never a hidden fallback.

Configuration is Account-scoped. A valid administrator for Account A cannot
view, preview, update, refresh, seed, or roll back Account B. Background workers
resolve configuration using the Account identifier on each claimed item so a
setting from one Account cannot affect another.

## Stored configuration categories

| Admin section | Database-owned values                                                                                                           | Validation and authorization                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Features      | Calendar feeds, email notifications, Discord notifications, Discord updates                                                     | Strict booleans; Account `configuration.manage`                                    |
| Calendar      | Feed detail level (`private`, `opponent`, or `full`)                                                                            | Closed enum; Account `configuration.manage`                                        |
| Notifications | Destination allowlist, SMTP host/port/TLS/from identity, Discord API base URL                                                   | Typed destinations, bounded ports, safe HTTPS URLs; Account `configuration.manage` |
| Integrations  | Licensed-provider base URL, Discord credential reference, Discord installation/statistics/update API URLs, installation timeout | Safe HTTPS URLs, bounded references/timeouts; Account `configuration.manage`       |
| Rate limits   | Complete typed policy for every protected endpoint class                                                                        | Positive bounded quotas, complete class coverage; Account `configuration.manage`   |

Destination values may contain an email address or Discord channel identifier,
so they remain Account-private. They are never returned to another Account or
copied into security-audit metadata.

## Complete environment ownership inventory

The following classification covers the application, migration/container
runtime, documentation publisher, Discord bot, and Discord update scheduler
environment examples currently in the repository.

The repository has three root templates. `.env.example` is the direct-runtime
bootstrap reference, `.env.production.example` is the protected application
file used by the production Compose deployment, and `.env.local.example` is
the only template containing loopback or synthetic development values.
`compose.production.env.example` and `services/discord-bot/.env.example` remain
service-specific infrastructure templates; they cannot configure Account
behavior.

### Category 1: infrastructure and bootstrap

These stay in a protected environment file, orchestrator secret, or secret
manager. Secret entries are never accepted by the database schema.

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

Non-secret bootstrap values also remain external because they must be known
before authentication or database-backed administration is available:

- Runtime and image identity: `NODE_ENV`, `NEXT_PUBLIC_APP_ENV`,
  `npm_package_version`, `VCS_REF`, `REQUIRED_DATABASE_MIGRATION`.
- Public/authentication topology: `NEXT_PUBLIC_SITE_URL`,
  `AUTHENTICATION_ENABLED_PROVIDERS`, `OAUTH_CALLBACK_URL`, provider issuer and
  client identifiers, Apple team/key identifiers, `DISCORD_OAUTH_CLIENT_ID`,
  and `DISCORD_OAUTH_REDIRECT_URI`. These are bootstrap, not Account behavior;
  moving them behind login would create an authentication lockout dependency.
- Credential routing boundary: `EXTERNAL_DATA_PROVIDER_ALLOWED_ORIGIN`. An
  Account administrator may choose a path on that origin but cannot redirect a
  deployment credential to another host.
- Container/process networking: `HOSTNAME`, `PORT`, `APP_BIND_ADDRESS`,
  `APP_PORT`, `HEALTH_HOST`, `HEALTH_PORT`,
  `DISCORD_UPDATE_WORKER_HEALTH_HOST`, `DISCORD_UPDATE_WORKER_HEALTH_PORT`.
- Immutable images and Compose controls: `APP_IMAGE`, `MIGRATION_IMAGE`,
  `DISCORD_BOT_IMAGE`, `IMAGE_PULL_POLICY`, `APP_ENV_FILE`,
  `COMPOSE_PROFILES`, `POSTGRES_DB`, `POSTGRES_USER`.
- Independently deployed service bootstrap: `DISCORD_PROVIDER_MODE`,
  `BST_API_BASE_URL`, `BST_WEB_BASE_URL`, `BST_API_TIMEOUT_SECONDS`,
  `DISCORD_UPDATE_WORKER_BASE_URL`, `DISCORD_UPDATE_WORKER_ID`,
  `DISCORD_UPDATE_WORKER_INTERVAL_SECONDS`,
  `DISCORD_UPDATE_WORKER_TIMEOUT_SECONDS`, and `DISCORD_TEAM_BINDINGS`.
  Gateway bindings only constrain ingress routing; database permissions remain
  authoritative and the allowlist cannot grant an application capability.
- Build/runtime controls: `NEXT_TELEMETRY_DISABLED`, `ROLLBACK_REVISION`, and
  CI-provided GitHub variables. They do not alter Account behavior.

### Category 2: admin and database configuration

The following legacy names map to the five admin sections above. They are
accepted only by the explicit initial seed action for an existing deployment.
They are absent from every clean environment template, and normal runtime code
does not read them.

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

### Category 3: local development only

Loopback URLs, the local PostgreSQL credential, synthetic signing/worker keys,
and an optional local OAuth callback appear only in `.env.local.example`.
`PERFORMANCE_MEASURE`, `EXPERIENCE_MEASURE`, fixture/stub modes, and synthetic
test destinations are injected by explicit test commands rather than a
production template. CI and deployment checks reject treating these as
production configuration.

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

The same transaction writes an Account-scoped `SecurityAuditRecord`. The audit
record supplies actor and timestamp; metadata identifies the previous and new
revision, digest, changed category names, and rollback source revision. The
linked immutable revision records the required reason. Audit metadata never
duplicates destinations, free-form reasons, or configuration values.

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

## First deployment and legacy migration

On a new deployment, the container entrypoint and readiness check validate the
runtime identity, database URL, port, and pinned migration before serving
traffic. Authentication bootstrap is validated by the provider adapter. The
first authorized Account administrator then opens the configuration page and
creates revision 1 from safe defaults. This preserves an accountable actor and
avoids inventing a system owner before the Account exists. Normal operational
changes happen in the portal from then on.

Existing settings are not silently removed or interpreted on every startup.
For each Account:

1. Deploy the schema migration while retaining the legacy Category 2 variables.
2. Open the admin portal and choose **Create initial revision**.
3. The allowlisted seed parser copies only Category 2 values, validates the
   complete snapshot, creates revision 1 with source `ENVIRONMENT_SEED`, and
   writes an audit record. Secret variables are neither read nor serialized by
   this parser.
4. Review the resulting category values and runtime behavior.
5. Remove the migrated Category 2 variables from the deployment only after all
   Accounts have an accepted seed revision. Category 1 variables remain.

Seeding is idempotent: if an Account already has configuration, the action does
not replace or merge it.

## Cache, startup, refresh, and rollback

- Runtime reads use a bounded 30-second in-process cache keyed by Account.
- Application readiness preloads current configuration for active configured
  Accounts after database and migration checks pass.
- Save, seed, and rollback invalidate the affected Account immediately.
- Another application instance may retain its previous revision for at most 30
  seconds; its next cache miss reloads the database head. Instances never use
  separate environment-backed behavior.
- **Refresh runtime cache** evicts and reloads one Account without restarting
  the process.
- A cache miss or unseeded Account uses safe disabled defaults. It never falls
  back to arbitrary environment behavior.
- Rollback copies a validated historical snapshot into a new head revision. It
  does not mutate the selected historical row.

The current row, immutable revisions, and audit records live in PostgreSQL, not
container storage. A process restart, container recreation, image deployment,
or scale-out instance therefore reloads the same Account revision. The
PostgreSQL volume/managed database and its backups are the persistence boundary.

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
