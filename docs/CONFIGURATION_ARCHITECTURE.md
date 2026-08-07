# Configuration architecture

Baseball Stat Track has two configuration planes:

1. Infrastructure bootstrap, supplied by the deployment environment or secret
   manager before the application can authenticate or connect to PostgreSQL.
2. Application behavior, stored as validated, Account-scoped revisions and
   edited through **Settings → Application configuration**.

The database is never a secret store. `ConfigurationEntry` can hold a
non-sensitive value, or a `SecretReference` containing only a provider,
reference identifier, environment, and rotation metadata. It cannot hold both,
and database constraints reject secret-shaped keys without a reference.

## Ownership

Bootstrap values remain external:

- database URLs and deployment identity (`NODE_ENV`, app environment, site URL,
  port, and required migration);
- encryption, signing, worker, OAuth, SMTP, Discord, and external-provider
  credentials;
- public OAuth endpoints/client identifiers needed to make the initial login
  screen available;
- container networking, image, and process controls.

Application values belong in the portal:

- feature availability and calendar detail level;
- notification destinations and non-secret transport settings;
- Discord installation/update/statistics endpoints, credential references, and
  bounded operational timeouts;
- external-provider endpoints and sync behavior;
- rate-limit policies and provider metadata.

Legacy Category 2 environment names are read only by the explicit initial seed
action. They are not runtime fallbacks after an Account has a configuration
revision.

## Secret references

Secret references use one of the supported external providers:

```text
VAULT:baseball/oauth/google-secret (production)
AWS_SECRETS_MANAGER:baseball/discord-token (production)
DOCKER_SECRET:notification-worker (local)
```

The application resolves the referenced secret at the infrastructure boundary;
the admin portal displays metadata only. Values, passwords, tokens, and private
keys are excluded from configuration JSON, revisions, audit metadata, exports,
and UI responses.

## OAuth and integrations

OAuth client secrets and encryption keys remain bootstrap secrets. Provider
metadata (enabled state, display labels, public client IDs, scopes, issuer and
endpoint metadata) is safe application configuration. Login bootstrap remains
external until an authenticated Account administrator exists, preventing a
configuration lockout. Subsequent provider metadata and integration behavior
are managed in the portal; secret rotation is performed in the external secret
manager and referenced by deployment configuration.

Discord, notifications, and external APIs follow the same boundary: URLs,
feature state, routing, schedules, and policies are database-owned; bot tokens,
API keys, SMTP passwords, signing keys, and worker tokens remain external.

## Lifecycle and rollback

Every change is validated, authorized for the target Account, and committed as
an immutable revision with actor, reason, digest, predecessor, and timestamp.
The current head is cached for at most 30 seconds and is invalidated after
save, seed, rollback, or explicit refresh. Rollback creates a new revision and
never edits historical rows. PostgreSQL persistence therefore survives process
restart, container recreation, deployment, and scale-out.

## Migration procedure

1. Deploy the schema migration while retaining existing bootstrap and legacy
   seed variables.
2. For each Account, use **Create initial revision** to import the allowlisted
   non-secret legacy values. The operation is idempotent and audited.
3. Review the resulting behavior and confirm external secret references resolve.
4. Remove migrated Category 2 variables from deployment files. Keep Category A
   and Category D bootstrap values.
5. To recover, restore the external secret reference first, then use the portal
   to roll back the affected configuration revision.

The migration is additive and does not copy secret values into PostgreSQL.
