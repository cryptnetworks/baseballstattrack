# ADR 0011: Import portability, quarantine, and atomic promotion

## Status

Accepted

## Context

The existing `baseballstattrack.account-export` format provides deterministic
JSON, strict validation, exact Account authorization, event replay, correction
checks, privacy-resolved fields, and a mutation-free dry run. ADR 0010 adds the
stable ruleset family/version identities and content digests needed to preserve
historical interpretation across systems.

Those foundations do not by themselves define when external or exported data
may become canonical. Import packages can contain ambiguous identities,
unsupported rules, partial history, conflicting corrections, derived values,
and source authority claims. Treating any of those as target authority or
silently coercing them would rewrite baseball truth and could cross tenant or
privacy boundaries.

## Decision

Adopt the contract in [Import portability](../IMPORT_PORTABILITY.md).

- A portable package has immutable producer/source identity, compatibility
  declarations, canonical payload and manifest digests, ruleset and derivation
  lineage, and append-only provenance. A checksum proves byte identity and
  corruption detection, not producer authenticity or target authorization.
- Every imported game resolves its ruleset by exact version/content-digest
  match, an explicitly reviewed and evidenced semantic-equivalence mapping, or
  quarantine. Names, closest matches, current defaults, and latest versions are
  never compatibility evidence.
- Portable entity identities resolve only by stable namespaced identifiers,
  approved mappings, reviewed creation, or manual review. Ambiguous entities
  and their dependent graphs quarantine; no fuzzy player merge, display-label
  team merge, ownership inference, overwrite, or last-write-wins path exists.
- The lifecycle is `RECEIVED`, `VALIDATED`, `REVIEWED`, `COMMITTED`,
  `RECONCILED`, then `AVAILABLE`. Invalid, unsupported, rejected, quarantined,
  partially validated, and operationally failed packages cannot enter product
  reads.
- Validation and dry run never mutate canonical baseball entities, source
  events, corrections, statistics, reports, or projections. The surrounding
  privileged operation records only minimized security-audit evidence.
- A future commit consumes one server-sealed plan under fresh exact-Account
  authorization. Canonical promotion, provenance, mappings, lifecycle,
  idempotency result, and required audit evidence commit atomically. Staging may
  be restartable, but a partial canonical graph is impossible.
- Accepted history is repaired forward. Imports preserve original events,
  correction lineage, verification state, ruleset identity, source authority,
  and provenance; post-commit defects never trigger silent deletion or
  reinterpretation.
- Account isolation, source and target privacy overlays, minimum-field policy,
  retention/deletion rules, and non-enumerating errors apply at every import
  boundary. Package Account identifiers and provider claims are evidence only.
- Approved external-provider records remain staged evidence until the same
  identity, ruleset, replay, correction, privacy, review, and atomic-promotion
  gates succeed. Retrieval does not make provider data canonical.

## Consequences

The current version 1/2 documents remain valid for export and compatibility
validation, but they are not commit-eligible because they lack the complete
producer provenance, #106 content digest, reviewed mappings, quarantine
records, and sealed commit plan. The existing endpoint remains
`DRY_RUN_ONLY`.

A production importer requires forward-only persistence for packages, staging,
findings, mappings, ruleset resolutions, provenance, sealed plans,
idempotency/terminal results, and audit evidence. It also requires dedicated
import capabilities and transaction/concurrency tests. This ADR does not add
that schema or endpoint.

Downstream fantasy, delegation, UI, and offline work may consume only imports
that reached `AVAILABLE`; none may create a parallel portability or ruleset
fallback path.

## Rejected alternatives

- **Match rulesets or entities by name:** rejected because mutable labels are
  neither identity nor semantic equivalence.
- **Import against the latest/default rules:** rejected because historical
  replay would drift.
- **Let package Account or provider claims select the owner:** rejected because
  uploaded data is not authorization.
- **Commit valid records while quarantining the rest:** rejected because a
  partial dependency graph can corrupt historical meaning.
- **Trust imported statistics or reports as source truth:** rejected because
  they are derived and must reconcile with replay.
- **Overwrite manual history or corrected events:** rejected because accepted
  events and correction lineage are append-only evidence.
- **Destructively roll back an accepted import:** rejected because correction
  and provenance would disappear; repair rolls forward.

## Revisit triggers

Create a superseding ADR before allowing partial canonical promotion,
cross-Account ownership transfer, automatic identity merging, ruleset mapping
without semantic proof, destructive removal of accepted imported history, or
provider publication that bypasses review and reconciliation.
