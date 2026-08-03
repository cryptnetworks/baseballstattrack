# Scorekeeping usability and accessibility

## Status and baseline

This pass targets WCAG 2.2 Level AA as an engineering baseline. It is not a
legal-compliance certification, and automated checks do not prove complete
accessibility.

The review covers the M2 journey:

`select Account and team-season → configure game → mark ready → start → score plate appearances → move runners → change pitcher/defense → recover an interrupted action → correct a play → inspect and verify the box score`

The implementation continues to use server-authoritative setup and event
revisions. Accessibility changes do not weaken Account authorization,
idempotency, replay, correction, or verification boundaries.

## Evidence boundary

The task walkthrough is a structured expert review using synthetic data, not
participant research or a legal-compliance certification. No participant
quotes, success rates, or laboratory-grade performance claims are made.
Physical-device, representative-network, and assistive-technology sessions
remain required production acceptance evidence.

## Accessibility contract

The accessibility contract tests verify:

- the application palette meets a 4.5:1 text-contrast floor;
- every page `main` landmark is the focusable target of one global skip link;
- every source button carries the repository's 44 CSS pixel minimum-height
  contract;
- zoom is not disabled;
- safe-area insets, visible focus, forced-colors focus, and reduced-motion
  rules remain present;
- selected plate outcomes use `aria-pressed`, not color alone;
- current inning, outs, and score use a named region, definition-list
  semantics, and a concise polite update;
- every async workflow surface manages focus and exposes status or alert
  semantics;
- the workflow has no fixed or sticky action bars;
- responsive table overflow remains contained;
- the M2 route composition remains connected in task order.

Measured palette ratios:

| Foreground              | Background      |   Ratio |
| ----------------------- | --------------- | ------: |
| `#5f6b63` muted text    | `#f7f7f4` page  |  5.19:1 |
| `#5f6b63` muted text    | `#ffffff` panel |  5.57:1 |
| `#176b4d` accent/focus  | `#ffffff` panel |  6.47:1 |
| `#0f5138` strong accent | `#ffffff` panel |  9.32:1 |
| `#162018` body text     | `#f7f7f4` page  | 15.60:1 |

These calculations cover the shared application tokens. Tailwind utility
combinations were also reviewed in the affected scoring surfaces, but this is
not a claim that every possible dynamic color combination has been measured.

## Responsive matrix

The complete synthetic workflow was rendered at each viewport after fixes.
`scrollWidth` equaled `clientWidth` in every case, so no page-level horizontal
overflow remained. Box-score tables retain intentional, labelled local
horizontal scrolling.

| Viewport              |   CSS size | Page overflow | Undersized rendered action targets | Result |
| --------------------- | ---------: | ------------- | ---------------------------------: | ------ |
| Small phone portrait  |  320 × 568 | None          |                                  0 | Pass   |
| Common phone portrait |  390 × 844 | None          |                                  0 | Pass   |
| Phone landscape       |  667 × 375 | None          |                                  0 | Pass   |
| Tablet portrait       | 768 × 1024 | None          |                                  0 | Pass   |
| Tablet landscape      | 1024 × 768 | None          |                                  0 | Pass   |
| Desktop               | 1440 × 900 | None          |                                  0 | Pass   |

The review covered:

- wrapping navigation and action groups;
- source-order content when grids collapse;
- safe-area padding;
- absence of fixed scoring footers;
- native controls under virtual-keyboard assumptions;
- contained report-table overflow;
- phone orientation changes;
- touch spacing and 44px action targets.

At 200% browser page scale on a 390px layout viewport, Chrome reported a 195px
visual viewport, scale `2`, and no layout-level overflow (`scrollWidth` and
`clientWidth` both 390px). Horizontal panning of enlarged content remains
available; zoom is not disabled.

The full workflow was not run on physical phones or tablets. Notch and virtual
keyboard behavior are supported by safe-area CSS, native-flow controls, and
removal of the sticky setup footer, but require device verification before a
public accessibility claim.

## Keyboard and focus review

Scripted browser keyboard evidence found:

- the first Tab from the document enters the 44px “Skip to main content” link;
- Enter on the skip link focuses `main`;
- the focused outline is a solid 3px accent outline;
- the single-key `w` shortcut opens a Walk proposal and focuses its labelled
  fieldset;
- every `aria-keyshortcuts` target is `type="button"`, so no shortcut directly
  submits or destroys data;
- setup step actions, native selects, runner controls, pitching-change mode,
  correction controls, recovery actions, and verification controls remain in
  the native tab order;
- dynamic error/status targets use `tabIndex={-1}` and explicit focus after
  async results;
- discarding a plate proposal restores focus to the outcome group.

There are no custom modal dialogs in the M2 workflow. Navigation protection
uses the browser's native confirmation behavior when an unaccepted local draft
exists. Native form controls provide Escape/cancel behavior where applicable.

The review did not use a physical keyboard against a signed-in production
Account. The keyboard evidence is component-level and scripted-browser
evidence, supplemented by domain tests for the documented shortcuts.

## Screen-reader semantic review

The code and rendered markup expose:

- inning, half, outs, and both scores in a named game-state region;
- a concise polite game-state update rather than repeated assertive output;
- named current batter, on-deck batter, and active pitcher values;
- a decorative base diamond hidden from assistive technology and a parallel
  named base-occupancy definition list;
- outcome groups with legends, named actions, shortcut metadata, and
  `aria-pressed` selection;
- native labelled runner, substitution, pitching, correction, and verification
  controls;
- polite save/recovery status and assertive failure messages;
- correction preview, confirmation, and separate baseball audit semantics;
- box-score captions, column headers, row headers, report status, and
  verification confirmation.

