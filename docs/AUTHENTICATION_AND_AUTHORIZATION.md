# Authentication and authorization boundaries

This is the M0 contract for identity, account membership, authorization, recovery, sessions, invitations, and security auditing. It defines boundaries for future M1 persistence and application services; it does not implement authentication, middleware, Prisma models, migrations, invitations, recovery, or UI.

## Decisions at a glance

- `Account` is the tenant and authorization boundary. Every protected baseball record belongs to exactly one account.
- An identity-provider subject identifies a login identity. An application `User` identifies the actor in this system. Email is mutable contact data, never a stable foreign key.
- Authentication, account membership, authorization, and baseball roster membership are separate concepts.
- Only an `Active` account membership grants access. Current database membership and grants are authoritative; session claims are hints.
- M1 uses account roles plus separately modeled scoped capability grants. Applicable grants combine by union. There are no explicit deny rules.
- Players and parents do not receive direct application login in MVP. A constrained, minimum-field viewer membership may be reconsidered later; public links and sharing tokens are deferred.
- Protected server operations authorize every target record and conceal unauthorized resource existence. Client route guards are UX only.
- Security audit records are distinct from baseball source events and must not contain secrets or invitation/session tokens.

## Concepts and identity model

| Concept                    | Meaning                                                                                             | Stable key and authority                                                                                                      |
| -------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Authentication identity    | The identity-provider account that proves a person or service can authenticate.                     | Immutable provider name plus provider subject. The provider owns credential, MFA, session, and credential-recovery mechanics. |
| User                       | The application actor linked to an authentication identity.                                         | Server-generated user id. Display name, email, phone, locale, and contact preferences are mutable.                            |
| Account                    | The tenant and ownership container for one scorekeeping domain.                                     | Server-generated account id; all account-owned records carry its tenant scope.                                                |
| Account membership         | A user's relationship to one account, with lifecycle, roles, and grants.                            | Server-generated membership id; current database state controls access.                                                       |
| Authorization              | The server-side decision that an authenticated actor may perform a capability on a scoped resource. | Derived from active membership, roles, grants, resource ownership, lifecycle, and operation constraints.                      |
| Baseball roster membership | A player's eligibility and participation on a team/season roster.                                   | Account-owned player and roster records; it does not grant administrative access or imply a login.                            |
| Service actor              | A narrowly identified non-human process acting for a named job.                                     | Explicit service identity plus account context; never an implicit global superuser.                                           |

Email and other contact fields may be used for display, notifications, duplicate-review, and invitation delivery. They must not be referenced by foreign keys or used to merge identities automatically. A changed email does not change historical actor attribution.

### User lifecycle and historical actors

The application user record remains separate from the provider record. A user may be `active`, `disabled`, `deleted`, `merged`, or `recovered` as an application state:

- `Disabled`: authentication may still be provider-valid, but application operations fail closed and memberships are disabled or otherwise denied.
- `Deleted`: detach or pseudonymize mutable personal fields as privacy policy requires; retain the stable actor id, historical event attribution, and audit references.
- `Merged`: only a separately approved, audited workflow may link duplicate user records. It must not rewrite source-event actors; the surviving identity and merge record explain the relationship.
- `Recovered`: restore access only through a verified provider or separately approved application recovery path. Recovery never grants an account membership that is not currently active.

Human users are the normal actors for scoring and administration. System-generated baseball events and security actions identify a service actor or an explicit system actor, with a reason and account context. A service actor cannot impersonate a human or silently rewrite human attribution.

## Membership lifecycle

Membership state is current authorization state, not historical ownership of past actions. Only `Active` grants access. Invitation state is separate; an invitation may lead to an `Invited` membership but cannot itself authorize access.

| Membership state | Access and grants                                                                                                                 | Historical attribution                                                                       | Reinvitation and required audit                                                                                                               |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `Invited`        | No account access; role assignments and grants are stored as a proposed snapshot and are ineffective.                             | No member action exists yet; invitation records identify the inviter and intended recipient. | The pending invitation may be revoked, expire, or be superseded. Creation, delivery, terminal transition, and acceptance attempt are audited. |
| `Active`         | Access is allowed only after the complete authorization algorithm succeeds; current role assignments and scoped grants may apply. | Actions retain stable user and membership ids.                                               | An existing active member cannot accept another invitation for the same account. Role/grant changes are separately audited.                   |
| `Disabled`       | No access; all role assignments and grants are ineffective immediately.                                                           | Existing actions remain attributed.                                                          | Re-enable requires `membership.update` and audit. A fresh invitation is allowed only after explicit removal or approved recovery.             |
| `Removed`        | No access; all role assignments and grants are ineffective permanently for that membership record.                                | Existing actions remain attributed.                                                          | A new invitation may create a new membership record. Removal, reason, and any later reinvitation are audited.                                 |

