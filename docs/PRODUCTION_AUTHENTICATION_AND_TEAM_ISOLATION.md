# Production authentication and team isolation

This document records the issue #28 implementation of the M0 authentication and
authorization contract. It is intentionally a prerequisite boundary, not M2
scorekeeping or M4 operational work.

## Trusted authorization chain

Protected work follows one server-owned chain:

1. Supabase Auth validates its cookie session or bearer access token and returns
   the immutable provider subject.
2. `PrismaAuthorizationStore.resolveOrProvisionUser` resolves the unique
   `(provider, providerSubject)` `AppUser`. The first valid login creates an
   active `AppUser` with no Account access; it does not infer identity from
   email and does not create a membership.
3. The requested Account is used in the database query. Both the `AppUser` and
   Account must be active and the `AccountMembership` must currently be
   `ACTIVE`.
4. Current, non-revoked `MembershipRoleAssignment` and `CapabilityGrant` rows
   are loaded. Session claims never supply application roles or grants.
5. The target is looked up by both its identifier and requested `accountId`.
   Team, Season, and Game ancestry is derived from database relationships.
6. The fixed role policy and exact named-grant policy resolve the required
   capability against the target scope.
7. Only a successful decision creates an opaque `TrustedActorContext`.
   Serialization removes its server-only marker, so posting copied actor JSON
   cannot create authority.
8. M1 application services convert that opaque context to their internal audit
   actor types. Their former arbitrary actor-JSON entry point is no longer a
   public application boundary.

Concurrent first requests read by provider identity and attempt one create. The
database uniqueness constraint remains authoritative: the winner creates the
`AppUser`; callers that receive the exact provider-identity conflict perform a
small bounded reread and return that same stable id. Unrelated unique conflicts
and a winner that remains invisible after the bounded attempts fail as a
generic provisioning error. High-risk authorization transactions provision
before opening their serializable transaction, then re-read the stable user and
current authority inside it, so conflict recovery never runs in an aborted
transaction. No email or mutable profile field participates in identity
resolution. A disabled user, inactive membership, suspended or archived
Account, revoked assignment, unknown target, or mismatched tenant fails closed.

## Supabase session boundary

`@supabase/ssr` owns cookie serialization and refresh. `src/proxy.ts` refreshes
provider sessions before application rendering. Page and Server Action
boundaries call `auth.getUser()`, which validates the token with Supabase
instead of trusting local cookie contents. API requests may use the same cookie
session or an exact `Authorization: Bearer <token>` header; bearer tokens are
also validated with `auth.getUser(token)`.

Provider and selected-Account cookies are HttpOnly, `SameSite=Lax`, scoped to
the application path, and `Secure` in production. The application uses
server-side OAuth, refresh, and sign-out boundaries, so browser JavaScript does
not need provider-token cookie access. The selected Account value is only a
navigation hint: selection calls `account.view`, and every later protected
operation independently re-resolves membership, capability, and scope.

Cookie-authenticated mutations require an exact same-origin `Origin` and
effective Host. Next.js Server Action protections remain defense in depth.
OAuth callback redirects use the configured canonical site origin when it is
available. Access tokens, refresh tokens, cookies, provider profile fields, and
request payloads are not logged by this boundary.

Sign-in rotates into the provider-managed PKCE session and sign-out clears the
current local provider session. Supabase validates signature, issuer, audience,
expiry, not-before, and provider status; the application does not decode claims
as authority. An expired, malformed, revoked, or provider-rejected token is
unauthenticated. Multiple provider sessions may remain valid independently,
but all of them lose Account access on the next request after application
membership or user disablement. The application does not claim instantaneous
global access-token revocation beyond Supabase's provider guarantees.

## Scope and capability resolution

`Account` is always the tenant boundary. An Account assignment applies to
matching descendants. A Team assignment applies only to that Team, its
participation, and Games in which it is a managed participant. A Season
assignment applies only to that Season and its Games. A Game assignment applies
only to that Game and its derived records.

Role capabilities and explicit grants combine by union. A grant must name a
known capability and use a valid scope for it. There are no wildcard or deny
capabilities, and `report.publish` has no valid MVP grant. The implementation
keeps `player.private_view`, privileged game actions, membership and ownership
actions, and exports separate from broad read or management capabilities.

All target queries include `accountId`; an identifier from another Account is
reported with the same generic denial as a missing identifier. The resolver
does not first fetch a global record and then compare its tenant in application
code.

## Framework boundaries

