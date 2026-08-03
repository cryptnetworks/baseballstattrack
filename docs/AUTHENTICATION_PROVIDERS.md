# Authentication providers

Baseball Stat Track owns application identity, sessions, and authorization.
OAuth and OpenID Connect providers prove control of an external subject; they
do not own `AppUser`, Account membership, roles, or capabilities.

```text
OAuth/OIDC provider
        |
        v
AuthenticationAdapter (server authorization-code exchange)
        |
        v
AuthenticationIdentity -> AppUser
        |
        v
ApplicationSession -> Membership -> capability resolver
```

The application no longer uses Supabase authentication clients, sessions,
cookies, or claims. Supabase-hosted PostgreSQL remains compatible because data
access uses the ordinary PostgreSQL/Prisma boundary.

## Supported adapters

| Adapter   | Stable identity evidence                           | Provider-specific setup                                 |
| --------- | -------------------------------------------------- | ------------------------------------------------------- |
| Authentik | OIDC `sub` from server-fetched UserInfo            | Issuer `https://host/application/o/<application-slug>/` |
| Google    | OIDC `sub` from server-fetched UserInfo            | Web OAuth client                                        |
| Discord   | Discord user `id` from `/api/v10/users/@me`        | OAuth application                                       |
| Facebook  | Graph user `id` from server-fetched `/me`          | Facebook Login app                                      |
| Apple     | `sub` in a signature-verified Apple identity token | Services ID, Team ID, key ID, and private key           |

Every adapter implements `AuthenticationAdapter`: it constructs an
authorization-code URL and exchanges a callback code on the server for a
normalized `{ provider, subject, email, emailVerified }`. New providers must
implement that interface, validate a stable subject using a trusted server
response, use PKCE, and add adapter and callback tests. Provider access,
identity, and refresh tokens are callback-local and are never persisted or
sent to the browser.

## Identity contract

`AuthenticationIdentity(provider, providerSubject)` is globally unique and
points to exactly one application-owned `AppUser`. Provider, subject,
ownership, source, reviewer, and link reason are immutable. Email is optional,
mutable profile metadata only. It is refreshed after a successful exchange but
is never queried for sign-in, linking, authorization, or duplicate recovery.

An unknown stable subject creates a new active `AppUser` with no Account
membership. It gains no application access until normal membership policy
grants it. An existing subject resolves its current `AppUser`. Subjects with a
shared email remain separate. A subject already owned by another `AppUser`
cannot be linked or migrated.

Client claims, callback profile fields, selected-Account cookies, and provider
roles are not authority. Existing `AppUser`, active `AccountMembership`, role
assignments, and capability grants remain authoritative on every operation.

## OAuth callback security

All adapters use authorization code with S256 PKCE. Starting a flow creates
independent random state, browser binding, PKCE verifier, and OIDC nonce values.
The database stores HMACs of state and browser binding plus an AES-256-GCM
envelope containing verifier and nonce. The browser receives only the attempt
identifier and random binding in an HttpOnly cookie.

The callback requires state, browser cookie, and an unexpired, unconsumed
database attempt. Consumption is atomic and one-time; even a failed provider
exchange requires a new flow. Redirect URIs come only from validated deployment
configuration, and successful return paths are server-created relative paths.
HTTP redirects from token and UserInfo requests are rejected.

Apple uses `form_post`, so its short-lived attempt cookie is `SameSite=None`
and `Secure`; all others are `SameSite=Lax`. Apple ID tokens are verified
against Apple's current JWKS with exact RS256 algorithm, key ID, signature,
issuer, audience, expiry, issued-at tolerance, and nonce checks. Other adapters
obtain identity through a server token exchange and authenticated UserInfo
call. No browser-supplied identity claim is trusted.

Callback endpoints accept GET and POST for provider compatibility. They clear
both attempt-cookie variants on success and failure, create a fresh application
session after identity resolution, and do not reuse a pre-login session. Login
and callback responses are private/no-store.

## Application sessions

The application issues an opaque `bst1` token. Only an HMAC-SHA-256 hash is
stored. Its cookie is HttpOnly, `SameSite=Lax`, application-wide, and `Secure`
in production. There is no browser-editable JWT claim set.

- Absolute lifetime: 30 days.
- Idle lifetime: 24 hours, refreshed by accepted activity but never beyond the
  absolute expiry.
- Rotation: after 15 minutes for cookie sessions.
- Concurrent-response grace: the prior token remains valid for 30 seconds and
  cannot trigger another rotation.
- Revocation: sign-out revokes the exact session, appends an audit event, and
  expires the cookie.
- Expiration: first observation marks the session revoked as expired and
  appends an expiration event.

Every session is bound by composite foreign key to the same `AppUser` and
`AuthenticationIdentity`; database triggers prevent reassignment. Created,
rotated, revoked, and expired events are append-only. Bearer requests accept
only application opaque tokens. Bearer use refreshes idle activity but does not
rotate a token in a response header, avoiding an ambiguous delivery protocol.

`AUTHENTICATION_ENCRYPTION_KEY` is the exact 32-byte base64url root used to
derive separate HMAC and AES keys. Changing it intentionally invalidates every
session and pending flow because plaintext recovery is impossible.