Color is supplementary: state and failure surfaces include text, selection
state uses `aria-pressed`, and disabled controls use native `disabled`
semantics.

No physical screen reader was available. VoiceOver, NVDA, JAWS, and mobile
screen-reader announcement timing remain release-validation work. In
particular, rapid consecutive scoring should be checked for announcement
verbosity on a real assistive-technology stack.

## Simulated expert walkthrough

Severity uses `blocking`, `high`, `medium`, or `low`.

| Task                                    | Friction and evidence                                                                                                   | Severity | Fix                                                                                                          | Validation                                                      |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| Select Account and create/resume a game | Sign-out, Account selection, and sign-in actions were smaller than the field-use target; no global bypass link existed. | High     | Raised actions to 44px; added one skip link and focusable page targets.                                      | Source target audit; Chrome first-Tab/Enter evidence.           |
| Configure and ready setup               | Sticky setup actions could obscure fields under a virtual keyboard or at high zoom.                                     | High     | Returned actions to normal document flow.                                                                    | Six-viewport workflow audit; no fixed/sticky workflow controls. |
| Score a walk                            | Outcome selection relied on visual styling for selected state.                                                          | High     | Added `aria-pressed` to common and expanded outcomes.                                                        | SSR contract plus scripted `w` shortcut and focused proposal.   |
| Score a hit with runner movement        | State is visually dense, but the before/after base lists and labelled native selects remain understandable.             | Medium   | Kept the decorative diamond hidden and the textual occupancy model authoritative; retained 44–56px controls. | Runner component tests and six-viewport inspection.             |
| Record an inning-ending double play     | Complex runner actions require review of multiple destinations and outs, which is intentional safety friction.          | Medium   | Preserved one atomic proposal and explicit before/after/out totals; no destructive single-key submit.        | Domain transition tests and semantic component tests.           |
| Make a pitching change                  | The mode is keyboard-operable and uses `aria-pressed`; before/after lineup context is long on phones.                   | Medium   | Kept source-order stacked previews and native selectors; no horizontal page overflow.                        | Lineup tests and responsive workflow inspection.                |
| Recover connection loss                 | Recovery actions were available, but resulting context was not an explicit focus destination.                           | High     | Added focus management to the recovery status and visually distinguished local discard.                      | Recovery tests and local-draft harness evidence.                |
| Correct a scoring mistake               | Long select options forced the correction builder wider than 320px and phone landscape.                                 | High     | Added `min-w-0 w-full` grid/control constraints; added correction preview/error focus management.            | Chrome before/after overflow measurement; correction tests.     |
| Inspect and verify box score            | Verification failures lacked an explicit focus destination.                                                             | Medium   | Focus the error status; preserve semantic tables and explicit confirmation.                                  | Box-score component tests and source contract.                  |

All high-severity findings discovered in this pass were fixed. No M3 reporting,
dashboard, public-sharing, or export work was added.

## Performance observations

The scoring UI has no application image dependency. Geist is bundled through
Next.js font handling. Critical interactions use immediate local pending text,
then reconcile against server-authoritative revisions.

Implementation inspection found:

- plate, runner, and lineup proposals are calculated locally with memoized pure
  preview functions before submission;
- each accepted mutation carries an idempotency identity and exact source
  revision;
- status text changes immediately during server round trips;
- the scoring page keys editors by source revision to discard stale UI state;
- correction history is paged in groups of ten instead of sending the entire
  event history to the client;
- box-score statistics are derived on the server and rendered as a typed report;
- there are no fixed action bars, autoplaying media, or motion-dependent
  interactions.

One controlled artifact inspection measured the following unique client
JavaScript referenced by each route manifest:

| Route        |           Raw |          gzip |
| ------------ | ------------: | ------------: |
| Home         |  88,269 bytes |  23,966 bytes |
| Game setup   | 394,469 bytes |  93,462 bytes |
| Live scoring | 910,490 bytes | 242,370 bytes |
| Box score    |  91,344 bytes |  25,092 bytes |

These are artifact sums, not network transfer traces; shared chunks may already
be cached across navigation. The live-scoring route is the largest
client surface because it includes recovery, plate appearance, runner,
substitution, and correction editors. It remains a nonblocking optimization
target for route-level profiling and safe code splitting after representative
low-end-device measurement.

No network-throttled or laboratory interaction benchmark was run. Production
round-trip latency, hydration cost on low-end phones, and long-game memory use
should be measured with representative hosted data.

## Material fixes

- Added a global skip link and focusable `main` targets.
- Added consistent 3px focus-visible and forced-colors treatment.
- Added safe-area and 100% text-size-adjust behavior without disabling zoom.
- Added a reduced-motion fallback.
- Made shell, sign-in, Account, and source buttons meet the 44px action target.
- Replaced the setup wizard's sticky action bar with normal document flow.
- Added semantic current-game definition data and a concise live update.
- Added `aria-pressed` to plate-outcome choices.
- Added focus restoration for game creation, runner results, recovery,
  correction preview/errors, and box-score verification errors.
- Distinguished local/proposal discard actions visually.
- Constrained correction selects so long options cannot widen the page.
- Added a repeatable scorekeeping accessibility and responsive contract.

## Remaining limitations and deferrals

Nonblocking M2 validation limitations:

- no real participant study;
- no physical phone/tablet or virtual-keyboard session;
- no signed-in end-to-end browser run against a real Account;
- no physical screen-reader session;
- no automated browser accessibility engine such as axe;
- no low-end-device or network-throttled performance profile;
- a comparatively large 242,370-byte gzip live-scoring client manifest that
  needs hosted route profiling before deciding where to split;
- no unsupported league-rule expansion beyond the accepted ruleset.

Physical assistive-technology, low-end-device, and representative-network
testing is required before making a broader public accessibility or performance
claim.