- `/login` starts an OAuth flow through the configured Supabase provider.
- `/auth/callback` exchanges the one-time provider code for the cookie session.
- `/accounts` is a protected page that lists only Accounts with current active
  membership.
- `selectAccount` is a protected, same-origin Server Action that reauthorizes
  `account.view` before changing the preference cookie.
- `/api/auth/context` is a representative protected route supporting cookie or
  bearer authentication. It returns only minimum application authority fields,
  never provider tokens or profile data.

Domain and data repositories remain server-internal. Route handlers and Server
Actions must authenticate and call `AuthorizationService.authorize` before
calling an M1 application service. Client-side hiding, selected Account state,
provider metadata, and request actor objects are never authorization evidence.

## Mutations and concurrency

Every operation creates authority from current database rows. Consequently,
disablement, removal, role revocation, and grant revocation take effect on the
next authorization attempt even while a provider session remains valid.
Regranting is likewise visible only after a fresh attempt.

High-risk new mutations use `runAuthorizedTransaction`. It resolves or
provisions the stable provider identity before opening a serializable Prisma
transaction, then re-reads the user and current authority in that transaction
and supplies both its transaction client and opaque actor to the write
callback. The write must use that supplied transaction client so revocation
cannot occur between the authority read and commit without a serializable
conflict or retry. It must also write the required security audit record in
that transaction. Callers must not retry a denied authorization as an
idempotency strategy.

Existing M1 repositories keep their immutable event, optimistic revision, and
audit behavior. Their application services now require the opaque actor
context. When a future HTTP or Action handler exposes an existing high-risk M1
operation, it must either use the transaction executor with a
transaction-aware repository or add the equivalent current-authority read
inside that repository's commit transaction.

There is no production service-session adapter in this issue because no current
external background worker requires one. Existing service actors are
server-internal repository/test inputs. A future worker must use separate
credentials mapped to a stable service identity, an explicit Account, and one
named capability; it must never reuse the human `AppUser` resolver, impersonate
a member, or receive anonymous system-wide authority.

## Failure behavior

Unauthenticated requests receive `401`. Authenticated callers without current
authority receive a generic `403` that does not distinguish missing resources,
wrong Account, inactive membership, or insufficient capability. Provider,
server configuration, or user-provisioning failures return a generic `500`
message. Detailed tokens, cookies, secrets, provider errors, Prisma diagnostics,
constraint names, provider subjects, emails, and protected target metadata are
not included in responses.

Application code may use correlation IDs and stable internal actor IDs for
auditing. Security audit records remain separate from baseball source events.

## Configuration and deployment

Required production values:

- `NEXT_PUBLIC_SITE_URL` — canonical HTTPS application origin.
- `NEXT_PUBLIC_SUPABASE_URL` — selected Supabase project URL.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase publishable anonymous key.
- `SUPABASE_OAUTH_PROVIDER` — `google`, `github`, or `azure`; defaults to
  `google` when omitted.
- `DATABASE_URL` — application database connection.

The selected OAuth provider must be enabled in Supabase, and
`<NEXT_PUBLIC_SITE_URL>/auth/callback` must be allowlisted. Do not use a
service-role key in browser, proxy, page, action, or ordinary API session code.
TLS termination and trusted forwarded Host configuration are deployment
requirements.

No schema change was required: the accepted relational schema already has the
provider-subject uniqueness, user, Account, and membership lifecycle, scoped
role and grant targets, and tenant-safe composite relationships needed by this
implementation.

## M2 boundary and deferrals

M2 handlers must request the exact Team, Season, or Game target, authorize the
named operation, and pass the resulting opaque context to `GameSetupService`,
`TeamSeasonRosterService`, `GameEventService`, or
`CorrectionAuditReplayService`. Scoring, verification, history replay, roster
management, and setup now have trusted application boundaries; pure reducers
and statistic derivation deliberately remain authentication-free.

Invitation acceptance, membership administration UI, ownership transfer,
recovery, step-up authentication, production service credentials, batch
exports/imports, public sharing, and parent/player access remain deferred. The
capability vocabulary can decide those named actions, but this issue does not
claim their lifecycle workflows or audit writers are implemented.

## Verification

Unit coverage includes trusted-context forgery, disabled identities, missing
membership, cross-Account lookup, sibling Team and Season isolation, exact Game
grants, revocation and regrant freshness, and same-origin mutation enforcement.
The existing M1 domain and persistence suites verify that trusted actor
adapters preserve audit identity and behavior. CI applies the full migration
chain before `npm run verify`, so database-backed tests exercise the same
constraints.