There is at most one `Active` membership for a user-account pair. An inactive membership cannot be revived by a stale session, cached claim, role assignment, or scoped grant. `membership.update` may activate an `Invited` membership only as the atomic successful result of an invitation acceptance; it cannot activate expired, revoked, or superseded invitation state.

Owners and administrators with `membership.update` may disable, re-enable, or update a non-owner membership in their account. They use `membership.role_assign` and `membership.grant_manage` only to assign capabilities no broader than their own effective authority and never to modify an owner membership. Only an owner with the matching `ownership.*` capability may change an owner membership. `membership.remove` follows the same distinction and must preserve the last-active-owner invariant. Every state transition records actor, target, prior/new state, reason when supplied, outcome, and correlation id.

## Invitation lifecycle

Owners and administrators with `membership.invite` may invite only non-owner roles and grants no broader than their own effective authority. Only an owner with `ownership.promote` may issue an invitation that creates an owner. Coaches, scorekeepers, and viewers cannot invite unless a future ADR adds an explicitly delegated capability.

| Invitation state | Acceptance and access                                                                                | Transition and reinvitation rule                                                                                                | Audit                                                             |
| ---------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `Pending`        | Token may be presented, but grants no access.                                                        | Created by `membership.invite`; only pending state can be accepted, revoked, expired, or superseded.                            | Create, intended role/scope snapshot, delivery attempt.           |
| `Accepted`       | No independent access; the resulting membership is active only after the atomic acceptance succeeds. | Terminal and single-use. A duplicate acceptance is denied.                                                                      | Acceptor identity, resulting membership, outcome, correlation id. |
| `Expired`        | No access; token is rejected.                                                                        | Terminal. Reissue creates a new pending invitation and never revives this record.                                               | Expiry and rejected attempt.                                      |
| `Revoked`        | No access; token is rejected.                                                                        | Terminal. Revocation competes atomically with acceptance; whichever terminal transition commits first wins.                     | Revoker, reason, outcome, rejected attempt.                       |
| `Superseded`     | No access; token is rejected.                                                                        | Terminal. Changing recipient, role, grant, or scope revokes/supersedes the old invitation and creates a new pending invitation. | Prior/new invitation relationship and changed snapshot.           |

An invitation stores a server id, account id, immutable intended role/grant/scope snapshot, inviter, delivery contact or known user id, creation/expiry/terminal timestamps, and an audit trail. Generate at least 256 bits of cryptographic token entropy. Store only a non-recoverable verifier (for example, a one-way hash associated with a non-secret invitation id), never the raw token. Default expiry is seven days and implementations may choose a shorter duration. Tokens are server-validated, account-bound, single-use, and never independently authorize access.

Acceptance rules:

1. In one transaction, load by invitation id; require `Pending`, an unexpired timestamp, matching verifier, intended account, unchanged invitation snapshot, and no existing active membership for the recipient/account pair.
2. Require an authenticated provider identity. A known-user invitation must match that application's user and provider-subject binding. A contact-addressed invitation requires the provider to present a currently verified contact matching the delivery contact, then binds the accepting provider subject to the new application user. Email is delivery-time proof only, never an identity foreign key.
3. If the recipient changes email before acceptance, the original invitation cannot be retargeted. The inviter must supersede it and issue a new invitation to the new verified contact. A forwarded token or a different provider identity is denied.
4. Atomically mark the invitation `Accepted`, consume the token, and create/activate the membership using exactly the immutable issued role/grant/scope snapshot. Role or scope changes require supersession and reissue; neither acceptance nor retry accepts client-supplied authority.
5. A duplicate invitation race is resolved by a unique pending-recipient/account rule or transactionally coalesced invitation. Existing active members are not invited again. Revocation and acceptance use one compare-and-set terminal transition, so a revoked token cannot win after revocation commits.
6. Record inviter, accepting identity, membership, terminal state, outcome, correlation id, and relevant before/after metadata. Never record the token, verifier, session, or credential secret.

Forwarding is mitigated by authenticated identity binding, not by URL possession. No public sharing tokens are designed by this document.

## Roles and capabilities

### Roles and use cases

The role vocabulary is fixed for M1: `Owner`, `Administrator`, `Coach/Manager`, `Scorekeeper`, and `Viewer`.

- `Owner`: accountable account owner; may transfer ownership and perform all account actions allowed by lifecycle and audit safeguards.
- `Administrator`: manages non-owner membership and account resources but cannot promote, demote, transfer, disable, or remove an owner unless separately assigned the owner role.
- `Coach/Manager`: a scoped role assignment for an assigned team, season, or game; manages only the matching team/season/roster and game workflows.
- `Scorekeeper`: scores assigned games and performs explicitly granted correction work; cannot manage membership or verify by default.
- `Viewer`: read-only access to the report type's minimum-field allowlist within explicit scope; it has no private-player-data capability.
- Player/parent: no direct login or relationship-based role in MVP. If later admitted, use a constrained viewer membership/report scope, not broad roster access or a new relationship role without an ADR.

