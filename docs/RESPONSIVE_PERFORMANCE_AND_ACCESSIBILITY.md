# Responsive performance and accessibility

## Status and claim boundary

This is the product design baseline for scorekeeping, reporting, print, export,
and import-validation workflows. It defines responsive behavior, accessibility
expectations, representative budgets, and the boundaries of supported public
claims.

The accessibility target is WCAG 2.2 Level AA as an engineering baseline. This
document is not a legal-compliance certification. Automated checks cannot prove
complete accessibility, and the manual review below is a structured expert
review without participants or a physical screen reader.

The work preserves server-authoritative event replay, exact Account
authorization, privacy-overlay resolution, idempotency, correction history,
verification, and dry-run-only import policy.

## Measurement environment

Controlled measurements use synthetic data, warmed operations, optimized
production artifacts, and no production credentials, personal data, hosted
database, or production traffic. Wall-clock observations are tied to the
recorded environment and are not universal latency guarantees.

Route budgets measure each production route's unique client chunks, raw and
independently gzipped bytes, and route isolation. Representative workload
profiles cover 75-event games, 100-game seasons, and 9,000-record import
validation. Physical devices, authenticated hosted sessions, throttled
networks, print previews, and assistive-technology sessions remain separate
production acceptance evidence.

## Supported devices and responsive matrix

The supported browser layout matrix is:

| Profile               | CSS viewport | Primary layout expectation                                               | Evidence in this pass                                      |
| --------------------- | -----------: | ------------------------------------------------------------------------ | ---------------------------------------------------------- |
| Small phone portrait  |    320 × 568 | Source-ordered cards; local table scrolling; no fixed action obstruction | Source/SSR contracts plus retained M2 Chrome evidence      |
| Common phone portrait |    390 × 844 | Touch-sized controls; wrapping navigation; safe-area padding             | Source/SSR contracts plus retained M2 Chrome evidence      |
| Phone landscape       |    667 × 375 | Normal-flow controls above virtual keyboard; no page-wide table overflow | Source review plus retained M2 Chrome evidence             |
| Tablet portrait       |   768 × 1024 | Two-column layouts where space permits                                   | Responsive class contract                                  |
| Tablet landscape      |   1024 × 768 | Multi-column summaries with source order preserved                       | Responsive class contract                                  |
| Desktop               |   1440 × 900 | Full dashboard/report grids without eager client chart code              | Production route manifests and source review               |
| 200% zoom             |   390 layout | Zoom remains enabled; content can reflow or pan without clipped actions  | Global zoom/focus contract and retained M2 Chrome evidence |
| Enlarged text         |    200% text | Wrapping labels and minimum control height remain available              | Flexible grid/min-width source contract                    |

Long team/player labels are constrained with `min-w-0`, local table overflow,
and breakable error/checksum text. File controls remain in normal flow and
bounded by their container. No scoring, print, export, or import action bar is
fixed or sticky. Browser zoom is not disabled. Safe-area padding remains on the
document body.

Physical notch behavior, mobile screen readers, and a virtual keyboard against
an authenticated deployment remain release validation rather than claimed
evidence.

## Network profiles and behavior

These profiles define the supported review conditions:

| Profile            | Reference shaping                                     | Acceptable behavior                                                                  |
| ------------------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Normal broadband   | 50 Mbps down, 10 Mbps up, 20 ms round-trip latency    | Route feedback is immediate; request completes within the normal budget              |
| Constrained mobile | 1.6 Mbps down, 750 Kbps up, 150 ms round-trip latency | Semantic route status remains visible; controls remain usable; no duplicate submit   |
| High latency       | 10 Mbps down, 2 Mbps up, 400 ms round-trip latency    | Pending text appears before completion; cancellation/retry remains available         |
| Intermittent       | Request disconnect or response loss during scoring    | Local proposal is retained; exact idempotency key reconciles accepted/lost response  |
| Offline            | Browser offline after a local scoring proposal exists | Recovery explains local state; new editor cannot overwrite it; no offline-first sync |

Scoring recovery has automated coverage for lost responses, stale source
revisions, exact retry keys, Account/game/setup mismatch, malformed storage,
offline/retry classification, and prevention of local-draft overwrite.

Games and reports now have route-level semantic loading feedback with
`aria-busy`, a polite atomic status, and reduced-motion behavior. Export and
import validation announce pending state immediately, disable duplicate
submits, allow cancellation through `AbortController`, retain concise retry
guidance, and never imply an import mutation. Fetch cancellation is
client-side; the server may safely finish an already-started export or
validation audit.

