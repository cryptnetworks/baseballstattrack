# Ruleset contract

Issue [#106](https://github.com/cryptnetworks/baseballstattrack/issues/106)
defines the design gate for configurable league rulesets. This document is the
canonical identity, ownership, versioning, activation, compatibility, and
historical-binding contract. It defines extension points; it does not implement
rule behavior, fantasy, imports, delegation, scoring changes, or UI.

## Non-negotiable invariants

1. Every accepted game setup resolves to exactly one immutable ruleset version.
2. The first accepted scoring event permanently seals that game's binding.
3. Replay never consults the latest, default, or currently active version.
4. Corrections use the recorded version and cannot change ruleset identity.
5. A referenced version remains available for replay, statistics, reports,
   exports, imports, analytics lineage, and fantasy lineage.
6. Unknown or unsupported rules fail explicitly; consumers never silently
   ignore, coerce, or default them.
7. Activation changes only future selection. It cannot reinterpret an existing
   setup snapshot or historical game.
8. Baseball scoring truth and fantasy scoring are separate versioned domains.
9. Every read, review, activation, deprecation, and retirement is evaluated in
   the ruleset owner's authorization scope.
10. Cross-Account, organization, or league references fail without revealing
    whether a private ruleset exists.

## Existing foundation and implementation gap

The repository already provides these historical guarantees:

- `RulesetVersion` is Account-scoped and stores a name, positive version,
  configuration, and `ACTIVE`/`ARCHIVED` state.
- `GameSetupSnapshot.rulesetVersionId` binds every accepted setup revision.
- `SourceEvent.rulesetVersionId` duplicates the binding as durable event
  evidence; event acceptance requires it to match the setup.
- tenant-scoped foreign keys use `ON DELETE RESTRICT`, so referenced versions
  remain available.
- a database trigger prevents changes to version id, Account, name, version,
  and configuration.
- setup selection exposes active versions and continues to expose the archived
  version already selected by a draft game.
- exports include the ruleset payload and historical setup reference;
  statistics and reports carry the ruleset version in their lineage.

The current row combines family identity, version identity, ownership, and
activation. It lacks stable family identity, non-Account owner principals,
review/approval state, effective intervals, content digests, supported-feature
declarations, compatibility metadata, and activation history. Those are future
implementation requirements, not reasons to weaken the existing binding.

## Conceptual model

### Ruleset identity

`Ruleset` is the stable owner-controlled family. It has:

| Field        | Contract                                                                            |
| ------------ | ----------------------------------------------------------------------------------- |
| `rulesetId`  | Immutable opaque UUID. This is the family foreign key.                              |
| `ownerKind`  | `PLATFORM`, `ACCOUNT`, `ORGANIZATION`, or `LEAGUE`.                                 |
| `ownerId`    | Null only for `PLATFORM`; otherwise an opaque id in the matching authority domain.  |
| `slug`       | Owner-scoped stable lookup label; unique within the owner, never authorization.     |
| `name`       | Human-readable current family name; changes are audited and do not change identity. |
| `visibility` | `PUBLIC`, `OWNER_ONLY`, or explicit `SHARED`; visibility never grants activation.   |
| `createdAt`  | Application-owned accepted timestamp.                                               |
| `createdBy`  | Stable actor or deployment-service identity.                                        |

Organization and League are reserved authority kinds. Until #107 defines those
principals, only Platform and Account ownership may be implemented. A string,
Discord role, provider claim, or current roster relationship cannot stand in
for an owner principal.

### Ruleset version

`RulesetVersion` is one sealed semantic definition:

| Field                        | Contract                                                                                  |
| ---------------------------- | ----------------------------------------------------------------------------------------- |
| `rulesetVersionId`           | Immutable opaque UUID used by games and consumers.                                        |
| `rulesetId`                  | Stable family identity.                                                                   |
| `version`                    | Monotonically increasing positive integer, unique per family.                             |
| `versionLabel`               | Optional display label; never used for identity or ordering.                              |
| `lifecycle`                  | Current projection of the audited lifecycle events.                                       |
| `contractVersion`            | Version of this outer ruleset envelope.                                                   |
| `configurationSchemaVersion` | Schema for the semantic configuration payload.                                            |
| `configuration`              | Strict, canonicalizable rule values and extension categories.                             |
| `supportedFeatures`          | Exact feature identifiers this version may require or enable.                             |
| `compatibility`              | Supported reducer, event-schema, statistics-rule, import, analytics, and consumer ranges. |
| `contentDigest`              | SHA-256 of the canonical semantic envelope and sealed dependency closure.                 |
| `supersedesVersionId`        | Optional prior version in the same family.                                                |
| `changeSummary`              | Required bounded explanation of behavioral and compatibility changes.                     |
| `reviewedAt` / `reviewedBy`  | Review evidence; absent only in `DRAFT`.                                                  |
| `publishedAt`                | First transition to `ACTIVE`; immutable once set.                                         |

The semantic envelope covered by `contentDigest` includes `rulesetId`, version,
contract/schema versions, configuration, supported features, compatibility,
and immutable referenced-module identifiers. It excludes lifecycle projections
and display-only metadata. Canonicalization must be documented, deterministic,
and locale-independent.

Names are not version identity. Renaming a family does not change an existing
version or a historical display snapshot. A behavioral change always creates a
new version even if a consumer believes it is backward-compatible.

### Activation assignment

Activation is not a property that changes rule content. `RulesetActivation`
assigns one `ACTIVE` version to one authorized selection scope:

```text
RulesetActivation {
  activationId
  rulesetVersionId
  ownerKind / ownerId
  scopeKind / scopeId
  effectiveFrom
  effectiveTo
  approvedBy
  activatedBy
  reason
  createdAt
}
```

Effective intervals are UTC instants with half-open semantics
`[effectiveFrom, effectiveTo)`. Intervals for the same owner, ruleset family,
and selection scope cannot overlap. A more specific scope must be explicitly
selected; there is no undocumented precedence chain.

Game setup either supplies one authorized `activationId` or resolves exactly
one Account default candidate. Zero candidates return
`RULESET_SELECTION_REQUIRED`; multiple candidates return
`AMBIGUOUS_RULESET_SELECTION`. The accepted setup records the selected version
and activation evidence. League, organization, team-season, or tournament
assignments never silently outrank an Account assignment.

## Creation, ownership, and permissions

### Owner types

| Owner        | Permitted use                                           | Authority                                                                |
| ------------ | ------------------------------------------------------- | ------------------------------------------------------------------------ |
| Platform     | Reviewed default packs available to authorized Accounts | Restricted deployment/release identity and designated platform reviewers |
| Account      | Private variations for one Account                      | Current Account membership plus exact ruleset capability                 |
| Organization | Future shared pack for organization-authorized Accounts | Deferred to #107; no authority inferred today                            |
| League       | Future league-governed pack and activation scope        | Deferred to #107; league role must be freshly resolved                   |

Ownership never transfers by changing `ownerId`. A transfer requires a new
ruleset identity or a future audited transfer ADR that preserves every version,
activation, game binding, visibility decision, and owner history.

### Capability model

Implementation must decompose the current Account-scoped `ruleset.manage`
authority into these explicit actions, or prove an equivalent policy:

- `ruleset.view`: see identity and versions allowed by visibility and owner;
- `ruleset.create`: create a family and first draft for the exact owner;
- `ruleset.edit_draft`: edit only an unsealed draft;
- `ruleset.review`: approve or reject a sealed candidate;
- `ruleset.activate`: create or end an activation assignment;
- `ruleset.deprecate`: deprecate or retire without deleting history.

Every server operation re-resolves current membership and scope. Browser state,
session claims, external-provider roles, and possession of an opaque id are not
authority. Account authority never reaches another Account. Organization and
League authority must be additive and exact; it cannot broaden private team or
player access.

### Approval and audit

Review seals the semantic envelope and its digest. For Platform,
Organization, and League owners, the reviewer must be a different actor from
the author. Account-owned rulesets use the same separation when a second
eligible owner exists. A sole-owner Account may self-approve only with fresh
step-up authorization, an explicit reason, and a distinct self-approval audit
result.

Required append-only evidence includes actor, owner and scope, action, prior
and resulting lifecycle, version id, content digest, effective interval,
reason, authority references, accepted timestamp, result, and safe failure
code. Configuration content, youth-player data, private owner names, provider
identifiers, and credentials do not belong in general audit metadata.

Audit failure fails the privileged operation. Approval and activation are
idempotent by bounded client submission id and payload digest; conflicting
replays fail rather than applying last-write-wins.

## Version lifecycle

The only supported progression is:

```text
DRAFT -> REVIEWED -> ACTIVE -> DEPRECATED -> RETIRED
```

- **DRAFT:** cannot be selected by games or downstream derivations. Content may
  change only before review submission. Draft edits are revision-checked.
- **REVIEWED:** content is sealed and immutable. Rejection does not unseal it;
  changes create the next draft version.
- **ACTIVE:** may receive new activation assignments and new game bindings
  within an effective scope.
- **DEPRECATED:** existing bindings and derivations continue. New activation
  assignments and implicit selection are blocked. A privileged operator may
  explicitly select it for a future game only when a documented compatibility
  need and warning are recorded.
- **RETIRED:** never available for new game bindings or activations. It remains
  readable to authorized historical consumers forever while referenced.

No transition returns to an earlier state. A mistaken published version is
deprecated or retired, and a corrected version is created. Lifecycle state is
derived from append-only transition records so its history cannot be erased.
Deprecation atomically ends open-ended activation intervals at the accepted
transition time; already bound games remain unchanged. Retirement requires no
remaining future activation interval.

## Activation and effective dates

Activation makes a version eligible; it does not mutate games.

1. Resolve the owner and exact selection scope under fresh authorization.
2. Validate lifecycle, compatibility, content digest, feature support, and
   non-overlapping effective interval.
3. Write approval/audit and activation atomically.
4. Use `scheduledAt` when selecting a version for a new setup, but persist the
   resolved `rulesetVersionId` in the accepted setup snapshot.
5. Never look up activation again for replay.

Future games may inherit an active version only during initial resolution. A
draft game that already has a setup snapshot keeps its version. A reschedule or
ruleset change before scoring requires an explicit new setup revision and
fresh validation; it is never automatic. Once scoring starts, rescheduling,
activation, deprecation, or retirement cannot change the binding.

## Game binding and historical immutability

One game has one effective ruleset version. Setup revisions before scoring may
refer to different versions, but the setup marked ready and used by the first
accepted event becomes the permanent game binding. Every accepted event must
match it. Mixed-version event histories are invalid.

The recorded version governs:

- setup and lineup validation;
- event acceptance and state transitions;
- correction validation and effective replay;
- baseball statistic derivation assumptions;
- reports and exports;
- import verification;
- analytics lineage; and
- the canonical baseball input to fantasy derivation.

Corrections change recorded baseball facts through the append-only correction
model. They do not change the rules used to interpret those facts. If an
accepted game was bound to the wrong ruleset, ordinary correction and ruleset
management must refuse the change. Any future semantic rebinding needs a
separate ADR, retained original binding, explicit revised lineage, complete
replay comparison, user-visible explanation, and audit. There is no generic
"migrate historical games to latest" operation.

Referenced versions cannot be hard-deleted or redacted into an unusable form.
Retirement removes future eligibility only. Backup, restore, export, and
privacy workflows must preserve rule semantics even when owners, teams,
players, or display labels are archived or pseudonymized.

## Supported rule-category extension points

Configuration is a strict, versioned object. A category is usable only when the
version declares its feature identifier and the consuming engine proves
support. The initial taxonomy is:

| Category              | Contract extension points                                                                                                              |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Inning rules          | Scheduled innings, legal completion point, home-team last-half handling, suspended/resumed completion                                  |
| Roster rules          | Game roster limits, eligibility source, active/inactive constraints, continuous-batting eligibility                                    |
| Lineup rules          | Batting-order size, continuous batting, defensive-only players, DH/pitcher and extra-hitter roles                                      |
| Substitution rules    | Entry, removal, re-entry, position changes, pitching replacement, courtesy-runner eligibility and reuse                                |
| Extra innings         | Tie continuation, placed-runner source/base, first applicable inning, maximum innings, terminal tie                                    |
| Mercy rules           | Run differential, earliest inning/half, home-team handling, mandatory or optional termination                                          |
| Scoring rules         | Event-vocabulary interpretation and statistic-rule compatibility; no fantasy point values                                              |
| Fantasy compatibility | Eligible canonical events/statistics and required derivation versions; point/category weights live in a separate fantasy scoring model |
| Tournament rules      | Game-completion, tie, pool/advancement compatibility, and schedule context; bracket implementation remains separate                    |

Every field defines type, range, default semantics within its own schema,
consumer capability, and whether it affects setup, event acceptance, replay,
statistics, or presentation. Absence means "not configured" only when the
schema explicitly defines that behavior. An engine encountering an unknown
category, value, or required feature returns `UNSUPPORTED_RULESET` before
accepting a setup or event.

No ruleset may claim official governing-body compliance without a documented
review of the exact version and source. Names such as "school" or "youth" are
descriptive, not compliance assertions.

## Compatibility contract

Compatibility is declared, never guessed. It includes:

- supported ruleset envelope and configuration-schema versions;
- minimum/maximum reducer versions;
- supported event-schema versions and event vocabulary;
- compatible statistic-rules and derivation versions;
- required feature identifiers;
- import/export format compatibility;
- analytics feature/derivation requirements;
- fantasy source-statistic compatibility; and
- an optional replacement version plus migration notes.

Consumers validate the content digest and every required compatibility range
before use. A newer version number is not automatically compatible. A version
with unknown required features is unavailable, not partially applied.

The digest is encoded as `sha256:<lowercase hex>` over UTF-8 canonical JSON:
object keys sort recursively by Unicode code point, arrays retain declared
order, timestamps use RFC 3339 UTC, numbers must be finite JSON numbers, and
absent optional fields are omitted rather than rewritten as null. The contract
version owns any future canonicalization change; two encodings cannot claim the
same digest algorithm version.

Reusable modules are not currently supported. If introduced, a version must
pin each module version, forbid mutable ranges such as "latest", include the
ordered dependency closure in the content digest, and remain replayable without
network access.

## Downstream boundaries

### Imports and portability

An import profile records source-system identity, source ruleset identity,
source version, content or source digest when available, provenance, mapping
decision, reviewer, and confidence. Exported games include the complete
referenced ruleset semantic envelope or a resolvable immutable package.

Import validation must choose exactly one outcome:

1. exact digest match to an authorized existing version;
2. explicitly reviewed semantic mapping with retained source identity and
   mapping evidence; or
3. quarantine/reject as unsupported.

There is no name-only match, "closest" pack, current-default fallback, or
silent coercion. A committed import preserves the source ruleset provenance
and the immutable version used for replay. Import promotion remains owned by
#101; this contract does not implement it.

### Analytics

Every insight records the game's `rulesetVersionId`, source revision,
statistic derivation/rules version, analytics feature version, and privacy
overlay revision. Aggregations across rulesets are allowed only when the
feature declares and tests a compatibility grouping; otherwise results remain
partitioned or unavailable. A new activation never refreshes old insights
under new rules. Corrections rebuild with the original game ruleset.

### Fantasy

Fantasy scoring uses two independent references:

```text
baseballRulesetVersionId + fantasyScoringModelVersionId
```

The baseball version determines canonical game/event/statistic meaning. The
fantasy model determines eligible periods, categories or points, lineup limits,
and tie behavior. A fantasy model declares compatible baseball features and
statistic derivation versions. It cannot alter events, official statistics, or
the game's ruleset binding. Historical fantasy results retain both references
and a source revision so later rule changes do not rewrite standings silently.

Issues #122–#127 own fantasy product and implementation decisions. This
contract supplies only their version boundary.

### Delegation and league administration

A delegated actor can view, review, or activate only when fresh authority grants
the exact action for the exact owner and scope. Organization or League
membership does not grant Account-private team/player access, and Account
membership does not grant organization-wide ruleset activation. Cross-team
activation requires an explicit minimum authority policy and audit under #107.

Revocation takes effect before the next privileged operation. Previously
authorized activations remain historical evidence but do not preserve the
actor's access. Offboarding never deletes versions used by games.

## Privacy and security

Ruleset semantic values should not contain personal data, credentials, private
notes, provider identifiers, or player names. Owner names and unpublished
competition policies can still be private metadata.

- Platform-public versions expose only reviewed semantic content and safe
  attribution.
- Owner-only versions require owner-scoped `ruleset.view` before identity,
  name, version, digest, configuration, or existence is disclosed.
- Shared visibility uses explicit grants and never implies activation rights.
- Cache keys, jobs, exports, imports, and logs include owner scope internally
  and avoid leaking private names or configurations.
- Cross-owner lookups return the same non-enumerating result as missing ids.
- Audit and operational events use safe ids, digests, categories, action,
  result, and reason codes rather than full private configurations.

Ruleset activation is a privileged, auditable operation. Hidden scoring
changes are prevented by sealed digests, review evidence, explicit activation
intervals, immutable game binding, and user-visible version lineage in
administrative and historical outputs.

## Migration and rollback policy

No migration is required for this design issue. Future implementation uses a
new forward migration; applied migrations are never edited.

The required expand-and-contract sequence is:

1. Add stable ruleset identity, owner principal, semantic digest,
   compatibility, lifecycle-event, and activation structures without removing
   current columns or references.
2. Preflight every current row for valid strict configuration, unique version
   ordering, Account ownership, and complete game/event references.
3. Preserve every existing `RulesetVersion.id` as its version identity. Create
   a stable family only when grouping is unambiguous; ambiguous names or
   configurations block the migration for manual resolution.
4. Backfill digests from canonical existing content. Do not add semantic
   defaults to make an invalid row pass.
5. Dual-read and compare family/version resolution, game replay, statistics,
   exports, and authorization. Before/after replay state hashes must match.
6. Add constraints and immutable triggers only after validation, then switch
   writes to the new contract.
7. Remove compatibility columns in a later migration after a full release and
   restore window.

Schema-only rollback uses the prior application during the dual-read window.
After cutover, repair rolls forward. A rollback may disable new activation or
selection, but it cannot delete versions, activation evidence, or historical
bindings. Any data migration must be restartable, batched, idempotent,
observable, and backed up before execution.

A configuration-schema compatibility layer may parse old sealed payloads into
an equivalent in-memory representation only when replay proves identical. It
does not rewrite the stored payload or digest.

## Contract fixtures and future tests

These deterministic fixtures are required when the contract is implemented.
They use synthetic Accounts, organizations, leagues, players, and games.

| Fixture                             | Expected proof                                                                                                                                 |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `historical-v1-after-v2-activation` | A seven-inning v1 game replays to the same state hash after an eight-inning/mercy v2 becomes active.                                           |
| `future-game-resolves-v2`           | A new unbound setup in v2's interval records v2 exactly once; replay never resolves activation again.                                          |
| `prestart-explicit-rebind`          | A draft setup may create a new revision with v2; the prior snapshot remains and scoring seals the chosen revision.                             |
| `mixed-event-version-rejected`      | An event whose version differs from the ready setup fails before persistence.                                                                  |
| `retired-version-replayable`        | Retirement blocks new bindings but an existing game, correction, report, and export still resolve the version.                                 |
| `concurrent-activation`             | Overlapping assignments for the same owner/family/scope cannot both commit.                                                                    |
| `unauthorized-league-activation`    | A delegated actor without exact activation authority receives a non-enumerating denial and no audit-success record.                            |
| `ambiguous-import-ruleset`          | Name-only or unsupported source mapping is quarantined; no game or ruleset is committed.                                                       |
| `analytics-version-lineage`         | An insight records ruleset and derivation versions; correction rebuild retains the game ruleset.                                               |
| `fantasy-boundary`                  | Changing fantasy model weights changes only a new fantasy model/result version and leaves canonical replay/statistics unchanged.               |
| `unknown-feature-rejected`          | A consumer lacking a required ruleset feature refuses setup/replay instead of ignoring it.                                                     |
| `migration-replay-equivalence`      | Every migrated historical fixture has identical effective events, state hashes, statistics, and ruleset version id before and after migration. |

Test layers must cover:

- pure schema parsing, canonicalization, digest, compatibility, and lifecycle;
- authorization for every owner kind and action, including stale membership;
- persistence immutability, interval exclusion, tenant foreign keys, and
  concurrent activation;
- game setup/event binding and correction/replay;
- import quarantine and provenance;
- analytics lineage and incompatible aggregation;
- the fantasy version boundary without implementing fantasy behavior; and
- migration deployment, representability, replay comparison, backup/restore,
  and rollback/roll-forward behavior.

No downstream feature test is implemented by #106. The fixture table is the
acceptance contract those implementations must consume.

## Adversarial review findings

The design was reviewed from the required perspectives:

- **Baseball rules expert:** made continuous batting, courtesy runners,
  DH/pitcher roles, substitutions, extra innings, mercy, and tournament context
  explicit extension points; prohibited unsupported governing-body claims.
- **Database architect:** separated identity/version/activation, sealed content
  by digest, prohibited overlapping assignments and deletion, and required
  expand-and-contract migration plus replay-equivalent backfill.
- **Historian/statistician:** bound games and derivations to exact versions,
  prohibited latest-version replay, and preserved correction and export
  lineage.
- **Security engineer:** required exact owner scope, fresh capability checks,
  non-enumerating denial, audit atomicity, and private visibility boundaries.
- **League administrator:** defined review, effective dates, deprecation,
  retirement, future-game inheritance, and sole-owner approval behavior without
  granting league authority before #107.

Material ambiguities resolved by the review are: lifecycle metadata is separate
from semantic content; activation is separate from a version; rescheduling
never silently rebinds a game; composed rules must be sealed; imports cannot
match by name; and fantasy weights cannot enter canonical baseball rules.

## Downstream entry gate

Issues #101, #107, #123, #124, #125, #126, and #127 may build on this contract
only when they:

- reference opaque ruleset and version identities, not names or latest state;
- preserve owner and Account isolation;
- record exact source and derivation versions;
- fail unsupported compatibility explicitly;
- preserve historical bindings and audit evidence; and
- keep baseball scoring truth separate from import, analytics, delegation, and
  fantasy-specific state.