Role assignments and capability grants are separate. A role assignment may be account-wide or scoped; a capability grant adds one named capability and never assigns, narrows, or edits a role. A role never bypasses tenant ownership, resource lifecycle, privacy field filtering, or privileged-action checks.

### Capability vocabulary

Capability names are stable, action-oriented identifiers. A capability applies only when its resource and scope match the target.

| Capability                                                                                                                            | Resource               | Valid scope                 | Default roles                                                                                    | Privileged?                         | Audit             | Future step-up auth            |
| ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | --------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------- | ----------------- | ------------------------------ |
| `account.view`, `account.manage`                                                                                                      | Account                | Account                     | All roles / Owner, Administrator                                                                 | Manage yes                          | Manage yes        | Manage later                   |
| `membership.view`, `membership.invite`, `membership.update`, `membership.remove`, `membership.role_assign`, `membership.grant_manage` | Membership             | Account                     | Owner, Administrator for non-owner targets; Owner only for owner targets                         | Invite/update/remove/role/grant yes | Yes               | Invite/remove later            |
| `ownership.transfer`, `ownership.promote`, `ownership.demote`                                                                         | Account membership     | Account                     | Owner                                                                                            | Yes                                 | Yes               | Yes                            |
| `team.view`, `team.manage`, `season.view`, `season.manage`                                                                            | Team, Season           | Account, Team, Season       | Owner, Administrator; Coach/Manager scoped                                                       | Manage no/yes for archive           | Yes for changes   | Later for destructive changes  |
| `roster.view`, `roster.manage`                                                                                                        | Roster entry           | Team, Season                | Owner, Administrator, Coach/Manager scoped                                                       | Manage yes for private fields       | Yes               | Later for private bulk changes |
| `player.private_view`                                                                                                                 | Player/person identity | Team, Season, Game          | Owner, Administrator; Coach/Manager and Scorekeeper only when explicitly scoped                  | Yes                                 | Yes               | Later                          |
| `game.create`, `game.setup`, `game.view`                                                                                              | Game/setup             | Team, Season, Game          | Owner, Administrator, scoped Coach/Manager and Scorekeeper; Viewer view only                     | Setup no; private view may be       | Setup changes yes | Later for sensitive setup      |
| `game.start`, `game.score`, `game.suspend`, `game.resume`, `game.complete`                                                            | Game/play              | Game                        | Owner, Administrator, scoped Coach/Manager and Scorekeeper                                       | Complete yes                        | Lifecycle yes     | Later for completion           |
| `game.correct`, `game.reopen`, `game.abandon`, `game.cancel`, `game.archive`                                                          | Game/source event      | Game                        | Owner, Administrator; Coach/Manager or Scorekeeper only by named explicit grant                  | Yes                                 | Yes               | Yes                            |
| `game.verify`, `game.reverify`                                                                                                        | Game verification      | Game                        | Owner, Administrator; Coach/Manager only by explicit `game.verify` grant; Scorekeeper no default | Yes                                 | Yes               | Yes                            |
| `report.view`, `report.export`                                                                                                        | Report/projection      | Game, Season, Team          | Owner, Administrator, scoped Coach/Manager, Viewer at exact report source scope                  | Export yes                          | Export yes        | Later for private export       |
| `report.publish`                                                                                                                      | Report/share           | Account, Team, Season, Game | None in MVP                                                                                      | Yes                                 | Yes               | Yes                            |
| `audit.view`                                                                                                                          | Audit record           | Account                     | Owner, Administrator; no ordinary Viewer access                                                  | Yes                                 | Access logged     | Yes                            |
| `privacy.request`, `privacy.manage`, `account.archive`, `account.delete_request`                                                      | Account/person/export  | Account                     | Owner; Administrator may request, not approve ownership deletion                                 | Yes                                 | Yes               | Yes                            |
| `ruleset.view`, `ruleset.manage`                                                                                                      | Ruleset configuration  | Account                     | Owner, Administrator; system-managed versions                                                    | Manage yes                          | Yes               | Later                          |

No wildcard capability exists. `account.manage` excludes every `membership.*`, `ownership.*`, `privacy.*`, `account.delete_request`, `audit.view`, `ruleset.manage`, `report.export`, `report.publish`, and privileged `game.*` capability unless it is separately listed. A new capability requires a documented resource, scope, default role, audit behavior, and lifecycle rule. `player.private_view` is never inferred from `team.view`, `roster.view`, game access, or report access.

## Scoped grants and resolution

M1 uses two separate concepts:

1. A role assignment gives a membership a fixed role vocabulary at one `Account`, `Team`, `Season`, or `Game` scope. It supplies that role's baseline capabilities only within the assignment's scope and inheritance rules.
2. A scoped capability grant adds exactly one named capability at one `Account`, `Team`, `Season`, or `Game` scope. It never assigns a role, changes a role, or narrows an existing role.

