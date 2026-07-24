# Baseball Stat Track

A production-quality baseball scorekeeping and statistics platform for coaches and scorekeepers.

## Project status

The repository is in the foundation/planning phase. The first milestone is to agree on the domain model and delivery architecture before implementing product code.

## Product direction

The app will let a scorekeeper record a game pitch-by-pitch or play-by-play on phone, tablet, and desktop, then derive reliable batting, pitching, fielding, team, and season statistics from the recorded events.

The design should preserve the source events so a scoring correction can be audited and statistics can be recalculated without losing history.

The first usable release boundary, personas, MVP workflow, non-goals, success metrics, privacy assumptions, and unresolved product decisions are documented in [docs/PRODUCT_SCOPE.md](docs/PRODUCT_SCOPE.md).

## Planned delivery targets

1. Foundation — product decisions, architecture, repository governance, and local development.
2. Domain and data — teams, players, seasons, games, lineups, scoring events, and stat derivation.
3. Scorekeeping MVP — fast game entry, substitutions, corrections, save/replay, and box score.
4. Season experience — dashboards, player/team summaries, exports, and printable reports.
5. Operational readiness — authentication, authorization, observability, backups, performance, and release hardening.

See docs/ROADMAP.md, CONTRIBUTING.md, and SECURITY.md.

## Working agreement

- Keep issues small enough to review and deliver independently.
- Treat game events as the source of truth; derive aggregates from them.
- Validate baseball scoring rules in domain-level tests.
- Prefer accessibility, touch-friendly interactions, and offline-tolerant workflows.
- Never commit secrets or production data.

## Repository governance

The intended taxonomy, milestone plan, project-board layout, and security baseline are documented in .github/label-taxonomy.md and .github/branch-protection.md.
