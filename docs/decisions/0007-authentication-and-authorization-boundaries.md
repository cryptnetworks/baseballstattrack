# ADR 0007: Authentication and Authorization Boundaries

## Status

Accepted

## Context

Baseball Stat Track stores youth-player data and replayable account-owned baseball history. The product and persistence decisions establish `Account` as the tenant, separate users from baseball roster membership, and require server-side isolation. Issue #7 requires the identity, membership, role, invitation, recovery, session, privileged-action, and audit boundaries before production access control is implemented.

## Decision

Adopt the policy in [Authentication and authorization boundaries](../AUTHENTICATION_AND_AUTHORIZATION.md):

- Authentication identity is an immutable identity-provider subject linked to a separate application user. Email/contact data is mutable and never a foreign key.
- `Account` is the tenant and authorization boundary. Only an `Active` account membership can grant access; current database membership and scoped grants are authoritative, while session claims are hints.
- M1 uses the roles `Owner`, `Administrator`, `Coach/Manager`, `Scorekeeper`, and `Viewer`. Scoped role assignments and separately modeled named capability grants have distinct semantics and may be scoped to `Account`, `Team`, `Season`, or `Game`.
- Scope inheritance is exact: team to that team's participations/games, season to that season's participations/games, and game to its derived reports. Applicable roles and grants union; explicit deny rules and wildcard permissions are not supported in M1.
- Authorization runs on every protected server operation, after tenant ownership is confirmed, and fails closed without revealing unauthorized resource existence. Client guards are not authorization.
- Game verification, verified-game reopening/correction, ownership changes, private exports, membership administration, recovery, privacy, and publishing are privileged and auditable. A verified-game correction invalidates prior verification and requires explicit reopen and re-verification.
- Players and parents have no direct login in MVP. Public links, public sharing, and relationship-based broad access are deferred.
- Security audit records remain separate from baseball source events. Privileged operations cannot silently succeed when required audit evidence fails.

## Alternatives rejected

- Email as identity or foreign key: rejected because contact data changes and cannot safely establish actor continuity.
- Session claims as authorization authority: rejected because membership and grants can be revoked before token expiry.
- Team-owned tenancy: rejected by ADR 0005; account ownership supports multi-team and future collaboration.
- A single overloaded role/grant record: rejected because baseline role assignment and scoped capability delegation have different semantics.
- Broad player/parent role or public tokens in MVP: rejected because product scope excludes portals/public sharing and youth privacy needs a minimum-field design.
- Undocumented platform superuser: rejected; emergency recovery requires a future separately audited workflow.

## Consequences

Future schema work must preserve stable actor ids, active-membership uniqueness, account-scoped relationships, separate role assignments and grants, append-only audit records, immutable invitation authority snapshots, non-recoverable invitation verifiers rather than raw tokens, and transactional last-owner protection. Application services must centralize the deterministic authorization algorithm and test tenant isolation, stale sessions, invitation terminal-state races, exports, retries, recovery, scoped inheritance, and privileged audits. Production authentication and authorization implementation remain follow-up work; this ADR does not add middleware, models, migrations, or UI.

## Revisit triggers

Create a new ADR before introducing cross-account transfer, public sharing, direct player/parent login, relationship grants, explicit denies, platform support recovery, or a different tenant/ownership model.