Every role assignment and capability grant references one active membership, one account, one scope target, and either a role or capability, never both. An active membership is always required. Assignments and grants cannot point to another account, and disabling/removing the membership makes all of them ineffective.

Scope inheritance is exact:

- `Account`: applies only to account resources and descendants for which the named capability permits account scope.
- `Team`: applies to that team, its team-season participations, and games whose participating managed team is that exact team. It does not apply to another team in the same season.
- `Season`: applies to that season, its team-season participations, and games in that season. It does not apply to a different season, even for the same team.
- `Game`: applies only to that game, its setup snapshots, play transactions, events, corrections, verification state, and game-derived reports. It does not apply to season aggregates.
- A game-derived report inherits from its game. A team or season report inherits only from the exact team or season scope and is readable/exportable only after every included game is authorized or the actor proves the shared team/season scope.

Multiple applicable role assignments and grants combine by union. There are no explicit deny rules in M1. A narrower assignment/grant cannot expand a resource's tenant, and no role or grant discloses fields excluded by the separate private-player-data policy.

## Deterministic authorization algorithm

Every protected server operation, including reads, mutations, batch actions, exports, retries, route handlers, server actions, and background jobs, performs this sequence:

1. Authenticate the actor with the identity provider or explicit service identity.
2. Resolve the application `User` or service actor from the provider subject; do not trust a client-supplied user id.
3. Load current database membership for the requested account and require `Active` state.
4. Resolve the target by account-scoped identifier and confirm the target resource belongs to that account before capability resolution.
5. Resolve the required named capability for the operation.
6. Resolve role capabilities and applicable grants using current database state.
7. Verify the resource's account/team/season/game scope and any inherited scope.
8. For a high-risk mutation, re-read the authorization state in the transaction that commits it, then apply lifecycle, privacy field, ownership, separation policy, confirmation, and privileged-operation constraints.
9. Record required audit evidence in that transaction or through a durable fail-closed outbox boundary; high-risk actions fail closed if required evidence cannot be durably written.
10. Permit or deny. Unauthorized callers receive a safe generic denial and no existence-revealing protected data.

Client-side guards are navigation hints only. The client must never be the authorization boundary. Batch/export operations authorize every record or prove a shared authorized scope before reading or producing output. Background jobs use explicit service identity, least-privilege capability, and account context for every item.

## Protected-resource matrix

Every matrix rule requires an active membership (or the explicitly named service actor), an account-scoped target lookup, and the exact account match before capability resolution. A capability must be valid at the stated resource scope; the lifecycle stated in the cell is a precondition; all create/update/archive/privileged/export operations are security-audited unless the cell says no operation. `—` means no MVP operation, not an implicit permission.

