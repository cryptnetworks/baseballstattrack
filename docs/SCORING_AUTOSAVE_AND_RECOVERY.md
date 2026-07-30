# Scoring autosave and interruption recovery

Issue #20 adds narrow, online-first recovery for unaccepted scorekeeping
commands. A refresh, temporary connection loss, device sleep, or accidental
navigation no longer requires the scorer to reconstruct a complete valid
proposal from memory. Accepted events remain server-authoritative.

This is not offline-first scoring. The browser stores at most one current draft
per scoring surface and never replays a queue automatically. Broad offline
scoring, cross-device conflict merging, and service-worker synchronization
remain owned by issue #34 and require a separate architecture decision.

## Recovery state model

The client uses explicit states:

- `EDITING` — controls have no persisted valid proposal yet;
- `LOCALLY_PENDING` — one valid unaccepted proposal is stored on this device;
- `SUBMITTING` — that exact proposal is awaiting a server response;
- `ACCEPTED` — the server confirmed acceptance;
- `RETRYABLE_FAILURE` — transport or unexpected failure may be retried exactly;
- `STALE_CONFLICT` — authoritative source revision changed elsewhere;
- `TERMINAL_REJECTION` — the proposal/schema/scope/lifecycle cannot be retried;
- `RECONCILED` — accepted history proves the local idempotency key was already
  accepted or a recovered retry succeeded; and
- `ABANDONED_LOCAL_DRAFT` — the scorer explicitly discarded the unaccepted
  local proposal.

Visible status uses the concise language `Saved`, `Saving`,
`Pending connection`, `Needs attention`, `State changed elsewhere`, and
`Recovered`. Live regions announce changes in text without relying on color.

## Stored draft contract

Only a complete typed, unaccepted command is eligible for local persistence.
Each strict schema-v1 envelope contains:

- draft kind;
- Account and game identifiers;
- accepted setup snapshot identifier and setup revision;
- expected authoritative source revision;
- client idempotency key;
- typed scoring proposal;
- ISO creation timestamp; and
- local draft schema version.

Storage keys include Account, game, and draft kind. Values contain stable
baseball identifiers required by the typed command, but no display names,
contacts, dates of birth, notes, auth/session/recovery tokens, secrets, raw
accepted history, or derived statistics. Malformed, old-schema, unsupported,
cross-Account, wrong-game, or replaced-setup drafts fail closed and can only be
discarded.

The implementation uses browser `localStorage` because the draft must survive a
refresh and browser process interruption. Local storage is untrusted and is
never an authorization signal. Every retry authenticates, authorizes the exact
Account/game/capability, validates same-origin action context, strict-parses the
event, and passes normal transactional acceptance.

## Persistence and retry semantics

Plate-appearance, runner-only, and lineup/pitching editors persist their valid
proposal after the scorer engages that surface. Invalid or incomplete controls
are not persisted. Server acceptance or authoritative evidence that the
idempotency key already exists clears the local copy.

An uncertain response retains the proposal and key. `Retry unchanged action`
therefore receives either the original acceptance or the repository's
idempotent replay of it. Controls lock after an uncertain failure so a changed
payload cannot be submitted with that key. Whenever an editable typed proposal
changes, the persistence hook stores it with a new key before enabling submit.
The repository independently rejects any changed-payload key collision.

On load or reconnect:

1. the server route reauthorizes and loads effective accepted history;
2. the client strict-parses the scoped local envelope;
3. an accepted submission-id match becomes `RECONCILED` and is cleared;
4. an exact source-revision match may be retried by explicit user action;
5. a revision mismatch becomes `STALE_CONFLICT`; and
6. the scorer must reload/reconcile or discard rather than replaying blindly.

No client state is promoted to accepted state. Successful retry revalidates the
route, and accepted setup plus effective event history are replayed again.

## Refresh, navigation, sleep, and second devices

An unaccepted draft installs the browser's native tab-close/refresh warning.
Same-page hash navigation remains available; route links ask for confirmation
before leaving. The draft is already saved locally before either warning.

Returning from a background tab, a page-cache restore, or reconnect requests a
fresh server render. This covers device sleep and common mobile browser
backgrounding. A second scorer or device that advances the source revision
causes the recovered draft to enter `State changed elsewhere`; it is never
submitted against the new state without reconciliation.

Without a service worker, no network request can complete while fully offline.
The UI says `Pending connection`, retains the valid draft, disables submission,
and refreshes authoritative state after the browser reports reconnection.

## Failure handling and limits

- Network or lost-response failure: retain and retry the exact proposal/key.
- Already accepted response: reconcile by accepted submission identity.
- Stale revision, correction, substitution, or terminal lifecycle change:
  reload authoritative state; do not replay automatically.
- Invalid domain transition or authorization: terminal rejection with a bounded
  message; the local copy may be discarded.
- Malformed, old-schema, or wrong-scope storage: never render the payload or
  send it to the server; discard only.

The browser does not store a multi-event queue, schedule background retries,
merge conflicting commands, infer acceptance from optimistic state, or replace
PostgreSQL event persistence. Those limits are intentional for the online-first
MVP.

## Verification

Tests cover strict envelope parsing/versioning, exact retry identity,
already-accepted reconciliation, stale second-scorer state, Account/game/setup
scope rejection, malformed storage, privacy exclusions, navigation warnings,
accessible status markup, changed-payload collision at the repository boundary,
and the existing transactional duplicate-acceptance/concurrency suite.
