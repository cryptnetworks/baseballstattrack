# ADR 0012: Separate organization authority from Account delegation

## Status

Accepted

## Context

M8 needs Organization and League administration while the production system's
security and ownership boundary is the Account. Ruleset families may have an
Organization or League owner, and import operators may assist participating
Accounts. Treating league membership as Account membership would create
transitive cross-tenant access, expose private/youth data, and allow a league
operator to alter baseball history without Account consent.

The existing schema has Account membership and Account-scoped capabilities but
does not have Organization principals, League principals, Account delegation,
restricted-action approval, or complete grant expiration. A partial schema
would be unsafe because code could mistake an administrative link for tenant
authorization.

## Decision

Organization and League are separate owner principals. Organization membership
has no Account authority. Account-scoped authority requires all of:

1. an authenticated user and active Organization membership;
2. an active Account-approved delegation naming the exact Organization and
   Account;
3. an explicit allowlisted capability grant bound to that membership,
   delegation, and exact scope;
4. a separate exact approval for restricted actions; and
5. fresh server-resolved target ancestry, lifecycle, time, and audit evidence.

There is no implicit Organization-to-Account inheritance. Account delegation
can narrow authority to Account, Team, Season, or Game only where the capability
matrix permits. Revocation and expiration fail closed, long-running mutations
reauthorize at commit, and audit is atomic with mutation.

The current Account authorization path remains the only production path. Issue
#107 adds a pure policy evaluator and architecture contract but no persistence
or routes. Production enablement requires one complete forward migration and
service boundary implementing all principals, consent, grants, approvals,
constraints, isolation policies, and audit behavior together.

Ruleset activation remains an Account-approved future-selection operation and
cannot reinterpret historical games. Import packages remain evidence and can
never choose their owner or authorize their importer. Cross-team views use a
minimum-field projection and do not include private player data.

## Consequences

- League administration is possible without converting a League into a tenant
  or moving Account-owned baseball data.
- Account owners retain explicit, revocable control over delegated scope and
  sensitive actions.
- Consumers evaluate capabilities, not roles or display names.
- Authorization requires exact indexed joins and fresh time/lifecycle checks;
  caches can optimize retrieval but cannot become authority.
- A larger future migration is required, but avoids an incomplete alternate
  authorization path.
- Fantasy, UI, offline mode, and downstream features receive no implied
  permissions from this decision.

## Alternatives rejected

### Make Organization the parent tenant of every Account

Rejected because league participation is not ownership. This would create
broad implicit access and make departure or multi-league participation unsafe.

### Reuse Account roles for league operators

Rejected because it would require synthetic Account memberships, obscure
consent, and encourage role-name checks instead of exact capabilities.

### Infer access from schedules, Team membership, email domains, or providers

Rejected because those facts are mutable context, not Account-approved
authorization evidence.

### Add Organization tables now and fill delegation later

Rejected because a partial schema could be consumed as authority before
consent, approval, revocation, audit, and tenant constraints exist.

### Copy Account data into an Organization-owned store

Rejected because copies drift, complicate correction lineage and deletion, and
can bypass Account privacy overlays.

## Revisit triggers

Revisit only if Account ownership changes, a complete persistence design is
ready for implementation, legal/privacy requirements prohibit a planned
minimum-field use, or a proven operation cannot be represented by an explicit
capability and bounded delegation. Any revision must preserve historical
ownership, ruleset bindings, correction provenance, and deny-by-default tenant
isolation.
