# Scoring correction UX

## Purpose

The scoring correction surface exposes the immutable M1 correction workflow
without turning accepted event payloads into an editing API. An authorized
member can review recent baseball events, preview a structured change, confirm
it, and see the resulting baseball-history audit entry.

Accepted source events remain immutable. A correction appends a
`CorrectionApplied` event and deterministic replay resolves the effective
history.

## Authorization and scope

- The scoring page remains available through `game.view`.
- Recent correction history, previews, and submissions require
  `game.correct` for the exact Account and game.
- Reopening a verified game separately requires `game.reopen`.
- Server actions verify the selected Account cookie, same-origin request, exact
  game target, setup snapshot, and source revision.
- Unauthorized users receive no correction-history details.
- The UI shows baseball-history attribution only. Stored security audit
  records, membership references, and authority evidence remain in the
  protected audit system.

## Recent-play history

Recent correctable source events and correction events are ordered
deterministically by descending sequence, with event ID as the tie breaker.
Pages contain ten entries.

Each entry presents:

- inning and half;
- sequence;
- batter, runner, or lineup identity;
- concise baseball outcome;
- score and out effects;
- current or superseded status;
- corrected versus original judgment where applicable; and
- policy-allowed actor reference and acceptance time.

Raw event payload JSON is not displayed.

## Correction flow

1. Select a current recent event.
2. Choose reversal (including reversal of a current correction) or, for a
   plate appearance, a structured replacement judgment.
3. Select a bounded reason code.
4. Select the responsible fielder when changing the judgment to reached on
   error.
5. Calculate a deterministic preview from current accepted history.
6. Review score, inning/base/out situation, batting, pitching, fielding, and
   verification impact.
7. Explicitly confirm the exact preview.
8. Submit through `CorrectionAuditReplayService`.
9. Refresh from authoritative replay after acceptance.

Free-form explanation is not collected because the current correction event
contract supports a bounded reason code only.

## Preview boundary

A successful preview proves only that the proposed replacement can be replayed
deterministically against the source revision used for the preview. It does not
grant authorization and does not accept a correction.

The acceptance action reloads authorized history, requires the same source
revision, rebuilds the structured payload, reruns preview validation, and then
calls the M1 correction service. Stale or invalid proposals fail closed.

## Lifecycle and verification

- In-progress, completed, and already-corrected games are eligible for
  correction.
- Suspended, ready, abandoned, and cancelled games must first return to an
  eligible lifecycle state through their existing workflow.
- A verified game must be explicitly reopened. The reopen control requires a
  separate acknowledgement and `game.reopen` authorization.
- Corrections to completed or reopened games leave the game unverified and
  clearly require verification or reverification.

The correction UI never bypasses lifecycle transitions.

## Retry behavior

The rendered correction proposal carries stable event, play-transaction,
replacement, idempotency, and recorded-at identities. The server reuses the
opaque idempotency identity as the audit correlation reference. An exact retry
therefore reaches the M1 idempotency path with identical content. Any
source-revision change requires a fresh history load, preview, and
confirmation.

The UI never blindly reapplies a correction to newer history.

## Accessibility and responsive behavior

- History uses ordered lists and text labels rather than color alone.
- Current, superseded, corrected, and audit states are visible as text.
- Inputs have persistent labels and native keyboard behavior.
- Preview, confirmation, and reopen are separate semantic forms.
- Confirmation and reopen require native required checkboxes.
- Errors use alert semantics; accepted or reconciled states use status
  semantics.
- Touch targets have a minimum height of 44 pixels.
- Two-column forms collapse to a single column on narrow screens.
