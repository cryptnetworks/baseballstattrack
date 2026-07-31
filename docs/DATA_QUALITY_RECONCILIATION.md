# Data-quality reconciliation

Baseball Stat Track reconciles derived data against immutable accepted scoring
events. Accepted events remain the source of truth; reconciliation never repairs
a discrepancy by overwriting events, projections, reports, or exports.

## Evidence chain

The versioned reconciliation routine deterministically rebuilds and compares:

1. immutable event envelopes and their pre/post-state evidence;
2. effective history after correction suppression and replacement;
3. replay score, inning, outs, runners, lineups, pitchers, and lifecycle;
4. player counters, team totals, exact derived rates, and inning lines;
5. projection identity and freshness;
6. box-score report content and portable export summaries; and
7. correction and verification state.

Provenance contains Account, game, setup, source, privacy-overlay, ruleset, and
derivation versions plus SHA-256 evidence hashes. It contains no player names,
contact fields, event payloads, or credentials.

## Confidence and findings

- `VERIFIED` means all checks passed at a verified source revision.
- `CURRENT` means checks passed for a current but not verified terminal record.
- `CORRECTED` means corrected history passed and awaits reverification.
- `INCOMPLETE` means a game is still draft, active, or suspended.
- `STALE` means replay is valid but a projection must be rebuilt.
- `INTEGRITY_FAILURE` means at least one blocking discrepancy exists.

Freshness is `CURRENT`, `STALE`, or `INCOMPLETE` only when evidence permits
that conclusion; an integrity failure reports `UNKNOWN` freshness.

Warnings describe expected lifecycle or recalculation work. Blocking findings
indicate that independently held data disagrees with canonical replay or that
immutable evidence cannot be verified. Finding context uses only safe state,
revision, and category values.

## Operations and remediation

Operators run reconciliation with exact-Account, exact-game `audit.view`
authority. Every completed run writes a `data.reconcile` security-audit record
with its trigger, confidence, revisions, finding codes, and evidence hashes.
This provides durable evidence without storing a second mutable copy of the
derived baseball data.

The same-origin `POST /api/admin/data-reconciliation` operator boundary accepts
the exact Account, game, accepted setup snapshot, trigger, and an optional safe
correlation identifier. It is authenticated, game-authorized, quota-enforced,
and returns private no-store output. A blocking result uses HTTP 422; a source
revision race uses 409 so the operator can retry against a fresh envelope.

Follow the remediation on each finding:

- replay source history or escalate immutable-evidence failures;
- rebuild a stale or missing projection from accepted history;
- regenerate a report or export rather than editing it;
- resume or complete an interrupted game; and
- reverify corrected history only after reviewing the rebuilt result.

Reprocessing is safe because it reads accepted history and generates the same
evidence for the same versions. If the source revision advances during a run,
the service retries once and then fails closed. Expected recalculation emits a
non-paging warning; an integrity failure emits a critical paging signal.

Import/export validation remains separate from acceptance: a valid round trip
must reproduce the canonical export summary, while an invalid summary is
reported and never used to replace local history.
