# Offline scoring and conflict-safe sync decision

Issue #34 decides whether offline scoring and later synchronization should be a
product commitment. The decision is **yes, as a bounded M7 capability with one
designated writer per game**, not as general multi-device offline-first editing.
The server remains the only authority that accepts baseball history.

This document is the discovery input to M7 epic #100 and PWA issue #105. It does
not add a service worker, offline queue, device credential, or sync endpoint.

## Product commitment and limits

M7 should let one authorized scorer deliberately take one prepared game offline,
record a bounded ordered queue on that device, and later submit it for
deterministic server validation. Until sync succeeds, the UI calls every item
`Recorded on this device`, never `Accepted`, `Saved to team`, or `Verified`.

The first release is limited to:

- one Account, game, accepted setup snapshot, ruleset, scorer, browser profile,
  and designated device session;
- the existing typed scoring vocabulary, not offline roster/setup/admin work;
- a time- and size-bounded queue for a game prepared while online;
- explicit foreground synchronization; background sync may notify but cannot
  silently resolve or accept a conflict; and
- no automatic merge after the server source revision diverges.

Public viewing, cross-Account work, multi-writer collaboration, offline account
administration, silent branch selection, and native-device trust are out of
scope. If the single-writer and conflict constraints prove unusable in field
research, M7 should retain the existing interruption-recovery behavior rather
than weaken event authority.

## Authority model

PostgreSQL accepted source events remain authoritative. Before going offline,
the server issues a short-lived, signed offline scoring grant for the exact
Account, game, setup snapshot/revision, ruleset, current source revision, user,
membership, designated device public key, and unique session epoch. The grant
is a permission to prepare proposals, not proof of later acceptance.

The grant must:

- be issued only after current `game.score` authorization and game/setup checks;
- have a bounded same-day expiry and maximum queue size;
- contain no bearer authority usable for another Account/game/device;
- be stored with the encrypted queue, never in service-worker caches, logs,
  URLs, telemetry, or portable exports;
- be invalid after explicit online takeover, logout/local-data clearing, game
  lifecycle closure, or server-side session revocation; and
- be reauthenticated and reauthorized at sync. A membership removed while a
  device is offline cannot continue to write server history.

Revocation cannot erase an already disconnected browser. This residual risk is
visible to the scorer and operator: local proposals may continue until the
device reconnects, but the server rejects them if the grant or current authority
is invalid. The app preserves minimum local recovery evidence and offers no
backdoor support import.

## Local queue and device security

The current one-draft `localStorage` contract is not a safe multi-event queue.
M7 should use a versioned IndexedDB store containing:

- signed offline grant and session epoch;
- Account/game/setup/ruleset references;
- base accepted revision and state hash;
- ordered typed commands with stable event, play-transaction, submission, and
  idempotency IDs;
- a hash chain over canonical command bytes and local ordinal; and
- explicit states `LOCAL_ONLY`, `SYNCING`, `ACCEPTED`, `CONFLICTED`,
  `REJECTED`, or `RECOVERY_REQUIRED`.

Queue records contain the minimum stable baseball IDs and typed payload needed
for replay. They exclude names, contacts, notes, tokens unrelated to the grant,
reports, derived statistics, provider claims, and raw accepted history beyond
the prepared replay checkpoint.

Encrypt records with an origin-bound, non-exportable Web Crypto key when the
platform can persist it. This protects casual storage inspection and backup
copies but does not defeat same-origin script compromise, an unlocked device,
malicious browser extensions, or a captured authenticated session. Therefore
CSP/dependency controls, short grant lifetime, local-data visibility, device
screen lock guidance, and explicit clearing remain required. Never market
browser storage as hardware-backed unless the deployed platform proves it.

Logout, Account switch, game archival, successful sync, or user-requested
clearing deletes the applicable queue and key material. Browser/site-data
clearing or physical device loss can destroy unsynced events; the UI must warn
about this before offline mode. Cloud/browser storage synchronization is not an
approved recovery mechanism.

## Deterministic sync protocol

The device submits the grant, base revision/hash, queue schema version, ordered
canonical commands, and final hash-chain value over authenticated HTTPS. The
server then:

1. authenticates the current session and reauthorizes exact Account/game scope;
2. verifies grant signature, expiry, device proof, session epoch, setup/ruleset,
   queue bounds, canonical hashes, and unique idempotency identities;
3. locks the game in a serializable transaction;
4. requires current source revision and state hash to equal the offline base;
5. strict-parses and replays every command in order using the existing domain
   engine, advancing expected revision and state hash after each;
6. commits the bounded batch atomically with ordinary actor/audit attribution;
   or commits nothing and returns a typed conflict/rejection; and
7. returns accepted identities plus authoritative final revision/hash so the
   device can reconcile and delete the local queue.

