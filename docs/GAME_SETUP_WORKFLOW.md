# Game setup workflow

Issue #16 adds the scorekeeper-facing pregame workflow around the immutable M1
setup boundary. It does not add a second setup store or scoring surface.
`GameSetupService` remains authoritative for draft creation, setup revision
acceptance, readiness, and current-revision reads.

## Routes and handoff

- `/accounts` selects an Account navigation preference after current membership
  authorization.
- `/games/setup` authorizes `game.create` at the selected Account, lists
  resumable unstarted games, and creates a `DRAFT` game for one managed
  team-season.
- `/games/setup/[gameId]` authorizes `game.setup` at the exact Game and loads
  its current setup revision, eligible same-season participants, eligible roster
  periods, and active rulesets.
- `Start game` separately authorizes `game.start`, reloads the authoritative
  ready setup, requires source revision zero and the displayed setup revision,
  then accepts one `GameStarted` event through `GameEventService`.

The scoring handoff is therefore the Account-scoped Game id, exact
`readySetupSnapshotId`, `setupRevision`, source revision `0`, and the replayed
state produced after `GameStarted`. Issue #18 may add base/out interaction
presentation and issue #17 may add plate-appearance entry without changing this
handoff.

## Layering

The workflow uses these layers:

1. App Router page and authenticated server loader.
2. Account- or exact-Game authorization through the production authorization
   service.
3. `GameSetupService` application boundary.
4. Account-scoped `PrismaGameSetupRepository` reads and existing immutable
   writes.
5. A strict, serializable `SetupWorkflowDraft` view model.
6. The client wizard, which treats its checks as feedback rather than
   authority.
7. Same-origin server actions returning structured success, field-error, stale,
   lifecycle, authorization, retryable, or terminal results.
8. Authoritative revision reconciliation after every accepted mutation.

Client components never call Prisma. IDs from the browser do not authorize an
operation.

## Workflow

The editor has four short stages:

1. Game details: UTC date/time, ruleset, bounded location, and optional
   structured weather.
2. Participants: managed team home/away designation and a different managed
   team-season or bounded external opponent label.
3. Lineup and defense: active players, contiguous batting order, defensive
   assignments, and one starting pitcher per side.
4. Review and readiness: visible blockers, current setup revision, save state,
   and server-authoritative readiness.

Back/forward step navigation never discards the in-memory proposal. `Save
draft` is available before readiness and may persist an intentionally incomplete
revision. `Save and mark ready` requires complete client feedback checks and
then invokes the complete M1 domain validation. Editing an accepted ready setup
creates a new immutable revision and returns the game to `DRAFT`.

## Save and resumption behavior

Each save includes:

- Account and Game;
- expected setup revision;
- a stable client submission id for exact retry;
- active ruleset;
- bounded game details;
- explicit sides; and
- typed lineup, defense, and pitcher assignments.

An accepted save returns the new revision and snapshot id. The next edited
proposal receives a new submission id. A retry of the unchanged action uses the
same identity; a changed proposal does not. The UI reports `Saved`, `Saving`,
`Unsaved changes`, or `Needs attention` in an accessible status region.
Starting derives a stable start idempotency key from the current unsaved-action
identity, so a lost response can be retried without accepting a second
`GameStarted` event.

Resumption always reloads the latest `Game.setupRevision` and corresponding
immutable snapshot from PostgreSQL. Browser storage is not the draft authority.
A stale writer receives `STALE_SETUP_REVISION`, retains its form proposal, and
is told to reload rather than overwrite. A game with accepted source events is
rendered read-only and cannot return to editable setup.
Snapshot participants and lineup rows remain visible when a later roster or
team lifecycle change makes them ineligible. They are labelled as ineligible,
can be removed from a new proposal, and block readiness rather than silently
disappearing from the resumed draft.

## Validation and errors

Immediate feedback covers:

- invalid date, location, weather, or temperature;
- missing or contradictory opponent;
- repeated or noncontiguous batting order;
- missing or repeated conventional positions;
- no starting pitcher, multiple starting pitchers, or a pitcher assigned
  outside `PITCHER`.

The server then applies the canonical M1 checks for Account ownership,
participant identity, roster period eligibility, ruleset limits, exact
revision, lineup shape, pitcher eligibility, lifecycle, and deterministic
replay readiness. Error output is bounded and human-readable; SQL, Prisma
diagnostics, raw event payloads, and resource existence across Accounts are not
exposed. Recoverable errors keep the proposal and focus the error summary.

## Responsive and field use

The layout is phone-first:

- staged content avoids a wide setup table;
- lineup rows are stacked cards on narrow screens;
- controls and primary actions use at least 44–48 CSS-pixel heights;
- the action bar remains reachable while scrolling;
- tablet and desktop widths increase columns without changing the workflow;
- no orientation-specific behavior or fixed-width modal is required.

The interface uses high-contrast text, borders, and text labels rather than
color-only state. The responsive classes support narrow phone portrait, phone
landscape, tablet portrait/landscape, and desktop layouts without horizontal
lineup-table overflow.

## Accessibility

Critical behavior uses native links, buttons, radio buttons, checkboxes,
selects, number inputs, and fieldsets. All controls have accessible names.
Progress uses an ordered list with `aria-current="step"`. Save state uses a
polite live region; failures focus a bounded `role="alert"` summary. Error links
open the relevant stage. Focus styling remains visible.

Batting order can be edited directly or moved with named `Move [player] up` and
`Move [player] down` buttons. Drag and drop and pointer gestures are never the
only ordering method. Started-game controls are disabled and their lifecycle
state is expressed in text.

## Privacy and Account boundary

Every loader and action re-authenticates and re-authorizes current database
membership. Creation lists only the selected Account context. Editing, saving,
readiness, and start require the exact Account-owned Game target. Repository
queries include Account scope and unauthorized resources fail as unavailable.

The UI uses only team labels, player display labels, jersey numbers, lineup
roles, date, location, and structured weather required for scoring. It does not
collect birth data, contacts, medical data, free-form player notes, secrets, or
raw audit/event payloads. External participants remain snapshots and do not
create fake managed identities.

## Verification

Focused tests cover managed and external opponents, home/away mapping,
incomplete draft save, readiness blockers, contradictory setup, lineup and
pitcher errors, strict privacy-safe parsing, exact Account/Game authorization,
the dedicated `game.start` capability, semantic controls, keyboard ordering,
large action targets, responsive structure, and immutable started state.

The existing PostgreSQL setup suite additionally exercises draft resumption
context, immutable revisions, readiness, stale concurrency, Account isolation,
edit-after-start rejection, and the full setup-to-ready/start pipeline.
