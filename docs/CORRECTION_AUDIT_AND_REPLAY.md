# Correction audit and replay workflow

This document defines the M1 application boundary for accepting a scoring
correction without rewriting accepted history or serving stale aggregates. It
builds on the immutable event model, correction graph, deterministic replay,
statistic derivation, authorization, and privacy contracts. It does not add a
new event vocabulary, database table, migration, user interface, public
report, or export.

## Command and authorization boundary

`CorrectionAuditReplayService.applyCorrection` accepts one strict command:

- action `APPLY_CORRECTION`;
- Account, Game, and accepted setup snapshot identifiers;
- expected current source revision;
- correction event and play-transaction identifiers;
- actor-scoped idempotency key and request correlation identifier;
- recorded time;
- correction policy, ordered targets and replacements; and
- a required reason code.

The caller supplies a previously validated actor context. It must identify a
consistent human, service, or system actor with `game.correct` at the exact
Account and Game scope. A user actor also carries stable user and membership
identifiers. The service does not infer authority from a client session,
opaque identifier, source-event actor, team relationship, or successful prior
request. Account or Game mismatches fail before persistence and use a
non-enumerating unavailable response.

`game.correct` is distinct from `game.reopen` and `game.verify` in the
authorization policy. The current persistence boundary represents an
authorized reopen with the existing `GameReopened` source event and an
authorized verify or reverify with `GameVerified`. Callers must perform those
separate privileged operations with their applicable validated capability.

## Transactional acceptance

The repository performs correction acceptance in one serializable database
transaction:

1. Resolve the idempotency key for the actor, Account, and Game. An exact retry
   returns the original result; changed input is rejected.
2. Load the Account-scoped Game, exact ready setup snapshot, immutable source
   history, and correction relationships.
3. Compare the expected source revision and replayed lifecycle checkpoint with
   the current Game row.
4. Validate target existence, ordering, Account and Game ownership, correction
   graph rules, replacement identities, and the resulting baseball state.
5. Append the `CorrectionApplied` source event, play transaction, and
   correction relationships. The target rows and their payloads remain
   unchanged.
6. Replay all effective events and derive reconciled score and statistics.
7. Mark older Game projection checkpoints stale and publish a current
   checkpoint for the new source, privacy-overlay, and derivation versions.
8. Write the minimized security audit record.

Failure of replay, reconciliation, projection publication, or audit persistence
aborts the whole transaction. Source-revision compare-and-set and serializable
isolation allow only one concurrent writer to advance a revision.

Every accepted source event now marks older current Game checkpoints stale.
Only the correction workflow rebuilds and publishes the new checkpoint in the
same transaction. A later lifecycle event, including re-verification, therefore
makes the correction-era checkpoint stale until the projection publisher
derives and publishes that later source revision.

## Lifecycle and verification

The existing reducer remains authoritative:

| Current effective state                        | Correction result                                                       |
| ---------------------------------------------- | ----------------------------------------------------------------------- |
| `IN_PROGRESS`                                  | Allowed; remains live and unverified.                                   |
| `COMPLETED`                                    | Allowed; becomes `CORRECTED` and requires verification.                 |
| `CORRECTED`                                    | Allowed when the correction graph remains valid; requires verification. |
| `VERIFIED`                                     | Rejected. Append an authorized `GameReopened` first.                    |
| `READY`, `SUSPENDED`, `ABANDONED`, `CANCELLED` | Rejected.                                                               |

A verified game follows `GameReopened` → `CorrectionApplied` → projection
reconciliation → `GameVerified`. Historical verification events remain in the
source log, but current reports are unverified after reopen/correction until
reverification. Reversing a correction targets the prior correction event with
`REVERSE_EVENTS`; other attempts to replace correction events, duplicate active
targets, future targets, cross-Game targets, and correction cycles fail closed.

## Safe audit record

The audit action is `game.correction.apply`, capability `game.correct`, target
type `Correction`, and target id the accepted correction event. Safe output
contains:

- stable Account, actor, optional user/membership, and correlation identifiers;
- action, capability, outcome, correction and Game identifiers;
- ordered target event identifiers and reason code;
- database occurrence time;
- source revision before and after; and
- whether verification was unchanged, newly required, or invalidated and
  requires reverification.

Stored metadata additionally carries only allowlisted correction policy and
version/freshness fields. It does not duplicate replacement bodies, raw source
payloads, lineup names, player display names, contact data, notes, tokens,
credentials, or request payloads. Audit history is assembled only from
Account-scoped correction events and their matching audit records.

## Current report contract

The successful result exposes:

- accepted correction identity and exact-retry status;
- replayed lifecycle, score, and effective event count;
- corrected score plus minimized player batting and pitching counters;
- safe correction audit and ordered safe audit history; and
- version metadata.

Version metadata identifies source and correction revisions, setup revision,
event schema, reducer, statistic derivation and statistic rules versions,
ruleset, verification state, freshness, and generation time. `freshness:
CURRENT` is returned only after the Game revision, replay, derived statistics,
and current projection checkpoint agree in the same Account. A stale or missing
checkpoint is never relabeled current.

The report contains stable player identifiers needed to associate statistic
lines, but no display names, contact fields, age data, notes, raw event
payloads, or unrestricted audit metadata. Serving this application result from
an endpoint still requires the canonical `report.view`/`audit.view` read
authorization appropriate to that endpoint; the mutation response is returned
only to the already authorized correction actor.

## Failure behavior and recovery

- Invalid input or actor context fails before database work.
- Missing and cross-Account resources use the same unavailable result.
- Stale writers retry only after loading the new current source revision.
- A reused idempotency key with different content is rejected.
- Invalid lifecycle, correction graph, replacement replay, or statistic
  reconciliation commits nothing.
- Audit or projection failure commits neither the correction nor its
  relationships.
- An exact retry reauthorizes at the service boundary and returns the existing
  correction only while that correction remains the current source version.
- A later source revision requires a freshly derived checkpoint before it can
  be represented as current.

No production migration is required: M1 already provides immutable source
events, correction relationships, projection checkpoints, and security audit
records with Account-scoped relationships.