| Resource                  | View                                                                       | Create                                                                          | Update                                                                                                                  | Archive/delete                                                                                                               | Privileged transition                                                                    | Export/share                                                             |
| ------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Account                   | `account.view`; account scope                                              | Authenticated actor creates an account they become owner of                     | `account.manage`; active account role                                                                                   | `account.archive` / `account.delete_request`; active owner, no hard delete                                                   | `ownership.*` / `privacy.*`; owner and account lifecycle                                 | `report.export` authorizes each descendant; `report.publish` unavailable |
| Membership                | `membership.view`; account scope                                           | `membership.invite`; pending invitation only                                    | `membership.update`, `membership.role_assign`, or `membership.grant_manage`; target same account and no self-escalation | `membership.remove`; target same account, last-owner invariant                                                               | `ownership.*`; owner only, atomic                                                        | No membership export; restricted audit metadata requires `audit.view`    |
| Invitation                | `membership.view`; inviter or owner/admin in same account                  | `membership.invite`; account scope                                              | `membership.invite`; only pending invitation may revoke/supersede                                                       | Terminal state retained; no hard delete                                                                                      | Accept only under invitation lifecycle transaction                                       | Never export token, verifier, or secret                                  |
| Team                      | `team.view`; team scope                                                    | `team.manage`; account/team scope                                               | `team.manage`; active team                                                                                              | `team.manage`; archive; hard delete only with no dependent history                                                           | team archive; lifecycle audit                                                            | `report.export`; exact team scope and each included game                 |
| Season                    | `season.view`; season scope                                                | `season.manage`; account/season scope                                           | `season.manage`; active season                                                                                          | `season.manage`; archive; no destructive delete after games                                                                  | season completion/archive; lifecycle audit                                               | `report.export`; exact season scope and each included game               |
| Team-season participation | `team.view` and `season.view`; both ids match account                      | `season.manage`; exact team and season scope                                    | `season.manage`; exact participation                                                                                    | archive with `season.manage`; no delete after game dependency                                                                | eligibility change; audit                                                                | `report.export`; exact team-season report scope                          |
| Player/person identity    | `roster.view` for minimum fields; `player.private_view` for private fields | `roster.manage`; account/team/season scope                                      | `roster.manage`; `player.private_view` for sensitive fields                                                             | `privacy.manage`; pseudonymize, never hard delete historical identity                                                        | privacy action; owner and audit                                                          | `report.export` plus `player.private_view` for any private field         |
| Roster entry              | `roster.view`; exact team-season scope                                     | `roster.manage`; exact team-season                                              | `roster.manage`; active roster lifecycle                                                                                | `roster.manage`; archive, no historical rewrite                                                                              | eligibility change; audit                                                                | `report.export`; minimum fields only unless private capability           |
| Game                      | `game.view`; exact game/team/season scope                                  | `game.create`; account/team/season match                                        | `game.setup`; only `draft`                                                                                              | `game.cancel` only `draft`/`ready`; `game.archive` only as part of an `account.archive` cascade, never a source-event delete | named `game.start`, `game.complete`, `game.abandon`, `game.reopen`, `game.verify`; audit | `report.export`; game scope; publishing unavailable                      |
| Game setup snapshot       | `game.view`; exact game                                                    | `game.setup`; only `draft` to `ready` transition                                | append replacement only while game setup lifecycle permits                                                              | no delete after acceptance                                                                                                   | `game.setup`; validates `GameSetupReady` preconditions                                   | `report.export`; exact game report                                       |
| Play transaction          | `game.view`; exact game                                                    | `game.score`; only `in_progress`, current revision                              | never update; correction append only                                                                                    | never delete                                                                                                                 | `game.correct` and `game.reopen`; verified-game sequence required                        | no raw export; `report.export` only through scoped report                |
| Source event              | `game.view`; exact game                                                    | named lifecycle/game capability, with event lifecycle precondition              | never update; correction append only                                                                                    | never delete accepted event                                                                                                  | `game.correct`, `game.reopen`, `game.verify`; audit                                      | no raw export; `report.export` only through scoped report                |
| Correction                | `game.view`; exact game                                                    | `game.correct`; `completed` or `corrected`, or after `game.reopen` for verified | append only                                                                                                             | no delete                                                                                                                    | verified game requires `GameReopened` first; audit reason                                | `report.export`; exact game and report allowlist                         |
| Verification state        | `game.view`; exact game                                                    | `game.verify` / `game.reverify`; reconciled `completed`/`corrected` game        | append `GameVerified`, never toggle                                                                                     | no delete                                                                                                                    | `game.reopen`; correction invalidates verification; audit                                | verified report only while current state is `verified`                   |
| Game projection           | `report.view`; exact game                                                  | projection service identity with exact account/game context                     | same service rebuild only                                                                                               | rebuild/delete only as scoped service operation                                                                              | verified filter may serve only current verified state                                    | `report.export`; exact game authorization                                |
| Season projection         | `report.view`; exact season                                                | projection service identity per account/season                                  | same service rebuild only                                                                                               | rebuild/delete only as scoped service operation                                                                              | verified projection includes only verified games                                         | `report.export`; each included game or proven exact season scope         |
| Report                    | `report.view`; exact source scope                                          | report service derives after source authorization                               | no arbitrary report mutation                                                                                            | revoke generated artifact only; source records unchanged                                                                     | `report.publish` unavailable in MVP                                                      | `report.export`; source authorization rechecked                          |
| Export                    | `report.export`; exact report scope and each source record                 | export service with actor, account, and manifest                                | never edit content; regenerate under fresh authorization                                                                | revoke future artifact access; downloaded copy cannot be recalled                                                            | private fields require `player.private_view`; audit                                      | no public sharing in MVP                                                 |
| Audit record              | `audit.view`; exact account or explicit system scope                       | server/service writer in same scope                                             | append only                                                                                                             | no user deletion; retention/redaction deferred to issue #8                                                                   | privacy/retention workflow is future privileged work                                     | no general export; restricted security export requires future policy     |
| Ruleset configuration     | `ruleset.view`; exact account/system scope                                 | `ruleset.manage` or deployment service identity                                 | append immutable version; never mutate used version                                                                     | archive only unused version                                                                                                  | `ruleset.manage`; audit                                                                  | no sharing outside account authorization                                 |

## Game lifecycle permissions

The scoring lifecycle follows `docs/SCORING_SEMANTICS.md`. The practical M1 policy is:

