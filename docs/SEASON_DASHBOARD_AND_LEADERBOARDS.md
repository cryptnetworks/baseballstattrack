# Season dashboard and leaderboards

## Scope

Issue #24 adds an authorized, Account-scoped season dashboard for one team and
season. It presents the official team record, recent games, batting, pitching,
and fielding leaders, a textual verified-game trend, player season summaries,
and links back to the source game box scores. It does not add public sharing,
cross-Account comparisons, predictive analytics, arbitrary report building,
caching, or M4 integration work.

## Read-model architecture

The implementation follows one explicit boundary:

1. The page resolves the selected Account from the existing preference cookie.
2. `AuthorizationService` authorizes `report.view` against current database
   membership and the Account or selected Season.
3. `PrismaSeasonDashboardRepository` resolves a bounded, deterministic
   team-season selection and at most 100 current game sources.
4. `PrismaGameEventRepository` loads each exact accepted setup and immutable
   source history and verifies its replay evidence.
5. `deriveGameStatistics` rebuilds every game from current effective history
   using the current statistic derivation library.
6. `buildSeasonDashboard` applies the official-inclusion, minimum, record,
   ordering, and reconciliation rules and calls `deriveSeasonStatistics`.
7. The server page renders the typed read model. Client components never query
   Prisma or calculate baseball statistics.

The service compares every derived source revision with the revision read for
the game. If any game changes during generation, it reloads the bounded source
set once and then fails safely rather than presenting a mixed revision.

## Inclusion rules

The lifecycle policy is explicit:

| Game state                            | Recent games | Official record | Counting/rate statistics | Leaderboards | Trends |
| ------------------------------------- | ------------ | --------------- | ------------------------ | ------------ | ------ |
| Ready/draft-like accepted setup       | Yes          | No              | No                       | No           | No     |
| In progress                           | Yes          | No              | No                       | No           | No     |
| Suspended                             | Yes          | No              | No                       | No           | No     |
| Completed, not verified               | Yes          | No              | No                       | No           | No     |
| Verified                              | Yes          | Yes             | Yes                      | Yes          | Yes    |
| Corrected, awaiting reverification    | Yes          | No              | No                       | No           | No     |
| Abandoned                             | Yes          | No              | No                       | No           | No     |
| Cancelled with an accepted setup      | Yes          | No              | No                       | No           | No     |
| Draft without an accepted ready setup | No           | No              | No                       | No           | No     |

This matches the canonical statistic contract: verified games are official by
default. A corrected verified game becomes unverified until a new accepted
verification event. The dashboard displays that state as “corrected awaiting
reverification” and never retains its previous official totals.

The optional date range applies consistently to recent games, official totals,
leaderboards, player summaries, and trends. A date-only through value includes
the full UTC date. Unscheduled games appear only when no date boundary is
active. The repository returns at most 100 source games and the recent-games
view shows the newest 20 using scheduled time and stable game ID ordering.

## Record calculation

The record uses the selected team side from the immutable accepted game-team
snapshot. It uses the result derived from effective event history:

- the selected side of `HOME_WIN` or `AWAY_WIN` is a win;
- the opposite side is a loss;
- `TIE` is a tie where the recorded ruleset supports it;
- all unverified or undecided states are outside the official record.

There is no mutable final-score authority. Extra innings require no special
nine-inning assumption because the game projection supplies its effective
inning ledger and outcome.

Incomplete, abandoned, cancelled, and corrected-awaiting-reverification counts
are displayed separately. They are not folded into wins, losses, or ties.

## Leaderboard minimums and denominators

The product defaults are configurable at the pure read-model boundary:

- batting average: at least 10 plate appearances;
- earned-run average: at least 9 pitching outs (3.0 innings);
- fielding percentage: at least 5 fielding chances.

These are transparent product defaults, not claims about universal league
qualification. Every ranked row displays its sample size. Players below a
minimum remain available in player summaries but do not appear in that ranking.

Rates reuse the canonical exact rational calculations:

