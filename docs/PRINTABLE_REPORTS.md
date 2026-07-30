# Printable reports

## Scope

Issue #25 adds authorized browser-print presentations for:

- an individual game box score;
- a player season summary; and
- a combined team-season and qualified-leader summary.

“Shareable” means that an authorized viewer can review and print the report.
There is no anonymous route, bearer link, hosted public artifact, PDF service,
or export format in this work. Issue #26 owns downloadable portable exports.

## Routes and authorization

| Report          | Route                                                          | Required target and capability                                                                      |
| --------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Game            | `/games/{gameId}/box-score/print`                              | exact Account/Game `report.view` and the same exact-game view boundary used by the source box score |
| Team and season | `/reports/season/print?teamId=…&seasonId=…`                    | exact Account/Season `report.view`, with the selected Team present in the resolved target           |
| Player season   | `/reports/season/players/{playerId}/print?teamId=…&seasonId=…` | exact Account/Season `report.view`, with the selected Team present in the resolved target           |

The selected Account still comes from the protected Account preference cookie.
Identifiers in a URL are selectors, never authorization. Missing, foreign,
archived, or unauthorized resources fail without revealing whether another
Account owns them. A public or unauthenticated report route is intentionally
absent.

## Read-model reuse

Print components receive typed, already-derived reports:

- game print uses the issue #22 `GameBoxScore`;
- team, season, leader, and player print use the issue #24
  `SeasonDashboard`.

The components format existing counters and exact rates. They do not replay
events, query Prisma, aggregate a second statistic model, or reinterpret
corrections. Game and season services retain their one-retry source-revision
check and then fail safely, so print HTML is never a stale cache.

## Metadata and state

Every report visibly includes:

- report type and page title;
- privacy-resolved team, season, and player names;
- generated time, clearly distinguished from source or game time;
- source-revision count or exact game source revision;
- statistic derivation and privacy-overlay revisions;
- verification and freshness policy; and
- correction state.

Game reports print the exact lifecycle state: draft, in progress, suspended,
completed, corrected, awaiting reverification, verified, abandoned, or
cancelled. Season reports explicitly count corrected games awaiting
reverification, incomplete games, and terminated games. Official season totals,
leaders, and player statistics continue to include verified games only.

## Print allowlist

The rendered allowlist contains only:

- privacy-resolved display names;
- season and game presentation labels;
- dates, score, lifecycle, verification, and correction summaries;
- derived baseball counters and rates;
- documented leaderboard sample sizes and minimums; and
- non-secret freshness/version numbers useful for report auditing.

It excludes internal Account IDs, actor or membership IDs, email and contact
data, invitations, tokens, audit rows, correction explanations, raw events,
raw payloads, private notes, infrastructure identifiers, and hidden data
containers. No sensitive value is placed in CSS-generated content, data
attributes, comments, or hidden DOM.

## Paper and screen behavior

The print stylesheet uses named US-letter pages:

- game and team-season reports use landscape orientation because their tables
  are dense;
- player reports use portrait orientation;
- landscape pages use 0.45-inch margins and portrait pages use 0.55-inch
  margins.

Tables retain semantic captions and headers. Browser-supported print engines
repeat table header groups. Rows, player blocks, and major report sections avoid
page breaks where practical. Print overrides remove minimum table widths and
horizontal overflow so columns are not clipped. Screen preview retains local
horizontal scrolling.

Print output uses black text, visible black borders, transparent backgrounds,
and no status meaning that depends on color. Interactive print controls are
removed from paper. The native button remains keyboard accessible and has the
repository touch-target size on screen.

## Regression coverage

Focused component and source-contract tests cover:

- stable representative game, season, and player markup;
- generated, lifecycle, correction, verification, revision, and season
  metadata;
- long display labels and multi-row reports;
- semantic captions, column headers, and row headers;
- letter page rules, portrait/landscape selection, margins, repeated headers,
  grayscale overrides, page-break controls, and unclipped print tables;
- print-action keyboard semantics and mobile screen overflow;
- explicit sensitive-field omission; and
- exact authorization with no anonymous/public route.

Extra-inning, correction, incomplete, stale-source, privacy-overlay, Account
isolation, and reconciliation behavior remain covered at the reused issue #22
and #24 read-model/service boundaries instead of being recalculated in print
tests.

## Export boundary

Print HTML is an authorized presentation, not a portable interchange format.
It must not be scraped or treated as the issue #26 export contract. A future
export must have its own `report.export` authorization, current-membership and
freshness checks, explicit schema/version manifest, size limits, spreadsheet
injection defenses where applicable, and revocation/retention policy.