The profiles above were reviewed against state transitions and automated
recovery tests. This pass did not capture throttled browser network traces, so
transferred-byte and server-response claims are limited to production artifacts
and controlled local work.

## Data-volume profiles

All profiles use synthetic data:

| Profile                     | Representative volume                                            | Evidence                                                        |
| --------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------- |
| Empty season                | 0 games and 0 qualified players                                  | Dashboard empty-state tests                                     |
| Small season                | 1–5 games                                                        | Domain dashboard and persistence fixtures                       |
| Ordinary season             | 25 games, ordinary lineups, current verified/corrected histories | Existing M3 dashboard service/domain suites                     |
| Larger valid season         | 100 games, the repository read ceiling                           | Controlled dashboard measurement                                |
| Long game history           | 75 accepted scoring events with evidence verification            | Controlled replay measurement                                   |
| Many leaderboard candidates | Unique per-game synthetic player lines across 100 games          | Controlled dashboard measurement                                |
| Multi-page report           | Repeating table headers and non-breaking stat blocks             | Print component/CSS regression tests; physical preview deferred |
| Large accepted export       | Bounded by 5 MiB and 10,000 total records                        | Export/import limit and round-trip tests                        |
| Import near record limit    | 9,000 records, 899,606 encoded bytes                             | Controlled import-validation measurement                        |

The dashboard source read is capped at 100 games, recent games at 20, each
leaderboard at 10, and selection choices at 100. The portable format is capped
at 5 MiB and 10,000 records. Full current event history must still be replayed
for correctness; a pathological game with far more than the measured 75 events
is a nonblocking profiling risk, not silently truncated data.

## Performance budgets

Budgets are release thresholds, not claims that every latency was measured in
this local pass. “Feedback” means pending/status text rendered from the client;
“complete” means authoritative response and reconciliation.

| Workflow                        | Budget                                                                                             |
| ------------------------------- | -------------------------------------------------------------------------------------------------- |
| Initial application shell load  | Client JavaScript ≤ 35 KiB gzip; local production server response median ≤ 500 ms / p95 ≤ 1,000 ms |
| Game setup load                 | Client JavaScript ≤ 120 KiB gzip; response median ≤ 1,000 ms / p95 ≤ 2,000 ms                      |
| Live scoring route load         | Client JavaScript ≤ 285 KiB gzip; response median ≤ 1,200 ms / p95 ≤ 2,500 ms                      |
| Accepted routine scoring action | Local preview p95 ≤ 50 ms; feedback ≤ 100 ms; normal completion p95 ≤ 2,000 ms                     |
| Complex runner play             | Local preview p95 ≤ 100 ms; feedback ≤ 100 ms; normal completion p95 ≤ 2,500 ms                    |
| Correction submission           | Local preview p95 ≤ 250 ms; feedback ≤ 100 ms; normal completion p95 ≤ 3,500 ms                    |
| Season dashboard load           | Client JavaScript ≤ 35 KiB gzip; 100-game response median ≤ 1,500 ms / p95 ≤ 3,000 ms              |
| Leaderboard filter change       | Feedback ≤ 100 ms; 100-game response median ≤ 1,500 ms / p95 ≤ 3,000 ms                            |
| Box-score load                  | Client JavaScript ≤ 35 KiB gzip; response median ≤ 1,200 ms / p95 ≤ 2,500 ms                       |
| Printable report render         | Client JavaScript ≤ 35 KiB gzip; response median ≤ 1,500 ms / p95 ≤ 3,000 ms                       |
| Export request initiation       | Feedback ≤ 100 ms; ordinary completion p95 ≤ 5,000 ms; 5 MiB ceiling completion p95 ≤ 15,000 ms    |
| Import validation feedback      | Feedback ≤ 100 ms; ordinary completion p95 ≤ 5,000 ms; near-limit completion p95 ≤ 15,000 ms       |

Constrained-mobile/high-latency completion allows two times the normal response
budget, while immediate feedback budgets remain unchanged. A timeout or network
failure must end with useful retry guidance and no duplicate scoring event or
import mutation.

Hosted server-response, web-vital, layout-shift, transferred-byte, and long-task
measurements are required before a production SLO is declared. They are not
invented here.

## Controlled measurements

The controlled synthetic workload produced:

| Workflow                                      | Samples | Median (ms) | P95 (ms) |
| --------------------------------------------- | ------: | ----------: | -------: |
| Routine scoring preview                       |     200 |       0.003 |    0.006 |
| Complex runner preview                        |     200 |       0.001 |    0.002 |
| Correction preview                            |     100 |       0.336 |    0.589 |
| 75-event evidence-verified replay             |      10 |      90.082 |   93.006 |
| 100-game, many-candidate dashboard derivation |      20 |       3.083 |    3.300 |
| 9,000-record portable import validation       |       5 |      11.431 |   12.119 |

