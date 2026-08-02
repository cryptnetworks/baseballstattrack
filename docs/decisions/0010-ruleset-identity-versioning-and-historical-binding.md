# ADR 0010: Ruleset identity, immutable versions, and historical binding

## Status

Accepted

## Context

Baseball Stat Track already records an Account-scoped `rulesetVersionId` on
game setup snapshots and source events. Referenced ruleset rows cannot be
deleted, and the database prevents mutation of their identity and
configuration. This protects current replay, but the existing model has only
`ACTIVE` and `ARCHIVED` states and combines a ruleset family, version,
ownership, and activation in one row.

M8 needs multiple rule variations, league administration, imports, analytics,
and fantasy scoring without allowing any of those systems to reinterpret an
accepted game. A stable family identity, immutable semantic versions,
owner-scoped approval, effective activation, and explicit compatibility
metadata are therefore required before downstream M8 design starts.

## Decision

Adopt the contract in [Ruleset contract](../RULESET_CONTRACT.md).

- A stable `Ruleset` identity names one owner-controlled family. An immutable
  `RulesetVersion` is a sealed semantic payload within that family. Activation
  is a separate, audited assignment of one version to an authorized scope and
  effective interval.
- Version numbers are monotonically increasing positive integers within one
  ruleset identity. The opaque version identifier and canonical content digest
  are the durable machine identity; names and version numbers are not foreign
  keys.
- Lifecycle is `DRAFT`, `REVIEWED`, `ACTIVE`, `DEPRECATED`, then `RETIRED`.
  Draft content may change only before review. Review seals the payload.
  Subsequent lifecycle changes are append-only audit/activation events and do
  not mutate baseball meaning.
- A game resolves exactly one ruleset version when an accepted setup revision
  is written. Pre-start changes require a new setup revision. The binding is
  immutable once the first scoring event is accepted. Corrections, replay,
  statistics, reports, exports, analytics, and fantasy derivation use that
  recorded version.
- Rulesets do not compose implicitly. If reusable modules are introduced, an
  activated version must resolve them to immutable identifiers and include the
  resulting dependency closure in its digest.
- Baseball ruleset versions and fantasy scoring-model versions are separate
  identities. Fantasy consumes canonical events/statistics and records both
  versions; fantasy point weights never change baseball scoring truth.
- Unknown categories, unsupported values, missing compatibility metadata, and
  ambiguous imports fail explicitly. No consumer may ignore an unknown field
  or substitute a current/default ruleset for a recorded one.
- `Account` remains the implemented tenant boundary. Platform, organization,
  and league ownership are semantic owner kinds, but organization/league
  authority cannot be implemented until its exact tenant relationship and
  capabilities are accepted under #107.

## Consequences

The current schema remains valid as a historical precursor, but it does not
fully implement this contract. A future implementation requires forward-only,
expand-and-contract schema work for stable ruleset identities, owner
principals, richer lifecycle, content digests, compatibility metadata,
activation assignments, and append-only approval/audit evidence.

Existing version identifiers and game/event references must be preserved.
Backfills may normalize structure only when replay proves identical before and
after. They may not invent semantic defaults or rebind historical games.

Downstream imports, analytics, fantasy, and delegation must reference the
contract rather than adding independent ruleset fields or fallback behavior.

## Rejected alternatives

- **One mutable Account settings row:** rejected because later edits would
  reinterpret accepted history.
- **Version by name or semantic-version string alone:** rejected because names
  change and semantic-version labels do not provide referential identity.
- **Resolve the latest active version during replay:** rejected because replay
  would drift after activation changes.
- **Per-event ruleset switching:** rejected because one game would have
  ambiguous lineup, inning, and statistical meaning.
- **Implicit composition or inheritance:** rejected because hidden parent
  changes make a version digest incomplete.
- **Fantasy weights inside baseball rules:** rejected because a fantasy change
  must not contaminate canonical scoring or statistics.
- **Immediate schema migration:** rejected because #106 is the design gate and
  the current references already preserve history. Schema implementation needs
  its own reviewed migration scope.

## Revisit triggers

Create a superseding ADR before allowing mixed-ruleset games, mutable published
versions, cross-owner activation, ruleset composition without a sealed
dependency closure, semantic rebinding of accepted games, or a tenant model
that makes organization/league ownership independent from Account isolation.