| Action                 | Required capability and rule                                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Create                 | `game.create`; target account/team/season must match active membership scope.                                                |
| Edit draft setup       | `game.setup`; only `draft` (or explicitly returned-to-draft state) and same account.                                         |
| Mark setup ready       | `game.setup`; validates lineup, defense, pitcher, roster, ruleset, and writes snapshot.                                      |
| Start                  | `game.start`; only `ready`, after current authorization and setup snapshot checks.                                           |
| Score                  | `game.score`; only `in_progress`, current revision and game scope checked.                                                   |
| Suspend/resume         | `game.suspend` / `game.resume`; only `in_progress` / `suspended`; lifecycle transition is audited.                           |
| Complete               | `game.complete`; accepted ending condition required.                                                                         |
| Correct completed game | `game.correct`; completed game can become `corrected`, correction reason required.                                           |
| Reopen verified game   | `game.reopen`; explicit privileged grant, audit, confirmation, and step-up later.                                            |
| Apply correction       | `game.correct`; verified game must have reopened first; prior verification becomes invalid.                                  |
| Verify/reverify        | `game.verify` / `game.reverify`; completed/corrected game, reconciled projections, visible correction history.               |
| Abandon/cancel         | `game.abandon` / `game.cancel`; privileged lifecycle action with confirmation and audit.                                     |
| Archive                | `game.archive`; permitted only during an audited `account.archive` cascade; does not delete source events or bypass reports. |

An active owner or administrator has `game.verify` in account scope and may verify. A coach may verify a game they scored only through an explicit `game.verify` grant at the matching scope. M1 explicitly does not require separation of duties; it must not be claimed as enforced. Scorekeepers receive neither `game.verify` nor `game.reopen` by default, and cannot self-grant either capability. Corrections to a verified game always invalidate prior verification and require `game.reopen`, `CorrectionApplied`, rebuild/reconciliation, and explicit `game.reverify`. Live, completed, corrected, abandoned, and cancelled reports are labeled unverified; verified season reports include only games currently in `verified` state.

## Ownership safeguards

- Multiple owners are allowed. Every account must retain at least one active owner.
- Promoting, demoting, disabling, removing, or transferring an owner is an atomic transaction that checks the last-active-owner invariant against `Active` owners only; disabled, invited, removed, and deleted owners never satisfy it.
- An owner may transfer ownership only by atomically creating/activating the replacement owner and demoting or removing the outgoing owner as one auditable operation.
- Administrators cannot promote themselves or another member to owner without owner capability. Coaches, scorekeepers, and viewers cannot perform owner changes.
- A disabled or deleted owner retains historical attribution but cannot administer the account. A remaining active owner must recover continuity; an account with no active owner is not repaired by a normal administrator action.
- Sole-owner recovery, ownership disputes, and provider-identity loss are deferred to a separately audited recovery workflow; no undocumented platform superuser exists.
- Account suspension denies all normal member access and does not bypass archival, source-event, or historical-actor rules. Audit/recovery access requires the separately documented authorized workflow.
- Emergency support recovery, if later needed, must use a separately authenticated, least-privileged, dual-audited process and cannot rewrite historical actors.

## Session policy

The identity provider owns credential sessions, refresh, provider MFA, and provider credential reset. The application owns authorization freshness:

- Every protected server operation revalidates current active membership and applicable grants. Long-running batch/export work rechecks at authorization boundaries and before producing each protected artifact. Token expiry is not the revocation mechanism.
- Session claims may accelerate lookup but cannot authorize after membership disablement, removal, role change, or grant revocation.
- On access removal, the next operation fails closed; session revocation is a defense-in-depth action where provider support permits it.
- Credential reset, MFA changes, suspicious identity events, and account recovery should revoke or rotate sessions according to provider support and require fresh authentication for sensitive actions.
- Future implementation must use secure, appropriately scoped cookies, HTTPS, CSRF protection for cookie-authenticated mutations, and session-fixation prevention through provider/session rotation. Exact framework settings belong to implementation review.
- Do not log access tokens, refresh tokens, cookies, invitation tokens, passwords, MFA secrets, or full sensitive request payloads. Use correlation ids and stable actor ids.
- Sensitive actions that may later require step-up: ownership changes, membership changes, private exports, verified-game reopen/correction, privacy actions, deletion requests, publishing, and ruleset administration.

## Recovery boundaries

| Recovery case                     | Boundary                                                                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Forgotten credentials or lost MFA | Provider credential/MFA recovery. It restores authentication only; application membership is rechecked.                                          |
| Lost email access                 | Provider recovery or separately verified support process; email, public team data, and score information alone cannot prove account ownership.   |
| Compromised identity              | Revoke provider sessions, investigate audit records, disable memberships as needed, and reauthenticate through the provider.                     |
| Sole owner lockout                | Deferred audited ownership-recovery workflow with strong identity/proof requirements; no public-data proof and no hidden superuser.              |
| Deleted provider identity         | Historical user/actor remains; a new identity does not inherit membership without explicit verified recovery.                                    |
| Ownership dispute                 | Freeze risky changes if necessary and use a future separately approved dispute process; do not silently transfer ownership.                      |
| Incorrect invitation recipient    | Revoke invitation, reject acceptance, audit outcome, and reissue to a verified identity.                                                         |
| Application membership recovery   | Re-enable or recreate membership only through current owner/admin capability and audit; provider authentication is necessary but not sufficient. |

