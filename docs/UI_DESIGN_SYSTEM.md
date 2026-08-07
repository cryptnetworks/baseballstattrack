# Baseball Stat Track UI design system

The interface is a research and operations tool. It favors information density,
stable orientation, and fast scanning over decorative treatment.

## Tokens

The source of truth for visual tokens is `src/app/globals.css`. Tokens cover:

- ink (`--foreground`), muted copy (`--muted`), and accent ink (`--accent-strong`)
- page background (`--background`), white content surfaces (`--panel`), and subtle surfaces
- quiet and strong borders (`--line`, `--line-strong`)
- semantic feedback (`--success`, `--warning`, `--danger`, `--info`)
- small, medium, and large radii plus a restrained shadow

Use the tokens rather than page-specific colors. One accent color marks active
navigation and primary actions; semantic colors are reserved for state.

## Layout and type

`PageShell` provides a `72rem` reading width with responsive 1rem/1.5rem insets.
`SectionHeader` establishes the page eyebrow, title, description, and action
alignment. Use one page title, then `h2` section headings and concise `h3`
subsections. The body type is Geist with a 1.5 line height; tabular numerics
should use the existing Geist Mono variable when precision matters.

## Surfaces and actions

Use `Surface` for a bounded group of related information. Surfaces have a thin
border, a small radius, and a light shadow; avoid nesting surfaces when a divider
will do. `ActionLink` and the matching `ui-action` classes provide three levels:

1. `primary` — the one action that advances the workflow.
2. `secondary` — safe navigation or supporting action.
3. `quiet` — low-emphasis utility action.

All controls retain a minimum 44px target and the global visible focus ring.

## Tables

Use `.ui-table-wrap` around `.ui-table`. Tables are dense by default, keep a
sticky header where the table is longer than one viewport, and remain horizontally
scrollable on mobile. Always include a meaningful caption, column/row scopes,
and right-align numeric columns. Do not hide authoritative values behind charts.

## State and copy

`EmptyState` must explain what is missing and provide a next action when one is
available. `FeedbackState` uses `success`, `info`, `warning`, or `error`; error
copy should say what the operator can do next. Permission states explain the
required capability without exposing data. Loading states should describe the
work in progress and must not shift the page layout unexpectedly.

Use baseball terms (game, season, roster, box score, plate appearance, verified)
and short action labels. Avoid generic SaaS phrases, inflated claims, and
unsupported scouting or predictive language.

## Responsive and accessibility baseline

The shell and all primary workflows are usable at mobile, tablet, and desktop
widths. Navigation may scroll horizontally; tables may scroll within their own
wrapper; the page itself must not overflow. Keep semantic headings, captions,
labels, live regions, keyboard order, and reduced-motion behavior. Visual review
should cover login, overview, game setup, live scoring, box score, season report,
fantasy, and administration at 390px, 768px, and 1440px widths.