- batting average uses hits / at-bats;
- ERA uses earned runs × 27 / pitching outs;
- fielding percentage uses (putouts + assists) / chances.

Zero-denominator rates remain undefined and render as an em dash. Presentation
strings never feed a calculation. Batting and fielding rank descending; ERA
ranks ascending. Equal rates use sample size, privacy-resolved display name,
and stable player ID as deterministic tie breakers.

## Corrections, verification, and freshness

Every dashboard build uses:

- exact Account;
- exact Team and Season;
- accepted setup snapshot and setup revision for each game;
- current source revision and correction-effective history;
- recorded ruleset version;
- statistic derivation and statistic-rules versions;
- current Account privacy-overlay revision.

The read model reports the source revision of every included official game.
Mixed Account, team-season, derivation, or privacy revisions fail rather than
being coerced. A source revision that advances during generation triggers one
complete bounded retry and then a safe failure.

No stored aggregate is treated as authoritative. The dashboard currently
derives from source history and declares `CURRENT_SOURCE_DERIVED`. This favors
correctness over an unsafe cache. A future cache key must include Account,
Team, Season, all source or aggregate revisions, derivation version,
privacy-overlay revision, minimums, and date filters.

## Player summaries and historical identity

The season rollup groups by stable Account player ID. Display names are
resolved from the accepted lineup snapshot plus the latest applicable
append-only privacy overlay. Current mutable roster labels and jersey numbers
do not rewrite historical game identity.

Each summary shows verified batting, pitching, and fielding opportunities and
links to the exact source games in which the player appears. Players who do not
meet a leaderboard minimum remain visible here.

## Privacy and authorization

Every query includes the Account predicate. Selection reads require
Account-scoped `report.view`; a dashboard read additionally requires
`report.view` for the exact selected Season and one of its resolved Team IDs.
Possession of a Team, Season, Game, setup, or player identifier is not
authorization.

The display allowlist contains:

- team and season display names;
- opponent snapshot display name;
- privacy-resolved player display name;
- game date, lifecycle, score, and source link;
- derived baseball counters, rates, and version metadata.

It excludes birth/age fields, contacts, notes, medical data, authentication
data, invitations, tokens, raw source payloads, audit internals, and
infrastructure identifiers. Privacy overlays change display resolution only;
they never change baseball totals.

## Trends

The initial trend is deliberately descriptive: verified games in chronological
order with runs scored, runs allowed, and win/loss/tie text. The text list is
the authoritative chart equivalent and does not rely on color. It adds no
rolling prediction or small-sample forecast.

## Accessibility and responsive behavior

- The page has one focusable main landmark and semantic heading hierarchy.
- Filters use labelled native controls and a touch-sized submit action.
- Data tables provide captions, column headers, and row headers.
- Wide tables scroll inside labelled local containers rather than widening the
  page.
- Leader state, verification, and correction state are expressed in text, not
  color alone.
- Leader links move keyboard users to stable player-summary headings.
- Source-game links use descriptive text.
- Empty and partial-season states use visible status text.
- The layout collapses from desktop grids to source-ordered phone content and
  preserves browser zoom and the repository focus treatment.

## Performance and query bounds

Choice and game reads use deterministic ordering and hard bounds. Privacy
overlays are loaded once per dashboard source read. Accepted setup snapshots,
source events, play acceptance times, and correction relationships are loaded
in one bounded Account-scoped batch transaction, then every game is strictly
replayed and derived in memory. There is no per-game database fan-out,
client-side statistic library, chart dependency, or eager unbounded roster
query. Issue #27 owns measured query and bundle budgets against representative
season sizes.

## M3 extension points

Issue #25 should reuse this season read model and the existing game box score
for printable reports; print components must not recalculate statistics.
Issue #26 may reuse the version and minimum-field decisions, but export remains
a separately authorized portable artifact rather than dashboard HTML. Issue
#27 measures this route with empty, ordinary, and larger valid seasons and
hardens material responsive, accessibility, bundle, and query findings.