Recovery must not use only public account, team, roster, or score information and must not rewrite historical event actor identity.

## Privileged actions and audit

Privileged actions include invitations; membership removal/disablement; role/grant changes; ownership promotion, demotion, and transfer; private-data exports; verified-game reopen/correction; verification/reverification; account archive or deletion request; pseudonymization; publishing/sharing; ruleset administration; audit access; and recovery.

Each privileged action names a capability and account/resource scope, records a security audit event, requests explicit confirmation for irreversible or high-impact actions, and declares reversibility. Step-up authentication is deferred for initial implementation but reserved for high-risk actions. If required audit evidence cannot be written durably, the action fails closed; a future transactional outbox may make the authorization mutation and audit delivery reliable without silently proceeding.

Audit records are separate from baseball source events and include:

- account id or explicit system scope;
- stable actor id, actor type, and membership/service identity;
- action/capability, target type/id, timestamp, outcome, and reason;
- request/correlation id and authentication strength when available;
- relevant before/after role, scope, lifecycle, or privacy metadata.

They never store passwords, tokens, invitation secrets, or duplicated full baseball-event payloads. High-risk authorization denials are recorded with safe target metadata; ordinary denials may be sampled or counted according to later operational policy.

Audit retention, legal holds, and privacy redaction periods are deferred to issue #8. That deferral does not permit an implementation to omit required audit evidence or to make privileged actions succeed silently when the audit write fails.

## Read-only and player/parent access

MVP has no player or parent portal, relationship-based grant, public report, live spectator feed, public link, or sharing token. If a later MVP extension requires a player or parent login, it receives an active, explicitly report-scoped `Viewer` membership, never a special broad player/parent role. Viewer access exposes only the report type's documented minimum-field allowlist and authorizes every report source. General team, roster, game, or report access must not reveal private player contact, birth, notes, or other sensitive fields. Player-specific relationship grants remain deferred. Export is a separate privileged capability, not a substitute for authorization.

## Denials, retries, and service actors

Unauthenticated requests fail with a generic authentication response. Authenticated but unauthorized requests fail with a generic authorization response that does not distinguish missing resource from forbidden resource when that distinction would enable enumeration. Invitation endpoints reveal only safe status. The server logs correlation id, actor, account context, capability, and outcome without secrets; clients may retry only according to operation-specific idempotency rules.

An idempotent retry of a scoring action revalidates current authorization before returning its result. If access was removed, it must not return protected payload data. A previously accepted result may be represented only by a safe generic status or denial, according to the endpoint contract.

Service actors include projection workers, reconciliation jobs, invitation delivery, migration/deployment actors, and future import/export jobs. Each gets an explicit identity, least-privilege capability, account context, auditable operation, and secret supplied outside source control. A multi-account scheduler may enumerate work only through a separately documented platform-job contract; it must invoke each account as an isolated account-scoped operation and may not read or write account records with an implicit global grant. Background jobs never impersonate memberships. Migration/deployment actors are operational identities, not application owners. This policy does not implement service accounts.

## Failure-mode controls