An uncertain response is retried with the exact batch and identities. Existing
idempotency and accepted-history reconciliation prove whether it committed.
Changed content cannot reuse a batch or event identity. The server never trusts
device time for ordering or authorization; queue ordinal, signed epoch, and
server acceptance time are authoritative.

Atomic batches avoid a half-synced local branch. If production transaction and
payload budgets require segmentation, each committed segment becomes a visible
server checkpoint and later segments must name its exact returned revision and
hash. A segment failure stops; it never skips ahead.

## Conflict resolution

Any source revision/hash divergence, setup replacement, correction, scoring
takeover, game lifecycle change, expired/revoked authority, malformed queue, or
unsupported schema is a conflict or terminal rejection. Even apparently
commutative baseball actions are not automatically merged because order changes
base occupancy, outs, pitcher responsibility, run counting, and statistics.

The UI presents the authorized scorer with:

- server branch revision and safe event summaries;
- local branch count/time range and safe typed summaries;
- the first differing expected revision and reason; and
- explicit choices to keep server history and discard/export minimum local
  recovery evidence, or have an authorized scorer re-enter/correct valid plays
  against current history.

There is no `keep local branch` overwrite. Support personnel cannot inject the
queue or bypass current authorization. Any future assisted reconciliation uses
ordinary correction events and restricted audits, not database edits.

## Device loss, recovery, and updates

Device loss before sync can lose local proposals. The first release makes that
risk explicit and encourages reconnect checkpoints; it does not copy youth
sports history into unreviewed cloud backup. A future encrypted recovery bundle
would need a separate threat review, one-time transfer authorization, expiry,
revocation, and evidence that support cannot decrypt it.

The PWA update strategy must pin the capture schema for an active offline
session. A newly installed worker cannot delete or reinterpret an older queue.
On reconnect, unsupported versions enter `RECOVERY_REQUIRED` and use a reviewed
migration or read-only export path. Service-worker caches include only immutable
application shell assets and synthetic/public metadata; authenticated HTML/API
responses, grants, rosters, reports, and scoring payloads are excluded.

The shell always shows online state, local queue count, last authoritative
revision/time, grant expiry, active-device designation, and whether the game is
safe to close. Status uses text/live regions, not color alone, and supports
keyboard, touch, screen reader, reduced motion, portrait, and landscape use.

## Safe M2 behavior to reuse

M7 should reuse, without weakening:

- strict versioned event envelopes and canonical JSON/hashes;
- stable event, play-transaction, client-submission, and idempotency identities;
- exact Account/game/setup/ruleset scope;
- expected source revision and pre/post state hashes;
- deterministic replay and typed baseball/lifecycle rejection;
- serializable persistence and changed-payload collision rejection;
- the M2 recovery states for pending, retryable, stale, reconciled, and
  abandoned work;
- accepted-history reconciliation after an uncertain response; and
- the rule that stale work requires reload and human reconciliation.

M7 must replace, not stretch, the single-draft localStorage mechanism. It must
not reuse client state as authorization, accepted state, or a silent queue.

## Operational and support cost

This is a material product commitment, not a service-worker toggle. It adds:

- device-session/grant issuance, key rotation, revocation, takeover, and audit;
- IndexedDB schema migration and browser/storage-eviction support;
- PWA install/update/cache/logout/local-clear behavior across supported devices;
- bounded batch replay, transaction/load budgets, conflict UI, and recovery
  tooling;
- privacy/security response for lost devices and local sports-history exposure;
- customer support playbooks for expired grants, multiple scorers, site-data
  clearing, low storage, browser/private mode, clock changes, and failed updates;
- synthetic end-to-end testing across offline/reconnect/lost-response/device-loss
  paths; and
- operational metrics for queue age/count, sync results, conflict causes,
  takeovers, schema versions, and recovery—without payloads or player names.

An M7 launch requires named product/platform/security/support owners and field
support coverage. Do not promise that lost unsynced device data is recoverable.

## Go/no-go gates for M7

M7 #100 may implement this commitment only when it proves:

1. single-writer grant, takeover, expiry, current-auth recheck, and device proof;
2. encrypted versioned queue with clear local-data controls and honest residual
   risk;
3. deterministic bounded batch replay with duplicate/lost-response safety;
4. visible no-auto-merge conflict handling and correction-based recovery;
5. device loss, storage eviction, logout, account switch, grant revocation,
   worker update, and old-schema tests;
6. no cached authenticated responses or private data leakage;
7. scoring latency, sync transaction, storage, bundle, accessibility, and
   supported-device budgets; and
8. rollout/disable, incident, support, retention, and recovery playbooks.

Until those gates pass, the production commitment remains the existing M2
online-first single-draft recovery path.
