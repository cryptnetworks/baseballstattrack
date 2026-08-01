# Discord update content and message strategy

Issue #115 defines the versioned, Account-scoped policy for deciding which
accepted game changes affect Discord presentation and how those changes are
rendered. It does not consume events, call Discord, store provider message IDs,
or retry deliveries. Those execution responsibilities remain in #119.

## Trigger vocabulary

Administrators may select schedule changes, game start, score changes, lead
changes, scoring plays, half-inning changes, pitching changes, game completion,
verification, report readiness, and safe operational failures. Accepted
corrections are always selected. That safety override prevents a previously
published score from remaining misleading after append-only correction replay
changes effective game state.

`INNING_ENDED` is the stable contract value for an inning/half-inning change.
The additive `LEAD_CHANGED`, `SCORING_PLAY`, and `PITCHING_CHANGED` values fill
the remaining M5 event vocabulary without reinterpreting an existing value.
Trigger arrays are non-empty, unique, and bounded to the twelve known values.

Final-only policy must include at least one of `GAME_COMPLETED`,
`GAME_VERIFIED`, or `REPORT_READY`. Non-final selected triggers may still keep
the worker's current state fresh, but final-only policy does not publish them.

## Message strategies

- `EDIT_LIVE_MESSAGE` creates one game message and edits its current
  presentation. A correction edits the current message with an explicit
  corrected marker while delivery and scoring audit history remain immutable.
- `APPEND_EVENTS` creates a bounded chronological entry for each selected
  trigger. A correction appends an annotation; it never deletes or rewrites the
  prior Discord entry.
- `PERIODIC_SUMMARY` marks the current accepted state for the next eligible
  scheduled summary. Corrections remain explicit in the next summary.
- `FINAL_ONLY` waits for completed, verified, or report-ready state. A later
  correction appends an explicit correction when a final message already
  exists, or creates the current corrected final when none exists.

The pure domain planner returns `CREATE`, `EDIT`, `APPEND`, `QUEUE_SUMMARY`,
`WAIT_FOR_FINAL`, or `IGNORE`. It does not pretend that a plan was delivered.
The #119 worker must pin the settings revision and resolve provider message
identity before turning that plan into an idempotent Discord operation.

## Verbosity and payload limits

Message formatting is plain, deterministic, and based only on an authorized
current read model. The format budgets are deliberately below Discord's
2,000-character text-message hard limit:

| Format   | Maximum text characters | Intended content                                      |
| -------- | ----------------------: | ----------------------------------------------------- |
| Compact  |                     280 | Score and concise game status                         |
| Standard |                   1,000 | Score, status, and latest accepted event              |
| Detailed |                   1,800 | Labelled status, latest event, and read-model context |

Input labels and event summaries are bounded before rendering. Overlong
presentation is deterministically truncated, while a correction notice and
the statement that prior history is retained receive reserved space. Raw
event payloads, player contacts, notes, database keys, guild/channel IDs,
credentials, and provider tokens are never message input.

## Administration and UI behavior

The Updates workspace saves triggers, strategy, and format using exact-Account
`discord.settings.configure`. The same-origin action is administration-rate
limited and uses the existing optimistic settings revision. It preserves
routing, tracked scopes, cadence, windows, pause state, and worker-owned status.
Disconnected or revoked installations remain inspectable but reject content
changes.

Every write uses the existing secret-free settings audit record. Audit metadata
contains only strategy, format, trigger count, and other bounded policy
categories—not message content or Discord/baseball identifiers.

The workspace renders synthetic examples for all four strategies using the
saved verbosity. These examples prove the strategy and correction presentation
contract without sending Discord messages or using real game data. Issue #113
owns interactive whole-configuration validation, live/final/correction/error
preview, and clearly marked test delivery.

## Compatibility and rollout

`messageStrategy` is additive to settings schema version 1. Existing rows and
older complete-replacement API clients receive the safe `FINAL_ONLY` default.
The three trigger enum additions preserve all existing stored values. The
migration expands the trigger-cardinality constraint from nine to twelve and
keeps service-only RLS unchanged with no public database policies.

Deploy the migration before code that persists the new strategy. Rollback is
roll-forward once the enum values or strategy column are used; older binaries
may read existing rows but must not be used to overwrite policy they do not
understand.
