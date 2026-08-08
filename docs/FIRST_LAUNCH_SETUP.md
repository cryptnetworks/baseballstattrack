# First-launch setup

First-launch setup is the one-time application bootstrap between a successful deployment and the ongoing Admin Portal. Open `/setup` after the installer reports healthy containers and migrations.

## Ownership boundary

Deployment remains responsible for containers, PostgreSQL, migrations, infrastructure secrets, signing keys, worker tokens, and authentication provider credentials. The setup wizard never displays or stores those values. It only verifies that the configured authentication boundary and required services are available.

The wizard owns the first application administrator, initial Account ownership, non-secret application identity, Account configuration revision 1, and readiness confirmation. Teams, seasons, integrations, and subsequent settings remain in the Admin Portal and use their existing services.

## Lifecycle

The database contains one `InstallationSetup` record with this lifecycle:

```text
NOT_STARTED → BOOTSTRAP_IN_PROGRESS → ADMIN_CREATED → CONFIGURATION_REQUIRED → READY
```

The state is not inferred from environment variables, user counts, Account counts, cookies, or browser storage. Database locking makes bootstrap and completion safe to retry after an interrupted request. Once `READY`, `/setup` redirects to the normal application and setup mutations are rejected.

## Administrator bootstrap

Sign in with the local account or an OAuth provider configured during deployment. The existing authentication service creates or resolves the `AppUser`; the bootstrap transaction associates that user with the initial Account, activates the membership, and grants the Account `OWNER` role. It does not create another password or identity store.

After ownership exists, only that Account's authorized administrator can view or complete the remaining setup state. Completion records the actor and timestamp on `InstallationSetup` and appends a `SecurityAuditRecord`.

## Application identity and configuration

The wizard collects installation name, organization display name, timezone, and locale. These non-secret values are validated and written through `ApplicationConfigurationService` with immutable revision history. The Admin Portal remains the control plane for later changes.

Never enter database credentials, OAuth secrets, API keys, signing material, or worker tokens in these fields. If a readiness item says **Deployment configuration required**, correct the protected deployment environment and restart the affected service.

## Recovery and troubleshooting

- Refreshing the browser or restarting containers resumes the persisted step.
- If authentication is unavailable, configure at least one supported provider in the protected deployment environment and verify its `/auth/callback` registration.
- If database or migration checks fail, use installer recovery or migration diagnostics before continuing. Do not manually advance `InstallationSetup`.
- If the original bootstrap administrator loses access before completion, restore provider access for the same identity. Any manual ownership recovery must follow the documented audited authorization procedure.
- After setup is `READY`, use the Admin Portal for Account defaults, teams, seasons, notification behavior, and integrations.