These are in-process CPU measurements with data already in memory. They exclude
database, network, React hydration, browser painting, and assistive-technology
announcement latency. The 75-event replay includes source-evidence
verification. Dashboard derivation includes stable ranking and output bounds.
Import validation includes UTF-8/JSON/schema/checksum/count/reference/duplicate
checks for the synthetic artifact but has no target database conflicts.

## Bundle findings

The optimized production artifact measured:

| Route                   | Raw bytes | Gzip bytes | Gzip budget |
| ----------------------- | --------: | ---------: | ----------: |
| Application shell       |    63,851 |     16,808 |      35,000 |
| Game setup index        |   355,100 |     83,283 |     120,000 |
| Game setup editor       |   370,051 |     86,304 |     120,000 |
| Live scoring            |   886,072 |    235,212 |     285,000 |
| Box score               |    66,926 |     17,934 |      35,000 |
| Season dashboard        |    63,851 |     16,808 |      35,000 |
| Player summary          |    63,851 |     16,808 |      35,000 |
| Printable season report |    64,259 |     17,121 |      35,000 |
| Portable data tools     |    70,915 |     19,125 |     110,000 |

Application CSS is 30,210 raw bytes against an 80,000-byte budget.

The audit found an unused root `QueryClientProvider`. No source used React
Query, yet the provider forced every route through a client boundary and added
the library to every route manifest. Removing that boundary and the unused
production dependency reduced the application shell and server-rendered
dashboard by 24,418 raw / 7,158 gzip bytes and reduced the live-scoring route
from 910,490 raw / 242,370 gzip bytes to 886,072 raw / 235,212 gzip bytes.

Reporting statistics and printable report code remain server-only. The bundle
gate rejects scoring manifests containing portable-data tools, printable
reports, season-dashboard code, or React Query. There is no chart library,
client statistic library, image fixture, or portable-file parser in the live
scoring route.

The combined live-scoring editor remains the largest client surface. It is
inside the initial M3 budget but remains a candidate for measured route-level
splitting after a hosted low-end-device trace; correctness and recoverability
must not be weakened merely to reduce the manifest.

## Query findings

Account predicates, deterministic ordering, and existing indexes were reviewed
for recent games, dashboard sources, leaderboard/player derivation, print,
export, and import conflict detection.

- Dashboard choices are bounded to 100 and use Account/archive predicates.
- Dashboard game sources are bounded to 100, ordered by scheduled date and ID,
  and load privacy overlays plus accepted setup identity once.
- Accepted histories batch setups, events, and correction relationships in
  three queries before strict replay; they do not query once per game.
- Reports reuse current histories and canonical derivation rather than
  rebuilding separate client projections.
- Import conflict detection uses bounded logical IDs and Account-scoped
  lookups.
- Relevant existing keys include Account/season/status, Account/team-season/date,
  Account/game/setup/sequence, Account/scope/status, and Account privacy-field
  indexes.

The material export finding was a presentation N+1: each ready game previously
opened its own transaction and read game, setup, all Account privacy overlays,
and projection checkpoint. Export now requests all exact game/setup pairs in
one bounded Account-scoped transaction. It performs four presentation query
shapes regardless of ready-game count: games, setups, privacy overlays, and
checkpoints. Exact game/setup association, source revision, privacy revision,
and current checkpoint checks remain fail-closed. The single-game box-score API
delegates to the same batch implementation.

No index was added. Existing access paths match the bounded queries, and this
pass had no hosted production-like dataset or `EXPLAIN (ANALYZE, BUFFERS)`
evidence that would justify a forward migration.

## Accessibility automation

The existing required `verify` workflow now repeats:

- semantic headings, captions, column headers, and row headers;
- one skip link and focusable main landmarks;
- 44 CSS pixel source-button minimums;
- form labels, native keyboard controls, accessible names, and concise errors;
- focus movement to asynchronous success/failure results;
- polite status and assertive alert behavior;
- game-state/base-state text equivalents and no color-only state;
- report chart-equivalent text and printable table semantics;
- route loading status and reduced-motion fallback;
- export/import file labeling, file type/size help, cancellation, and dry-run
  messaging;
- zoom, safe areas, forced colors, focus visibility, responsive table
  containment, and absence of fixed scoring controls;
- separate exact export/import capabilities and report/data isolation from
  scoring bundles.

ESLint/Next rules, server-rendered component tests, source-contract tests,
domain replay/interaction tests, persistence integration tests, the controlled
measurement harness, and production bundle budgets provide complementary
evidence. There are no custom application dialogs in these workflows, so a
dialog focus-return contract is not applicable. Native print UI is controlled
by the browser.

