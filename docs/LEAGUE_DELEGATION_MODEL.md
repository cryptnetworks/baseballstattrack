# League delegation and organization authorization model

Issue [#107](https://github.com/cryptnetworks/baseballstattrack/issues/107)
defines the M8 authorization boundary for organization and league operations.
It builds on the [ruleset contract](RULESET_CONTRACT.md) and
[import portability contract](IMPORT_PORTABILITY.md). This document defines
principals, scope, capability, approval, privacy, audit, and lifecycle rules. It
does not implement fantasy, delegation UI, offline operation, or new baseball
features.

## Non-negotiable invariants

1. Organization and League are distinct owner principals, never aliases for an
   Account, Team, user, role name, email domain, or provider claim.
2. Organization membership grants zero Account authority by itself.
3. Account authority requires an explicit Account-approved delegation, exact
   capability grant, and exact bounded scope.
4. Every decision re-resolves active membership, delegation, grant, approval,
   target ancestry, and time window. Cached browser state is not authority.
5. No organization-wide grant inherits into Accounts or private player data.
6. Revocation and expiration fail closed at the authorization boundary.
7. Ruleset changes never reinterpret an accepted game.
8. An import package never selects its owner or authorizes its importer.
9. Allowed and denied privileged decisions produce minimal, append-only audit
   evidence without private baseball payloads.
10. Cross-Account access is denied without revealing whether the target exists.

## Existing authority and implementation boundary

The implemented authorization service remains Account-first. An authenticated
`AppUser` needs an active `AccountMembership`; role assignments and capability
grants are constrained to that membership and an exact Account, Team, Season,
or Game scope. Account-scoped composite foreign keys and fresh membership
evaluation prevent sibling-tenant access. That path remains the only production
authority path.

The current schema does not have Organization or League identity, Organization
membership, an Account-to-Organization delegation, approval provenance, or
complete grant expiration. Adding only some of those tables would create an
unsafe alternate authority path. Issue #107 therefore adds an executable,
framework-independent policy evaluator and this contract, but no persistence
or route integration. A future implementation must add the complete forward
migration described below before enabling delegated access.

## Principal and ownership model

### Organization

An `Organization` is an administrative owner that may coordinate leagues,
shared rulesets, and explicitly participating Accounts.

| Property      | Contract                                                                       |
| ------------- | ------------------------------------------------------------------------------ |
| Identity      | Immutable opaque `organizationId`; name and slug are display metadata only.    |
| Owner         | One recorded organization owner membership plus immutable ownership history.   |
| Lifecycle     | `DRAFT -> ACTIVE -> SUSPENDED -> ARCHIVED`; no state restores a revoked grant. |
| Visibility    | Private by default; discoverability is separate from authority.                |
| Account reach | None until an Account owner approves an exact delegation.                      |

### League

A `League` is an Organization-owned competition namespace. It can own league
settings, rulesets, competition metadata, and minimum-field shared reports. It
does not own an Account's teams, players, games, events, or credentials.

| Property     | Contract                                                                                           |
| ------------ | -------------------------------------------------------------------------------------------------- |
| Identity     | Immutable opaque `leagueId`, unique within its Organization.                                       |
| Owner        | Exactly one Organization; moving it creates audited lineage rather than silently changing history. |
| Lifecycle    | `DRAFT -> ACTIVE -> SUSPENDED -> ARCHIVED`.                                                        |
| Participants | Explicit Account delegations; schedule membership is not authorization.                            |
| Visibility   | Explicitly published public metadata or authorized private metadata.                               |

### User and membership

An authenticated `AppUser` may hold an `OrganizationMembership`. Membership is
an eligibility relation, not a role shortcut. Its lifecycle is
`INVITED -> ACTIVE -> SUSPENDED -> REMOVED`. Only `ACTIVE` membership can
receive grants. Invitations, provider groups, Discord roles, job titles, and
league labels are never authorization evidence.

An `AccountMembership` remains the source of Account consent. An authorized
Account member creates an `AccountDelegation` naming exactly one Organization
and one Account, its validity interval, the approving Account membership
(`approvedByAccountMembershipId`), and status. The organization operator then
needs a grant attached to both the Organization membership and exact delegation.

```text
authenticated AppUser
  -> active OrganizationMembership
  -> active exact CapabilityGrant
  -> active AccountDelegation (for every Account target)
  -> required Account/Organization approval (restricted actions)
  -> exact target ancestry
  -> allow + audit, otherwise deny + audit
```

## Scope hierarchy and inheritance

Scopes are explicit tuples. The identifier, owner ancestry, and delegation
identifier are all compared; possession of an opaque id never proves scope.

```text
Organization
  -> League

AccountDelegation (Organization + Account consent)
  -> Account
     -> Team
     -> Season
     -> Game
```

The two trees do not implicitly join. An Organization or League grant applies
only to its exact principal. An Account-delegated grant applies only inside the
named Account and can be narrowed to an exact Team, Season, or Game. It cannot
reach a sibling Account, sibling Team, unrelated League, or a target whose
resolved ancestry is incomplete.

An Account-scoped grant may cover descendants only for capabilities whose
matrix explicitly allows `ACCOUNT`. Team grants match an exact Team appearing
in server-resolved target ancestry. Season and Game grants match exact
identifiers. There are no wildcard, name-based, negative, hidden, transitive,
or "all current and future Accounts" grants.

## Capability and scope matrix

Every capability is an allowlisted identifier. A missing row means denied.
`Account delegation` means the Account owner approves the delegation and grant.
`Second approval` means a distinct exact approval record is also required.

| Capability                        | Allowed scope                  | Account delegation | Second approval                   | Purpose                                                |
| --------------------------------- | ------------------------------ | ------------------ | --------------------------------- | ------------------------------------------------------ |
| `organization.view`               | Organization                   | No                 | No                                | View allowed organization metadata.                    |
| `organization.members.manage`     | Organization                   | No                 | No                                | Invite, suspend, or remove organization members.       |
| `organization.ownership.transfer` | Organization                   | No                 | Yes, distinct organization member | Preserve deliberate ownership succession.              |
| `organization.rulesets.manage`    | Organization or League         | No                 | Yes                               | Manage owner rule families, not Account activations.   |
| `organization.settings.manage`    | Organization                   | No                 | No                                | Change organization settings.                          |
| `league.settings.manage`          | League                         | No                 | No                                | Change exact league settings.                          |
| `team.view`                       | Team                           | Yes                | No                                | View an exact participating Team's shared fields.      |
| `competition.settings.manage`     | Team or Season                 | Yes                | No                                | Manage competition metadata only.                      |
| `shared_resources.manage`         | Team or Season                 | Yes                | No                                | Manage explicitly shared non-private resources.        |
| `report.minimum_field.view`       | Team, Season, or Game          | Yes                | No                                | Read only a minimum-field shared report.               |
| `ruleset.activate`                | Account, Team, or Season       | Yes                | Yes, Account                      | Activate one compatible version for future selection.  |
| `data.import.review`              | Account                        | Yes                | Yes, Account                      | Review a quarantined package for that Account.         |
| `data.import.commit`              | Account                        | Yes                | Yes, Account                      | Atomically promote a reviewed import for that Account. |
| `report.export`                   | Account, Team, Season, or Game | Yes                | Yes, Account                      | Export an authorized privacy-filtered projection.      |
| `game.correct`                    | Game                           | Yes                | Yes, Account                      | Append a correction under the historical ruleset.      |
| `game.verify`                     | Game                           | Yes                | Yes, Account                      | Change verification state without rewriting events.    |

Capabilities do not bundle. `team.view` does not imply roster, player, contact,
event, report, export, correction, or verification access. Import review does
not imply commit. Organization settings authority does not imply Account
settings or ruleset activation authority.

## Restricted actions and approval

Ownership transfer, ruleset activation, import review/commit, export, game
correction, and game verification require an approval record bound to the exact
grant, capability, and scope. For an Account target, the approver is an active
Account membership named by the delegation. For a pure Organization target,
the approver is an active Organization membership.

An ownership transfer approver must be a different Organization membership
from the acting membership. Approvals have independent validity, expiration,
revocation, actor, reason, and accepted timestamp. Approval cannot be reused for
another capability or scope. It is authorization evidence, not a queued
instruction; the operation still performs a fresh evaluation.

## Least privilege and decision algorithm

New organizations, memberships, delegations, and grants start with no
authority. The server evaluates one requested capability against one resolved
target and one trusted application time:

1. Authenticate the actor and resolve the current `AppUser`.
2. Resolve the exact active Organization and active membership.
3. Find one exact active capability grant; ambiguity fails closed.
4. Validate allowed scope, start time, expiration, and revocation.
5. For an Account target, validate the exact Account-approved delegation and
   grant. Never infer consent from league participation.
6. Resolve target ancestry under the Account tenant filter and compare every
   scope component.
7. Validate the exact current approval when the matrix requires one.
8. Persist minimal audit evidence in the same transaction as a mutation.
9. Return only an allow/deny result and safe reason code.

Invalid dates, missing ancestry, duplicate active evidence, unavailable audit,
unknown capabilities, mismatched identifiers, stale memberships, and provider
failures all deny. Application code uses a central clock abstraction and UTC
instants with half-open validity `[validFrom, expiresAt)`.

## Delegation lifecycle, revocation, and offboarding

An Account delegation progresses through
`PENDING -> ACTIVE -> SUSPENDED -> REVOKED|EXPIRED`. A capability grant follows
the same terminal behavior. `REVOKED` and `EXPIRED` are terminal. Reapproval
creates new identifiers; it never resurrects old evidence.

- Suspension blocks mutations and reads on the next authorization check.
- Revocation records who, why, and when, invalidates attached grants, and does
  not delete historical audit or baseball records.
- Expiration uses trusted application time even before a cleanup projection.
- Removing an Organization member immediately makes attached grants unusable.
- Removing an Account from a league revokes its delegation without transferring
  ownership or deleting games, events, imports, reports, or ruleset lineage.
- Ownership transfer preserves previous owner and approvals in append-only
  history. It does not transfer participating Accounts.

Long-running operations reauthorize at commit. A worker that started before
revocation cannot commit afterward. Retry tokens bind to the same actor,
delegation, capability, scope, and payload digest.

## Audit contract

Allowed and denied privileged decisions record:

- action and safe result/reason code;
- actor and Organization membership identifiers;
- Organization, League when relevant, and exact Account when delegated;
- delegation, grant, and approval identifiers;
- capability, scope kind, and target reference needed for investigation;
- accepted application timestamp, correlation id, and operation digest; and
- before/after lifecycle for mutations.

Audit evidence is append-only and Account-isolated where it concerns Account
data. Audit writes for a mutation are atomic with the mutation; failure denies
the mutation. General audit metadata excludes player names, birth dates,
contact information, rosters, notes, import payloads, report contents,
credentials, tokens, provider claims, and secrets. Read audit retention follows
the owning Account's policy; immutable security evidence keeps only minimum
references required for incident response.

## Ownership and history matrix

| Resource                    | Canonical owner                    | Organization/League authority         | History rule                                     |
| --------------------------- | ---------------------------------- | ------------------------------------- | ------------------------------------------------ |
| Organization                | Organization owner principal       | Exact organization grants             | Transfers append ownership history.              |
| League                      | Parent Organization                | Exact league grants                   | Moving/archiving cannot rewrite competitions.    |
| Organization/League ruleset | Declared owner principal           | `organization.rulesets.manage`        | Published versions/bindings stay immutable.      |
| Account ruleset activation  | Account                            | Exact delegation + approval           | Future selection only; accepted games unchanged. |
| Team/Season/Game            | Account                            | Only an exact delegated capability    | Ownership never moves to the Organization.       |
| Imported data               | Target Account after atomic commit | Exact review/commit approvals         | Provenance and correction lineage remain.        |
| Reports/exports             | Account projection owner           | Explicit read/export + privacy filter | Regeneration preserves lineage.                  |
| Audit evidence              | Authority domain accepting action  | Security/retention access only        | Revocation does not delete evidence.             |

## Ruleset contract interaction

The [ruleset contract](RULESET_CONTRACT.md) remains authoritative. Organization
or League may own a ruleset family, but Account use is a separate activation
decision. `organization.rulesets.manage` cannot activate for an Account.
`ruleset.activate` requires exact Account delegation and approval,
compatibility checks, and an immutable activation record.

Activation changes only future selection. Accepted game setup and source event
bindings continue to point to their recorded immutable version. Revocation,
league departure, family renaming, and ownership transfer cannot rewrite
historical games or replay them under a latest version.

## Import portability interaction

The [import portability contract](IMPORT_PORTABILITY.md) remains authoritative.
An import package's producer, declared owner, ruleset name, or signature is
evidence, never authorization. The server selects the target Account before
validation. Review and commit are separate exact capabilities and approvals;
an organization operator cannot approve for an Account without explicit
Account-created authority.

Ruleset digest resolution, identity review, quarantine, dry run, atomic
promotion, provenance, correction lineage, and duplicate detection are
unchanged. Revocation between review and commit denies commit. Imported data
remains owned by the target Account and cannot overwrite accepted manual
history without the explicit correction policy.

## Privacy and cross-team minimum fields

Cross-team sharing is denied by default. The minimum-field projection may
contain only published team display name, competition/schedule metadata, public
game status and score, standings/aggregate totals, ruleset identity, and
verification state needed to understand the result. Each projection is server
constructed after authorization; it is never a filtered client payload.

It excludes private player identity, stable player identifiers, rosters,
lineups, birth date/age, youth classifications, guardian/contact information,
attendance, medical or eligibility notes, private location, raw scoring events,
correction notes, user identity, and Account settings. A public schedule or
league relationship does not make these fields shareable. Private player data
requires a separate future purpose-bound Account capability and privacy review;
#107 does not define or grant one.

Account privacy overlays and field allowlists apply after authorization and
before serialization, export, audit, caching, or notification. The most
restrictive applicable policy wins. Revoked access cannot be served from
caches. Youth-data restrictions cannot be relaxed by Organization policy.

## Database and migration requirements

No database change is included in #107. Existing Account tables cannot be
repurposed safely: `Account` remains the tenant boundary, and existing
migrations remain immutable. Before production delegation is enabled, one
reviewed forward migration must introduce the complete model:

- `Organization` and Organization-owned `League` identities and lifecycle;
- `OrganizationMembership` with current-state uniqueness;
- `AccountDelegation` approved by a real active `AccountMembership`;
- capability grants bound to membership, delegation, capability, exact scope,
  validity, expiration, and revocation;
- separate restricted-action approval evidence;
- ownership history and append-only delegation audit records;
- Account-scoped composite foreign keys for every Account resource reference;
- constraints prohibiting mixed scopes, self-approved ownership transfer,
  cross-Organization links, and active evidence after terminal state;
- indexes for active membership, delegation, grant, expiration, revocation, and
  exact authorization lookup; and
- row-level/service-boundary policies that fail closed under missing context.

Migration validation covers clean deployment, rollback/roll-forward, existing
Account data, concurrent approval/revocation, duplicate-active-row prevention,
foreign-key isolation, query plans, and Supabase RLS/service-role boundaries.
Rollback disables delegated routes and suspends grants; it never drops accepted
history. No route may read these future tables until constraints, policies,
atomic audit, and tests ship together.

## Focused test contract

The pure evaluator in `src/domain/league-delegation.ts` currently proves:

- explicit capability and exact scope behavior;
- Organization membership alone has no Account authority;
- sibling Team/Account, unrelated Organization, forged grant, and unknown
  capability attempts fail closed;
- suspended, revoked, future, and expired evidence denies;
- ruleset activation, import review/commit, export, correction, verification,
  and ownership transfer require exact approvals;
- ownership transfer cannot be self-approved; and
- allowed and denied decisions create minimized audit evidence.

Existing authorization tests continue to prove Account isolation and current
role/capability behavior. Documentation tests lock the contract, ADR, matrix,
privacy boundary, and persistence deferral.

Persistence integration, concurrent revoke-versus-commit, migration/RLS,
worker commit-boundary reauthorization, cache invalidation, UI, and end-to-end
delegation tests are deferred until the complete schema and service boundary
are implemented. A passing pure policy test does not authorize enabling a
production delegation route.

## Adversarial review findings

### League commissioner

Commissioners need competition metadata and minimum-field reports, not blanket
access to participating Accounts. Explicit capabilities support league
administration while Account consent gates private resources.

### Account owner

League participation must be reversible and never transfer baseball ownership.
Exact Account-approved delegations, terminal revocation, independent approval,
and preserved history satisfy that boundary.

### Privacy engineer

Organization membership creates a correlation surface across youth Teams.
Minimum-field server projections, strict exclusions, Account overlays, and
payload-free audits prevent silent expansion.

### Security reviewer

Material threats are forged ancestry, role-name authority, stale evidence,
confused-deputy imports, sibling-tenant access, approval replay, and revocation
races. Exact ids, central evaluation, time bounds, approval binding,
commit-boundary reauthorization, and atomic audit fail closed against them.

### Baseball operations reviewer

League administration must not change recorded baseball truth. Account
ownership, immutable ruleset bindings, append-only corrections, import
provenance, and verification lineage keep operations explainable.

## Deferred downstream work

Issue #107 defines authorization architecture only. Fantasy domain (#123),
fantasy data (#124), fantasy scoring (#125/#126), UI (#127), offline mode, and
M9 are untouched. Those consumers may depend on these principal and scope
invariants but cannot infer extra capabilities or private player access.
