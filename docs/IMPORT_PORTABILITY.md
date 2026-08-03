# Import portability and portable baseball data contract

Issue [#101](https://github.com/cryptnetworks/baseballstattrack/issues/101)
defines how authorized baseball history moves between systems without changing
its ownership, provenance, ruleset lineage, corrections, verification state, or
historical meaning. It builds on the [Ruleset contract](RULESET_CONTRACT.md)
from #106 and the existing versioned Account export and mutation-free import
dry run. [ADR 0011](decisions/0011-import-portability-quarantine-and-atomic-promotion.md)
records the architectural decision.

This document is the contract for import packages, identity resolution,
quarantine, review, atomic promotion, and reconciliation. It does not implement
fantasy, delegation, UI, offline mode, or a production import commit endpoint.

## Non-negotiable invariants

1. An import never overwrites or silently merges accepted baseball history.
2. A game retains its exact ruleset version, setup revisions, source events,
   corrections, verification state, and source provenance.
3. Names, current rosters, current rulesets, and "latest" versions are never
   identity or compatibility evidence.
4. Ambiguous identity, ruleset, schema, ownership, or history is quarantined or
   rejected before canonical writes.
5. Validation and review do not mutate canonical Account data.
6. Commit is authorized for one exact target Account and one sealed validation
   plan; a partial canonical commit is impossible.
7. An exact retry is idempotent. Reusing an import/package identity with
   different bytes is a conflict.
8. Derived statistics and reports can validate an import but cannot replace
   canonical setup/event/correction history.
9. Privacy overlays and deletion state are applied before export and again at
   target presentation boundaries.
10. Secrets, credentials, authentication records, and unnecessary personal data
    are never portable baseball entities.

## Existing foundation and delivery boundary

The current `baseballstattrack.account-export` format already supplies:

- versioned, canonical UTF-8 JSON with deterministic ordering;
- a bounded manifest, entity counts, and SHA-256 accidental-corruption check;
- Account-neutral logical identifiers with no source database Account id;
- teams, seasons, team-seasons, privacy-resolved players, rosters, ruleset
  versions, games, accepted setup, source events, corrections, and replayed
  summaries;
- strict schema, byte, record, ownership-field, duplicate-id, reference,
  effective-roster, event-evidence, replay, and summary validation;
- exact target logical-id conflict detection;
- separate `report.export` and exact-Account `account.manage` authorization;
- safe audit evidence for export and validation; and
- `DRY_RUN_ONLY` plans with `mutationCount: 0`.

The current format is not a production import-promotion protocol. It does not
yet carry the complete producer/source provenance profile, stable #106 ruleset
family and content digest, reviewed identity mappings, quarantine records, or a
sealed commit plan. Existing format versions remain readable for compatibility
validation, but they are legacy packages and cannot become commit-eligible
until the missing provenance and ruleset resolution are supplied through
review.

## Import package identity

Every package has one immutable identity envelope:

```text
ImportPackageManifest {
  packageId
  format / formatVersion
  producer { id, name, version }
  generatedAt
  sourceSystem { id, name, exportId, exportVersion }
  sourceScope { logicalAccountId }

  schemaCompatibility {
    portableDataVersions[]
    rulesetContractVersions[]
    eventSchemaVersions[]
    statisticDerivationVersions[]
  }

  rulesets[] {
    familyId
    versionId
    version
    contentDigest
    contractVersion
    configurationSchemaVersion
  }

  derivations[] {
    kind
    derivationVersion
    statisticRulesVersion
    sourceRevision
  }

  provenance {
    exportReason
    createdByKind
    sourceAuthority { claimKind, sourceRole, assertedScope, evidenceRef }
    priorPackageId
    acquisitionMethod
    chain[]
  }

  entityCounts
  payloadDigest
  manifestDigest
  digestAlgorithm
}
```

### Identity rules

- `packageId` is a producer-issued opaque UUID or an equally collision-resistant
  identifier namespaced by producer. It cannot be reused for different bytes.
- `format` and positive `formatVersion` select the strict outer schema.
- `producer.id` is a stable registered producer identity. Name and version are
  display/build evidence, not authority.
- `generatedAt` is the producer's RFC 3339 UTC timestamp. It does not establish
  event occurrence, ownership, or target precedence.
- `sourceSystem.id` and `exportId` identify the source issuance. They never
  expose credentials, database URLs, tenant primary keys, or authentication
  subjects.
- `sourceScope.logicalAccountId` is a portable namespace, not a target Account
  selector. The target Account comes only from the authorized import request.
- ruleset declarations use the stable family/version identities and canonical
  content digest defined by #106. Every game/setup reference must resolve to a
  declared version.
- derivation declarations are required for included statistics/reports and are
  omitted only when no derived artifact exists.
- `payloadDigest` covers canonical entity payload bytes. `manifestDigest`
  covers the canonical manifest excluding `manifestDigest` itself.
- `digestAlgorithm` is versioned and initially
  `sha256-canonical-json-v1`. Checksums detect corruption and identity; they do
  not authenticate an untrusted producer. Authenticity requires a separately
  reviewed signature/trust policy.

Canonical JSON uses the #106 rules: UTF-8, recursively sorted object keys,
declared array order, finite JSON numbers, RFC 3339 UTC timestamps, and omitted
absent optionals. Any canonicalization change requires a new digest algorithm
identifier and format compatibility review.

## Provenance model

Provenance is append-only lineage, not a free-form note. Each chain entry has:

- source system and producer identity;
- source entity kind and stable source identifier;
- source revision/version and observed timestamp;
- transformation kind and tool/contract version;
- parent digest(s) and resulting digest;
- ruleset version when baseball meaning is involved;
- reviewer and mapping reference when human judgment occurred; and
- confidence: `EXACT`, `REVIEWED_EQUIVALENT`, `PARTIAL`, or `UNKNOWN`.

`sourceAuthority` preserves the source system's claim about who accepted or
published the data, the asserted scope, and a non-secret evidence reference. It
is historical provenance only: it neither grants target authority nor bypasses
current exact-Account authorization.

Provenance never grants authority and never substitutes for payload
validation. Unknown or partial lineage is visible in the validation report and
may require quarantine. A transformation cannot claim `EXACT` if it inferred an
identity, dropped an event, changed a rule interpretation, or rebuilt a result
without its original derivation version.

The target stores the accepted package id/digests, import id, source ids,
ruleset resolutions, identity mappings, review evidence, and canonical entity
references needed for reconciliation. It does not copy upstream secrets,
internal database ids, raw authentication subjects, or unnecessary operator
personal data.

## External provider boundary

Provider imports use the approved staging boundary from
[External baseball data ingestion](EXTERNAL_DATA_INGESTION.md). Each provider
record preserves its stable provider identity, record identity, source version,
retrieval time, effective time when supplied, payload digest, provenance,
confidence, and correction/supersession state. The package also references the
approved source capability and non-secret license/terms evidence needed to
interpret permitted use and retention.

Retrieval, normalization, or successful staging does not make provider data
canonical truth. Provider records remain restricted evidence until exact
Account authority, identity resolution, ruleset disposition, dependency
completeness, replay/reconciliation, correction lineage, privacy, and review
all succeed. A provider correction appends a new version and declared lineage;
it cannot update or delete accepted manual or imported events. Unsupported,
ambiguous, incomplete, or conflicting provider evidence quarantines with safe
diagnostics and never publishes automatically.

## Ruleset handling

Each source ruleset version receives exactly one disposition before a game can
be commit-eligible.

### 1. Exact digest match

The authorized target can resolve the same stable version or an installed
version with the same sealed #106 semantic envelope and `contentDigest`.
Family, version, contract/schema compatibility, required features, and digest
must all validate. Name equality is irrelevant.

### 2. Explicit reviewed mapping

A reviewer with exact target Account ruleset/import authority may map a source
version to a target version only when a documented comparison proves semantic
equivalence for every feature used by the package. The mapping records source
and target ids/digests, covered features, comparison tool/version, fixtures,
reviewer, accepted timestamp, reason, and limitations.

A reviewed mapping cannot hide a behavioral difference. When the source
semantics are valid but no equivalent target version exists, the safe outcome
is to review and install the immutable source version under the #106 ownership
contract—not map it to a convenient current version.

### 3. Quarantine

Missing versions, digest mismatch, unsupported features, incompatible contract
or event schemas, ambiguous mapping, and incomplete semantic payloads
quarantine every dependent game. Quarantine stores restricted package/evidence
references but creates no canonical team, player, game, event, statistic, or
report.

Imports never match by name, choose the latest rules, silently convert rule
values, ignore unknown features, or rewrite historical games under a target
default. A ruleset resolution is immutable once a game is committed.

## Entity portability matrix

Every source identifier is namespaced by producer/source system. A target
mapping is explicit and Account-scoped.

| Entity         | Identity strategy                                                                | Ownership and conflict policy                                                                                                | Required provenance                                                                            |
| -------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Account        | Source logical scope only; never reuse a database Account id                     | Operator selects one exact authorized target Account; package cannot create, select, or broaden Account authority            | Producer/source scope and export issuance                                                      |
| Team           | Stable source team id; exact prior mapping or reviewed new target identity       | No name-only merge; conflicting target mapping quarantines the team and dependents                                           | Source id/revision, mapping, display-field privacy state                                       |
| Player         | Stable source player id; exact provider mapping or manual reviewed mapping       | Never fuzzy/name-only match; ambiguous identity quarantines player, rosters, lineups, games, and derivatives                 | Source id/revision, mapping basis, confidence, privacy state                                   |
| Season         | Stable source season id and explicit boundary metadata                           | Names/dates are insufficient for merge; overlap or target conflict requires review                                           | Source id/version, dates, mapping                                                              |
| Roster         | Stable source roster-period id plus player/team-season references                | Preserve effective periods; overlap or eligibility ambiguity quarantines the roster and dependent setup                      | Source revision, effective interval, source references                                         |
| Game           | Stable source game id plus source revision and payload digest                    | Exact prior import can be idempotent; different history at same identity conflicts. Never merge into accepted manual history | Source game revision, ruleset version, setup/event digests, verification state                 |
| Setup revision | Stable setup id and monotonic revision within the game                           | Preserve every accepted revision needed for lineage; ready/bound setup must reference exactly one resolved ruleset           | Source revision, acceptance time, ruleset resolution, participants                             |
| Event          | Stable event id, game sequence, event schema, accepted revision, evidence hashes | Preserve order and immutable payload; duplicate exact event is idempotent, divergent duplicate quarantines the game          | Source event/version, occurrence/acceptance time, actor kind, parent/setup/ruleset references  |
| Correction     | Stable correction event id and exact target/replacement graph                    | Preserve original events and append-only correction lineage; missing/cyclic/cross-game targets reject or quarantine          | Reason category, source correction revision, target/replacement ids, verification invalidation |
| Statistics     | Derived identity includes game/source/ruleset/statistic derivation versions      | Never authoritative import truth; replay and compare, then rebuild or label unavailable on mismatch                          | Source revisions, ruleset/statistic versions, generated time, confidence                       |
| Reports        | Derived artifact id plus source and presentation versions                        | Validate against canonical replay; may be regenerated. A report cannot overwrite game history                                | Source entities/revisions, ruleset/derivation/privacy versions, generation tool                |

### Per-entity audit behavior

Audit evidence is append-only, Account-scoped, and minimized. It identifies the
package/import, actor or service identity, current capability, target Account,
action, entity kind, opaque source and target references, mapping/ruleset
resolution, outcome, accepted timestamp, and safe reason code. It never copies
player names, raw event payloads, private notes, credentials, or package bytes.

| Entity         | Required audit behavior                                                                                                                                                             |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account        | Record the authenticated actor, exact target Account, capability, package/source scope, and non-enumerating authorization outcome; never audit an uploaded Account id as authority. |
| Team           | Record exact/create/review/quarantine disposition and mapping evidence digest; omit display labels.                                                                                 |
| Player         | Record exact/review/quarantine disposition, mapping basis, confidence, and privacy decision using opaque ids only.                                                                  |
| Season         | Record boundary/mapping disposition and any overlap or target-conflict finding.                                                                                                     |
| Roster         | Record effective-period resolution, dependency findings, and dependent setup quarantine count.                                                                                      |
| Game           | Record source revision/digest, target disposition, ruleset resolution, replay result, verification state, and manual-history conflict outcome.                                      |
| Setup revision | Record source revision, accepted ruleset resolution, participant dependency result, and sealed target reference.                                                                    |
| Event          | Record sequence/schema/evidence verification and duplicate/conflict disposition without copying payload content.                                                                    |
| Correction     | Record graph verification, target/replacement resolution, provenance digest, and verification invalidation/re-verification state.                                                   |
| Statistics     | Record derivation versions, replay comparison outcome, confidence, and rebuild/unavailable disposition; never audit full stat lines.                                                |
| Reports        | Record source/derivation/privacy versions, digest comparison, and regenerate/restrict/quarantine disposition.                                                                       |

Team-season participation is an explicit relationship between the mapped team
and season. It is never inferred from roster names or game labels. Lineup
snapshots preserve historical player/team identity independently from current
rosters and privacy-resolved display fields.

## Identity resolution

Allowed resolutions are:

- `EXACT`: same namespaced stable source identity and same canonical digest;
- `APPROVED_MAPPING`: explicit source-to-target mapping accepted by an
  authorized reviewer with evidence;
- `CREATE_NEW`: no conflicting target identity and policy permits a new
  Account-owned entity; and
- `MANUAL_REVIEW`: no canonical mutation until an authorized decision exists.

Rejected behavior includes fuzzy automatic merge, normalized-name matching,
name-only player or team matching, email/provider-subject matching, roster-based
identity inference, silent team merging, and last-write-wins.

One source entity maps to at most one target entity within an import. Multiple
source identities cannot map to one target identity unless a dedicated merge
policy proves they are duplicates, preserves both provenance chains, and is
approved before commit. #101 defines no such automatic merge policy, so the
default outcome is quarantine.

Every identity finding is stable and machine-readable:

```text
ImportFinding {
  code
  severity: INFO | WARNING | BLOCKING
  entityKind
  sourceId
  field
  safeSummary
  allowedResolutions[]
  dependencyCount
}
```

Reports never include unnecessary player data, raw event payloads, credentials,
private source identifiers, or information from another Account merely to
explain a conflict.

## Import lifecycle

The success path is:

```text
RECEIVED
  ↓
VALIDATED
  ↓
REVIEWED
  ↓
COMMITTED
  ↓
RECONCILED
  ↓
AVAILABLE
```

- **RECEIVED:** bounded bytes and manifest identity accepted into restricted
  staging; no canonical entities exist.
- **VALIDATED:** schema, digest, references, rulesets, replay, privacy, and
  target conflicts checked; validation plan is immutable by package digest.
- **REVIEWED:** all blocking findings have explicit authorized resolutions;
  reviewer authority and source/target snapshots are fresh.
- **COMMITTED:** one atomic canonical promotion succeeded with audit evidence.
- **RECONCILED:** target replay, corrections, statistics, counts, and lineage
  match the sealed plan and source claims.
- **AVAILABLE:** authorized product/report reads may expose the imported data
  under target privacy and verification policy.

Failure/holding states are:

- **PARTIALLY_VALIDATED:** bounded validation stopped or dependencies remain;
  cannot be reviewed or committed;
- **QUARANTINED:** package or dependent entity graph requires resolution and is
  invisible to canonical reads;
- **INVALID:** the exact bytes fail encoding, manifest, schema, digest,
  reference, correction, replay, or privacy validation; corrected bytes require
  a new package identity/digest;
- **UNSUPPORTED:** the package is well-formed but declares an unavailable
  format, schema, ruleset feature, derivation, or required capability; it cannot
  silently downgrade and may be revalidated only after explicit support is
  installed;
- **REJECTED:** terminal malicious, unauthorized, prohibited-data, or policy
  outcome; no retry without a new authorized request and, when content changes,
  a new package identity/digest; and
- **FAILED:** safe operational failure before commit; exact retry may resume
  from verified staging checkpoints.

No failure state becomes `AVAILABLE`. Quarantine is not a hidden partial import.
Retention, access, and deletion of staged bytes follow the privacy policy and
must be shorter than canonical baseball retention unless legal/security
evidence requires a restricted hold.

## Validation and review report

Validation is deterministic for the same package bytes, target Account state
revision, ruleset catalog revision, mapping set, and validator version. The
report contains:

- package/manifest digests and supported format/schema versions;
- producer/source/provenance confidence;
- exact target Account selector as a safe opaque reference;
- records found by entity kind and the dependency graph;
- ruleset dispositions;
- identity resolutions and unresolved findings;
- conflicts and missing dependencies with stable safe finding codes;
- event/correction/replay/statistic/report comparison results;
- privacy issues, filtering, and prohibited-field results;
- target conflict and duplicate-import results;
- expected changes by `CREATE`, `MAP`, `IDEMPOTENT_SKIP`, `QUARANTINE`, and
  `REJECT` disposition, all with `mutationCount: 0` during dry run;
- commit eligibility, required approvals, and plan expiry; and
- validator/replay/derivation versions.

The report records safe counts and opaque correlations. It is not a copy of the
package or a support channel for youth-player details.

## Atomicity, retries, and recovery

### Dry run

Dry run performs every validation possible without canonical mutation. The
existing endpoint remains `DRY_RUN_ONLY`; it cannot be upgraded to commit by a
client flag. A future commit consumes a server-stored sealed validation plan,
not client-resubmitted findings or mappings.

The validation engine does not write the database, and the dry-run operation
does not mutate teams, players, seasons, rosters, games, setup revisions,
events, corrections, statistics, reports, or projection checkpoints. The only
permitted operation-level side effect is the existing minimized security audit
record written outside canonical baseball history; if that audit cannot be
written, validation fails closed. Expected changes describe a hypothetical
sealed plan and never reserve identifiers, create mappings, or imply commit.

### Commit boundary

Commit requires fresh exact-Account authorization, unexpired package/target
state, unchanged ruleset and mapping digests, all blocking findings resolved,
and a new explicit confirmation. Small imports promote in one database
transaction. Large imports may load chunks only into an isolated staging
namespace; canonical promotion is still one atomic set-based transaction.

The transaction writes imported entities, provenance links, identity mappings,
import lifecycle/audit evidence, and idempotency result together. Required audit
failure rolls back the transaction. Canonical tables never contain a
partially imported dependency graph.

### Retry and duplicate behavior

Idempotency uses target Account, producer, package id, payload digest, and commit
submission id. An exact retry returns the recorded result. The same package id
with a different digest, the same source entity mapped differently, or a changed
target since review returns a conflict and requires revalidation.

A transient validation/staging failure may resume from a checksum-verified
checkpoint. Validation never assumes an interrupted step succeeded. Commit is
not retried as a new import identity.

### Rollback and post-commit defects

Before commit, staged data can be discarded according to the quarantine
retention policy. A failed transaction leaves no canonical changes.

After commit, destructive rollback of accepted events is prohibited. A material
defect marks the import unavailable, preserves audit/provenance, blocks new
derivations, and uses a reviewed roll-forward repair or the canonical
append-only correction process. If the import has no accepted downstream use
and a future deletion policy permits removal, deletion still requires explicit
Account/privacy authorization and retained non-sensitive audit evidence.

## Correction and verification behavior

Imported corrections preserve:

- original immutable source events;
- correction event identity and sequence;
- exact targets, replacements, reversals, and parent relationships;
- correction reason category and source provenance;
- source revision before/after correction;
- evidence hashes required for deterministic replay; and
- verification invalidation and subsequent re-verification state.

Validation rejects missing, cyclic, cross-Account, cross-game, cross-ruleset, or
ambiguous correction references. Replay derives effective history from the full
graph and compares the supplied summary/statistics. A corrected game remains
visibly corrected even after successful reconciliation.

Imported data cannot overwrite an existing accepted manual game/event because
its names, time, opponents, or score appear similar. An exact prior imported
package may be idempotent. Any divergent same-source revision, manual/imported
collision, or proposed consolidation quarantines the entire game graph pending
a separately accepted merge policy. Manual history is never silently declared
less authoritative.

## Authorization boundary

Every receive, validate, review, commit, reconcile, availability, retry,
quarantine-read, and deletion operation authenticates a trusted application
user or explicit service actor and re-resolves current authority for one exact
target Account. A future implementation separates at least
`data.import.validate`, `data.import.review`, and `data.import.commit` (or proves
equivalent least-privilege capabilities). The current dry-run route's
exact-Account `account.manage` check is a compatibility foundation, not
permission for future commit.

The Account in the request is a selector only. A package's logical Account,
source scope, provider claim, mapping, file name, manifest field, opaque id, or
possession of bytes can never select an owner, create membership, grant a
capability, or broaden access. Authorization is checked again before promotion
and availability; revoked authority fails the next boundary.

Required audit attribution records actor/service identity, Account and action
scope, capability, package/import digest, sealed-plan revision, result, accepted
timestamp, and safe reason code. Privileged operations fail closed when their
required audit evidence cannot be committed. Errors do not reveal whether an
entity, mapping, ruleset, package, or quarantine record exists in another
Account.

## Privacy and security

Imports use the target Account as the tenant and require current exact-Account
authority at receive, review, commit, reconciliation, and availability changes.
Package ids and source claims are selectors/evidence, not authorization.

- Export applies current privacy overlays and allowlists before bytes leave the
  source Account.
- Import validates allowed fields before identity matching, logging, staging,
  or review presentation.
- Target presentation applies current target privacy overlays and authorization;
  an imported historical label does not bypass later pseudonymization.
- Youth-player data is limited to baseball identity/display, roster, lineup,
  event, and derived fields needed for the declared portable purpose.
- Medical, education, contact, address, free-form private notes, unrelated
  profile fields, and hidden third-party enrichment are rejected.
- Credentials, passwords, sessions, API/OAuth tokens, database URLs, membership
  records, invitations, authentication subjects, and raw audit records are
  prohibited.
- Private packages, quarantine bytes, findings, mappings, and provenance are
  encrypted and accessible only to the exact import operators/support policy.
- Cross-Account identifiers fail without confirming whether a target record
  exists.

Source deletion/pseudonymization state is part of provenance. A source package
cannot resurrect fields already removed by a privacy overlay. Target deletion
and export rights apply after commit. Quarantined bytes are deleted when their
retention expires unless a documented restricted security/legal hold applies.

## Derived statistics and reports

Statistics and reports are validation evidence and portability conveniences,
not canonical source truth. Each records source game/revision, ruleset version,
statistic rules/derivation version, correction/verification state, privacy
overlay revision, generator version, and digest.

The target replays canonical setup/events/corrections. If the target supports
the declared derivation version, supplied and rebuilt values must match. A
mismatch blocks commit or quarantines the dependent artifact/game according to
policy; it never rewrites events to make a report match. Unsupported derived
versions may be stored only as restricted provenance artifacts while target
derived output remains unavailable or is regenerated under a clearly distinct
target derivation version.

## Schema and migration policy

No database migration is required for this contract. The existing dry run
remains mutation-free.

A future commit implementation requires a forward migration for import package,
lifecycle, finding, ruleset resolution, identity mapping, provenance, sealed
plan, and idempotency evidence. It must:

1. use Account-scoped composite relationships and RLS/service boundaries;
2. keep quarantine/staging separate from canonical baseball tables;
3. enforce immutable package ids/digests and one terminal commit result;
4. prevent overlapping or contradictory source-to-target mappings;
5. retain accepted provenance and correction lineage;
6. validate a clean deployment and production upgrade path;
7. support restartable staging cleanup without canonical deletion; and
8. roll forward after canonical promotion.

Applied migrations are never edited. No schema should be added until the commit
workflow, retention, authorization, capacity, and rollback design receive their
own implementation review.

## Focused test contract

| Scenario                | Required result                                                                                                        |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Valid import            | Strict package validates, exact ruleset/identities resolve, replay and summaries match, and dry run mutates nothing.   |
| Invalid schema          | Unsupported/malformed format or entity fails before identity resolution.                                               |
| Ruleset mismatch        | Missing/different digest or unsupported feature quarantines all dependent games; latest/name fallback is forbidden.    |
| Digest mismatch         | Package/payload/manifest digest mismatch is rejected before staging trust.                                             |
| Ambiguous identity      | Player/team/season ambiguity produces blocking findings and dependent quarantine; no fuzzy merge occurs.               |
| Quarantine              | No canonical entity, statistic, report, or product read exists; safe evidence and dependency counts remain reviewable. |
| Duplicate import        | Exact package retry is idempotent; reused identity with different digest or target mapping conflicts.                  |
| Replay equivalence      | Setup/events under the recorded ruleset reproduce state/evidence hashes and source revision.                           |
| Correction preservation | Original and correction events, graph, corrected state, verification invalidation, and provenance survive round trip.  |
| Privacy filtering       | Prohibited/authentication fields fail; allowed player presentation is privacy-resolved and minimized.                  |
| Account isolation       | Cross-Account request, mapping, reference, cache, finding, audit, and commit fail without enumeration.                 |

Test layers include strict manifest/entity schemas, canonical digest fixtures,
ruleset disposition, identity mapping, dependency quarantine, correction graph,
domain replay/statistics comparison, Account authorization, persistence
atomicity/idempotency, migration/restore, and adversarial privacy fixtures.

### Current executable coverage and deferred validation

- `tests/domain/portable-data.test.ts` covers valid round trip, supported and
  unsupported versions, malformed manifests, checksum failure, duplicate ids,
  prohibited fields, target conflicts, references, correction replay, summary
  equivalence, and privacy-safe output.
- `tests/domain/portable-data-service.test.ts` covers authenticated exact-Account
  capabilities, deterministic duplicate dry runs, safe failure audits, and zero
  canonical mutations.
- `tests/persistence/portable-data-repository.integration.test.ts` covers exact
  Account catalog access, privacy overlays, target-id conflicts, and minimized
  audit persistence when a test database is configured.
- Replay, correction, verification, statistics, privacy, and authorization
  suites remain regression evidence for the source-of-truth boundaries this
  contract consumes.
- `tests/docs/import-portability.test.ts` locks the architectural rules that
  cannot yet execute: #106 digest resolution, reviewed semantic mappings,
  dependency quarantine, provider publication gates, dedicated import
  capabilities, atomic promotion/rollback, and `AVAILABLE` reconciliation.

Production commit, concurrency, rollback, migration/restore, and quarantine
persistence tests are intentionally deferred until their forward schema and
service are implemented. Final M8 validation is not claimed by #101.

## Adversarial review findings

- **Database migration engineer:** separated staging from canonical promotion,
  sealed the review plan, defined exact retry identity, and prohibited partial
  canonical graphs.
- **Baseball historian:** preserved setup revisions, original/correction events,
  ruleset interpretation, verification, and derivation lineage; rejected
  score/name-based consolidation.
- **Privacy engineer:** minimized fields, applied source and target overlays,
  prohibited identity/authentication data, and bounded quarantine retention.
- **Security reviewer:** required fresh exact-Account authority, non-enumerating
  conflicts, safe reports/audits, digest identity, and explicit producer trust.
- **Database engineer:** required tenant-scoped relationships, immutable mapping
  evidence, isolated staging, atomic promotion, idempotency constraints, and
  roll-forward repair.
- **Data platform engineer:** aligned package provenance with the approved #143
  provider staging boundary and prevented retrieval or normalization from
  becoming automatic publication.

Material findings resolved were: a checksum is not producer authentication;
legacy packages are not commit-ready without provenance; reviewed ruleset
mapping must prove equivalence; ambiguous entities quarantine dependents;
derived reports cannot repair events; unsupported and invalid packages need
distinct visible states; dry-run expected changes are hypothetical; uploaded
ownership claims cannot grant access; provider staging is not canonical truth;
per-entity decisions need minimized audits; and post-commit recovery cannot
delete accepted history silently.

## Downstream boundary

Issues #123, #125, and #126 may rely on imported canonical games/statistics only
after the import is `AVAILABLE`, with exact ruleset, source, correction,
verification, and derivation lineage. They cannot treat imported reports as
scoring truth or add fantasy identity/weights to this package contract. The
[Fantasy rules contract](FANTASY_RULES_CONTRACT.md) defines that downstream
statistics-to-points boundary without changing this package format.

#107 and #124–#127 remain separate. Delegated league import authority, fantasy
transactions/scoring, UI, notifications, and offline transfer are not started
or implied by #101.
