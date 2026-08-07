# M9 UI product-quality audit

## Scope and starting point

This audit covers the authenticated application shell and the primary workflows
present in `src/app`: login and account selection, game setup and scorekeeping,
box scores, season reports and player reports, data tools, fantasy, Discord
operations, administration, settings, and service status. The M9 pass starts at
`e82ef93d1d3a909a1bfac8b6d41462341bf8f22b`.

The audit is presentation-only. Event vocabulary, statistical derivation,
authorization boundaries, account isolation, and API contracts remain outside
the change set.

## Findings

| Surface                                      | Finding                                                                                                                        | M9 treatment                                                                                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Application shell                            | Navigation was a single undifferentiated row; the current location and operational context were easy to miss on small screens. | Group the navigation around Scorekeeping, Reference, Operations, and Administration; use an explicit active state and a compact utility row. |
| Home                                         | The landing screen behaved like a marketing hero and did not provide a useful starting index.                                  | Replace the hero with an operations overview and high-frequency workflow links.                                                              |
| Game setup / scorekeeping                    | Primary actions and supporting actions had no shared visual hierarchy.                                                         | Establish shared action and page-header patterns while preserving all existing forms and actions.                                            |
| Reports / box scores                         | Tables were readable but repeated one-off wrappers and did not share a sticky, dense reference-table treatment.                | Add table tokens and documented table guidance; retain the existing semantic captions and scopes.                                            |
| Fantasy / Discord / administration           | Each workspace had locally consistent cards, but terminology and feedback styling varied.                                      | Document surface, feedback, empty, and permission patterns for incremental adoption.                                                         |
| Loading, empty, error, and permission states | Route loading states existed, but there was no shared vocabulary or presentation primitive.                                    | Add `EmptyState` and `FeedbackState` primitives and document when to use them.                                                               |
| Accessibility                                | Focus styling and skip navigation existed; keyboard and semantic table patterns were not documented as a product standard.     | Codify visible focus, minimum touch targets, captions, scopes, and reduced motion in the design-system guide and tests.                      |

## Component inventory

Existing reusable components include the application shell, status badges, route
loading, PWA connection/install prompts, game setup forms, scoring panels,
report print actions, fantasy management, Discord panels, and configuration
editors. Repeated patterns were primarily inline Tailwind class groups for page
headers, bordered surfaces, action links, feedback messages, and table wrappers.

The shared baseline introduced by M9 is intentionally small:

- `PageShell` — consistent main content width, focus target, and responsive inset.
- `SectionHeader` — eyebrow, title, description, and action alignment.
- `Surface` — the standard low-chrome content surface.
- `ActionLink` — primary, secondary, and quiet action hierarchy.
- `EmptyState` and `FeedbackState` — explicit recovery and outcome language.
- `Breadcrumbs` — a semantic hook for entity navigation as deeper player/team/game routes grow.

## Quality checklist for future screens

Every new screen should identify its location, primary action, authoritative
source or status, and next action when no data is available. Tables should use a
caption, `scope="col"`/`scope="row"`, right-align numeric values, and a wrapper
that permits horizontal scrolling on narrow viewports. Mutations retain their
existing server authorization and should expose success/error feedback using
the shared tones.

## M9 validation evidence

The shared primitive test (`tests/ui/product-ui.test.tsx`) covers semantic
landmarks, table captions and scopes, live feedback, touch-sized controls,
responsive navigation hooks, visible focus, and reduced-motion tokens. Existing
scorekeeping, PWA, report, fantasy, and configuration accessibility contracts
remain green in the full Vitest suite. Experience budgets, the production build,
and the PWA verifier also pass.

No authenticated browser backend was available in this environment, so this
pass does not claim pixel screenshots or assistive-technology output. The
responsive review matrix is documented in `UI_DESIGN_SYSTEM.md` for the next
connected-browser review at 390px, 768px, and 1440px.