| Failure                                  | Prevention                                                       | Detection                                    | Recovery                                                                 |
| ---------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------ |
| Stale session after membership removal   | Current membership check per operation                           | Authz mismatch audit/metric                  | Deny, revoke sessions where supported, retain removal                    |
| Stale role claim                         | Database role/grant lookup                                       | Claim-versus-DB mismatch                     | Ignore claim and use current state                                       |
| Cross-account identifier                 | Account-scoped lookup and composite constraints                  | Cross-account denial tests, anomaly checks   | Fail closed, patch query, audit impact                                   |
| Missing account check                    | Account predicate required before capability resolution          | Query review and tenant-isolation tests      | Fail closed, patch query, audit impact                                   |
| Over-broad scoped grant                  | Named capability/scope validation; no wildcards                  | Grant review and access tests                | Revoke grant, audit affected access                                      |
| Scope-inheritance bug                    | Exact account/team/season/game inheritance rules                 | Cross-team and game-to-season denial tests   | Revoke grant, patch resolver, audit impact                               |
| Forwarded invitation                     | Identity binding, expiry, server validation                      | Rejected acceptance audit                    | Revoke/supersede token, reissue, investigate                             |
| Replayed invitation                      | Single-use terminal state and token verifier                     | Acceptance/replay audit                      | Deny replay, investigate                                                 |
| Revocation/acceptance race               | Atomic terminal-state compare-and-set                            | Invitation transition audit                  | Winner retained; deny losing transition                                  |
| Last-owner removal                       | Atomic invariant transaction                                     | Constraint/periodic invariant check          | Block mutation; audited recovery only                                    |
| Unauthorized owner promotion             | Owner-only capability                                            | Role-change audit                            | Revert through authorized transaction                                    |
| Unauthorized verification                | Explicit `game.verify`; default scorekeeper deny                 | Verification audit                           | Invalidate/review game                                                   |
| Coach accesses another team              | Team/season/game scope check                                     | Denials and anomaly metrics                  | Deny and revoke erroneous grant                                          |
| Viewer sees private player data          | Separate `player.private_view` and field filtering               | Access audit                                 | Revoke, investigate, redaction/privacy workflow                          |
| Export contains unauthorized records     | Per-record authorization and shared-scope proof                  | Export manifest/audit                        | Stop job, revoke artifact, investigate                                   |
| Mixed-account batch                      | Per-item account check or proven single account scope            | Batch tenant-isolation tests                 | Stop batch, quarantine output, investigate                               |
| Background job missing account scope     | Explicit service identity/context                                | Reconciliation and job audit                 | Stop job, quarantine output, repair                                      |
| Recovery hijack                          | Provider/recovery proof, no public-data proof                    | Recovery audit and alerts                    | Freeze access, revoke sessions, investigate                              |
| Deleted user as historical actor         | Stable actor ids and pseudonymization                            | Attribution integrity checks                 | Retain audit/source history; redact only mutable fields                  |
| Retry after access removal               | Reauthorize before idempotent result                             | Submission audit                             | Deny payload return; preserve event history                              |
| Authorization database outage            | Fail closed for protected operations                             | Availability and authorization error metrics | Retry safely; do not bypass with claims                                  |
| Audit write failure on privileged action | Durable audit in same transaction or fail-closed outbox boundary | Audit health checks                          | Abort action or quarantine for explicit recovery; never silently proceed |
| Secret logged accidentally               | Redaction, allowlisted logging, secret scanning                  | Log scanning and incident alerts             | Revoke/rotate secret, restrict logs, investigate                         |
| Client-only authorization bypass         | Server algorithm on every protected operation                    | Direct-endpoint and integration tests        | Deny, patch server boundary, audit impact                                |
| Projection/report authorization bypass   | Source-scope checks before serving/exports                       | Projection/report isolation tests            | Stop serving artifact, revoke future access, investigate                 |

## Future implementation acceptance criteria

M1/M2 implementation work is not complete until tests and review demonstrate:

- current active membership is checked on every protected server operation;
- account ownership is checked before capability resolution;
- cross-account reads, writes, batches, exports, and scoped grants are denied;
- stale-session and outdated-role-claim access is denied;
- invitation expiration, identity binding, replay, revocation, and single-use behavior work;
- invitation supersession, wrong-identity acceptance, role/scope snapshot immutability, and revocation/acceptance races are denied or resolved atomically;
- last-owner protection is transactional under concurrent requests;
- privileged actions produce required audit records and fail closed when evidence cannot be recorded;
- verified-game correction requires explicit reopen/correction capability, invalidates verification, and requires re-verification;
- read-only access returns only each report type's documented minimum-field allowlist and never implies private-player-data access;
- scoped team access cannot reach another team in the same season, game scope cannot reach season aggregates, and mixed-account batches fail closed;
- no authorization decision depends only on client-side route guards;
- background jobs carry explicit service identity and account context;
- recovery paths cannot grant membership from public baseball/account information or rewrite historical actors.

## Issue #7 acceptance-criteria mapping

| Issue criterion                                                                                | Implementable rule in this document                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Roles and permissions cover owner, coach, scorekeeper, player/parent, and read-only use cases. | [Roles and use cases](#roles-and-use-cases) fixes the five-role vocabulary, explicitly limits owner/admin authority, scopes coaches, denies scorekeeper verification/reopen by default, and defers direct player/parent login in favor of a report-scoped Viewer if later required. [Capability vocabulary](#capability-vocabulary) names each action.                       |
| Every protected resource has an authorization rule.                                            | [Protected-resource matrix](#protected-resource-matrix) names the capability, account/scope check, lifecycle condition, mutation/deletion policy, privileged transition, export/share behavior, and audit rule for every listed resource. [Deterministic authorization algorithm](#deterministic-authorization-algorithm) applies those checks to every protected operation. |
| Account recovery, session expiry, and audit expectations are documented.                       | [Session policy](#session-policy) makes current membership authoritative independent of token expiry; [Recovery boundaries](#recovery-boundaries) separates provider, membership, and ownership recovery; [Privileged actions and audit](#privileged-actions-and-audit) defines required evidence, exclusions, fail-closed behavior, and issue #8 retention deferral.        |

## Scope and follow-up

This document deliberately does not add production authentication, auth middleware, Prisma models, migrations, invitation/recovery flows, service accounts, public sharing, or UI. Future implementation issues must preserve this contract. Changes to tenant ownership, public sharing, relationship-based player/parent access, explicit denies, or cross-account movement require a new ADR and updates to this canonical document.
