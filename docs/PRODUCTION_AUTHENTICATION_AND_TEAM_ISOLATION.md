# Production authentication and team isolation

This document records the application authorization boundary. Provider setup,
session behavior, security controls, and migration procedures are specified in
[Authentication providers](AUTHENTICATION_PROVIDERS.md).

## Trusted chain

1. A configured `AuthenticationAdapter` completes a server OAuth/OIDC
   authorization-code flow with state, browser binding, PKCE, and nonce.
2. Exact `(provider, providerSubject)` resolves an immutable
   `AuthenticationIdentity` and application-owned `AppUser`. Email never
   participates. Unknown subjects receive no Account membership.
3. The application issues and validates its opaque, rotating, revocable
   session. Provider tokens are not application API credentials.
4. The requested Account and active `AccountMembership` are queried from the
   database. Provider claims cannot supply roles or grants.
5. Current role assignments and capability grants resolve authority for an
   exact Account-scoped target.
6. Only a successful server decision creates `TrustedActorContext` for the
   operation and its audit record.

`Account` remains the tenant boundary. Target queries include `accountId`, and
cross-Account or unknown targets receive the same generic denial. Disablement,
membership removal, role revocation, and capability revocation take effect at
the next protected operation even if the session remains valid.

## Framework boundaries

- `/login` starts one of the explicitly enabled provider adapters.
- `/auth/callback` accepts provider GET or POST callbacks, consumes the flow
  once, and replaces it with an application session.
- `POST /api/auth/providers/link` requires a current session and same-origin
  request to prove and link another provider subject.
- `/accounts` lists only Accounts with current active membership.
- `/api/auth/context` accepts the application cookie or an exact
  `Authorization: Bearer <opaque-application-session>` header and returns only
  the minimum authority fields.

Cookie mutations require exact same-origin Origin and effective Host. Page,
route, and Server Action boundaries authenticate and invoke
`AuthorizationService`; client visibility and selected-Account state are never
authorization evidence.

## Failure and concurrency

Unauthenticated, malformed, expired, and revoked sessions return the same safe
401 boundary. Membership, scope, and capability denials return a generic 403.
Provider/configuration/database failures return a generic 500. Responses and
operational events exclude tokens, cookies, provider subjects, email, secrets,
and database details.

Identity creation takes a database advisory lock on the exact provider
subject. Session rotation uses optimistic token versions and a bounded previous
token grace. High-risk mutations use `runAuthorizedTransaction` to re-resolve
the immutable application identity and current authority inside a serializable
transaction before committing the audited operation.

## Verification

Coverage includes every provider adapter, callback/state failure, Apple token
signature and nonce validation, identity collision and no-email-merge behavior,
session rotation/expiry/revocation, disabled users, Account isolation, current
membership/capability decisions, same-origin protection, migration constraints,
and reviewed migration/rollback behavior.