An automated browser accessibility engine was not added because no stabilized,
authenticated browser test harness exists in the repository. Source-only
checks are intentionally described as contracts, not as a substitute for
browser accessibility scans.

## Manual accessibility review

The structured review produced this evidence:

| Task                     | Keyboard/screen-reader-oriented result                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------- |
| Select team and season   | Native labelled select/date controls; source-order submit; one main heading and filter landmark         |
| Inspect leaderboard      | Heading per leaderboard; caption; column and row headers; rank/rate/sample text; descriptive links      |
| Open player summary      | Descriptive player and source-game links; heading hierarchy; version/freshness text                     |
| Print report             | Native button, keyboard activation, semantic tables, repeating headers, textual report status           |
| Request export           | Dedicated named form; immediate status; duplicate submit disabled; cancellable request; safe-file note  |
| Validate invalid import  | Labelled native file input; type/size help; assertive concise error; structured location when available |
| Resolve file errors      | Focus moves to result; long locations wrap; file remains selectable for correction/retry                |
| Return to scoring        | Primary navigation remains in native tab order; no route code or state is loaded into scoring eagerly   |
| Score a play             | Native buttons/selects, pressed state, proposal review, pending status, exact authoritative revision    |
| Recover interrupted save | Polite recovery status; exact retry/reconcile/discard choices; result focus; no draft overwrite         |

Logical focus follows DOM order. No custom keyboard trap, modal, drag-only
interaction, chart-only fact, color-only status, or inaccessible hidden file
input was found. Wide tables use local scrolling and retain captions. Error and
success results are focusable but are not inserted as tabbable controls.

This was code/markup review plus automated component evidence, not a VoiceOver,
NVDA, JAWS, TalkBack, or participant session. Announcement verbosity during
rapid scoring, browser print-dialog behavior, and focus return after the native
print dialog require physical assistive-technology validation.

## Defects fixed

| Finding                                                                             | Severity | Fix                                                                                                      | Regression evidence                                          |
| ----------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Unused React Query provider/dependency hydrated every route and enlarged all routes | High     | Removed the unused provider and package; preserved server/client component boundaries                    | Production route budgets and prohibited-module checks        |
| Export presentation loading executed four query shapes per ready game               | High     | Added one bounded Account-scoped batch transaction and reused it for single-game presentation reads      | Service source contract plus persistence batch equivalence   |
| Slow dynamic routes could remain blank without semantic progress                    | High     | Added route-level game/report/data status, `aria-busy`, polite atomic text, and reduced-motion fallback  | Server-rendered accessibility contract                       |
| Export/import endpoints had no accessible user workflow                             | High     | Added separately authorized export and dry-run validation forms with focus, errors, cancellation, limits | SSR/source contract and existing route/security/domain tests |
| Bundle growth had no repeatable required threshold                                  | High     | Added explicit route/CSS budgets and route-isolation checks                                              | Production artifact budget evidence                          |
| Performance observations were not reproducible across representative volumes        | Medium   | Added fixed synthetic profiles with median/p95 output                                                    | Controlled production-shaped measurement                     |

No domain calculation, migration, public sharing, import promotion, deployment,
or production monitoring behavior was added.

## Remaining limits

Nonblocking limitations:

- no authenticated hosted browser response, hydration, web-vital, layout-shift,
  long-task, or throttled-network capture;
- no physical phone/tablet, virtual-keyboard, or screen-reader session;
- no automated browser accessibility engine;
- no physical multi-page print-preview matrix;
- the 235,212-byte gzip live-scoring route needs hosted low-end-device
  profiling before safe code-splitting decisions;
- full correct replay means a pathological individual game history is not
  silently truncated;
- export is an ephemeral download and import remains validation/dry-run only;
- cancellation cannot revoke server work that already completed safely;
- public sharing, cross-Account transfer, background jobs, and offline-first
  synchronization remain unsupported.

## Production monitoring

Database release budgets, representative scoring/report/dashboard datasets,
and highest-cost query paths are defined in
`PERFORMANCE_AND_LOAD_BUDGETS.md`. Production monitoring still must collect:

- hosted real-user web-vital and interaction monitoring;
- server/database latency percentiles and sanitized query telemetry using the
  established workload boundaries;
- production `EXPLAIN` evidence and index changes where justified;
- error-rate, timeout, export-size, and validation-duration dashboards;
- tested deployment rollback, alerting, and incident response;
- physical device/assistive-technology release validation;
- offline-first synchronization or background portability jobs.