## Linking and legacy migration

Provider linking is explicit and authenticated. The `POST /api/auth/providers/link`
endpoint requires same-origin metadata and a current session. It starts a fresh
provider proof and records `EXPLICIT_LINK`, the linking `AppUser`, timestamp,
and reason. It never searches by email. Linking an identity owned by another
user fails generically.

The schema migration backfills each legacy `AppUser(provider,
providerSubject)` as `LEGACY_BACKFILL` without updating or deleting legacy
fields. This is the deployment rollback anchor. A legacy Supabase subject does
not automatically become a Google, Authentik, Discord, Facebook, or Apple
subject.

Moving existing users requires a reviewed mapping and explicit command:

```sh
npm run auth:identity-migration -- validate reviewed-mapping.json
npm run auth:identity-migration -- apply reviewed-mapping.json
npm run auth:identity-migration -- rollback reviewed-mapping.json
```

The version-1 file contains `appUserId`, exact `existingIdentity`, exact
`targetIdentity`, `reviewedByAppUserId`, and `reason`. Validate before apply.
The command uses one serializable transaction and advisory lock, rejects
duplicate targets or unknown reviewers, and is idempotent only for the exact
reviewed record. Logs contain counts, not subjects or emails.

Mapping files contain sensitive stable identifiers. Create them mode 0600
outside the checkout, never attach them to a PR or support ticket, and remove
them under the operator's approved data-handling procedure after the reviewed
report is retained.

Rollback removes only an exact `REVIEWED_MIGRATION` target and refuses once
that identity has session history. It never removes the legacy identity or
`AppUser`, rewrites membership, or merges users. If refused, disable/revoke
access and use a separately reviewed forward correction that preserves history.

```json
{
  "version": 1,
  "mappings": [
    {
      "appUserId": "application-user-id",
      "existingIdentity": {
        "provider": "authentik",
        "providerSubject": "old-stable-subject"
      },
      "targetIdentity": {
        "provider": "google",
        "providerSubject": "new-stable-subject"
      },
      "reviewedByAppUserId": "reviewer-application-user-id",
      "reason": "Approved identity-provider migration ticket"
    }
  ]
}
```

## Operational configuration

Register the exact callback at each provider and in the app. Production must
use HTTPS and normally uses `<NEXT_PUBLIC_SITE_URL>/auth/callback`. Loopback
HTTP is accepted only for local development.

| Classification                | Variables                                                                                                                                                                                                                                                            |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| External secret               | `AUTHENTICATION_ENCRYPTION_KEY`, `AUTHENTIK_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_CLIENT_SECRET`, `DISCORD_LOGIN_CLIENT_SECRET`, `FACEBOOK_OAUTH_CLIENT_SECRET`, `APPLE_OAUTH_PRIVATE_KEY`                                                                             |
| Deployment/public identifiers | `AUTHENTICATION_ENABLED_PROVIDERS`, `OAUTH_CALLBACK_URL`, `AUTHENTIK_ISSUER_URL`, `AUTHENTIK_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_ID`, `DISCORD_LOGIN_CLIENT_ID`, `FACEBOOK_OAUTH_CLIENT_ID`, `APPLE_OAUTH_CLIENT_ID`, `APPLE_OAUTH_TEAM_ID`, `APPLE_OAUTH_KEY_ID` |

`AUTHENTICATION_ENABLED_PROVIDERS` is a comma-separated subset of
`authentik,google,discord,facebook,apple`. Enabled adapters must have all
required fields. Secrets remain in environment/secret-manager storage and must
not enter application configuration, logs, source, browser bundles, or mapping
files.

Discord login variables are intentionally separate from
`DISCORD_OAUTH_CLIENT_*`, which authorize Account-scoped Discord installation
administration. Do not reuse credentials or callbacks across those boundaries.

## Deployment and incident procedure

1. Back up and deploy the migration. Confirm backfill count equals existing
   `AppUser` count and migration verification passes.
2. Configure exact callbacks, secrets, and enabled adapters. Validate in a
   non-production Account.
3. Validate and apply reviewed mappings. Keep legacy identities during the
   migration window.
4. Test sign-in, linking, Account isolation, sign-out, rotation, and revocation.
5. On provider compromise, disable its adapter, revoke affected application
   sessions, rotate its client secret, and review identity/session audit rows.
   Rotate the application root key only if it is compromised, because this
   invalidates every session and pending flow.

An executed user privacy-deletion request disables memberships, revokes all
active application sessions with append-only evidence, consumes pending link
attempts, and erases stored identity email/verification metadata. Immutable
provider subjects and ownership lineage remain only to prevent account reuse,
preserve security history, and retain opaque attribution under the documented
privacy lifecycle.

## Known operational risks

Provider availability, incorrect callback registration, poor mapping review,
and uncoordinated root-key rotation remain operational risks. Configuration
fails closed, mappings require exact reviewed subjects, and append-only session
and identity evidence supports incident review. Treat a root-key rotation as a
planned global sign-out, and test provider configuration outside production
before enabling an adapter.
