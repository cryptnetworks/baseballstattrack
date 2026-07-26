# Product scope

This document defines the first usable release boundary for Baseball Stat Track. Later architecture, domain, data, security, and UX work should treat this as the product baseline unless a GitHub issue or ADR explicitly changes it.

## Users

Primary users:

- Scorekeeper: records game events quickly during live play, usually on a phone or tablet, with minimal time between pitches and plays.
- Coach: sets up teams, seasons, rosters, lineups, substitutions, and reviews box scores, season summaries, and player statistics.

Secondary users:

- Team administrator: manages team membership, access, and season organization when those duties are separate from coaching.
- Assistant coach: helps review reports, verify corrections, or score a game when the primary scorekeeper is unavailable.
- Read-only team viewer: may eventually view approved reports, but is not a first-release portal user.

Players, parents, league administrators, public spectators, and external data providers are important future audiences but are not direct MVP users.

## Core Problems

- Live scoring needs to be fast enough that the scorekeeper can keep up with play on a touch device.
- Corrections must be auditable so the game record remains trustworthy after a scoring mistake.
- Scores, box scores, and player or team statistics must be derived from recorded game events instead of manually maintained aggregate totals.
- Coaches need reliable postgame and season summaries without re-entering data in spreadsheets.
- Teams need secure access boundaries, especially when youth-player information is stored.

## MVP Workflow

1. A coach or team administrator creates a team, season, and roster.
2. A coach or scorekeeper creates a game with opponent, home or away designation, date, and basic game settings.
3. The scorekeeper configures the lineup, defensive positions, and starting pitcher.
4. During the game, the scorekeeper records event-level scoring actions, runner movement, outs, inning state, substitutions, and pitching changes.
5. If a mistake is found, the scorekeeper applies a correction that preserves the original record and records the reason for the change.
6. The application derives the current score, inning state, box score, and batting, pitching, fielding, team, and season statistics from the event record.
7. The coach reviews verified game and season reports and can identify incomplete, corrected, or unverified games.

## MVP Inclusions

- Team, season, and roster management.
- Game and lineup setup.
- Event-level scorekeeping with ordered, replayable game events as the source of truth.
- Runner advancement, outs, score, and inning state.
- Substitutions and pitching changes.
- Correction and audit history.
- Derived batting, pitching, fielding, team, and season statistics.
- Verified box scores and basic season summaries.
- Responsive web access for phone, tablet, and desktop browsers.
- Secure team-level access with server-side authorization for protected resources.

## MVP Exclusions

- Native iOS or Android applications.
- Full offline synchronization across devices.
- Parent or player portals.
- Live public spectator feeds.
- Spray charts and pitch charts.
- Advanced analytics beyond core baseball statistics.
- AI-generated summaries.
- League administration across many teams or organizations.
- Third-party data imports, exports, or integrations beyond basic first-party reports.
- Payment, billing, recruiting, messaging, or scheduling features.

## Device and Operating Assumptions

- The MVP is a responsive web application used on modern mobile, tablet, and desktop browsers.
- Scorekeeping interactions must be touch-friendly and usable on a phone in a dugout or stands.
- Desktop workflows may be denser for setup, review, and reporting, but must not become a separate product surface.
- Accessibility is part of the MVP quality bar: forms, controls, reports, and status states must be keyboard-accessible and screen-reader understandable.

## Connectivity Expectations

- The MVP is online-first: verified games and reports require server persistence.
- Brief interrupted connections should not silently lose accepted in-progress input on the same device.
- Pending saves, retry states, and unresolved failures must be visible and actionable before a game is treated as verified.
- Full offline game scoring, cross-device conflict resolution, and later synchronization are deferred and require a separate product and architecture decision.

## Ruleset Assumptions

- The baseline scoring model follows standard baseball semantics for plate appearances, baserunning, pitching, fielding, substitutions, outs, innings, and earned or unearned outcomes.
- The event vocabulary must be versioned so future league variations can be supported without rewriting historical games.
- First-release configurable boundaries may include inning count, home or away designation, roster eligibility, lineup order, defensive positions, pitching changes, and game completion state.
- Materially uncertain: exact support for continuous batting orders, free substitutions, mercy rules, time limits, extra-inning runners, pitch-count limits, and league-specific stat interpretations. Issue #4 owns the detailed scoring vocabulary and ambiguous-case decisions; accepted scoring semantics are documented in [SCORING_SEMANTICS.md](SCORING_SEMANTICS.md).

## Privacy Expectations

- Youth-player data must be minimized. Store only information needed for roster, scoring, access control, and reports.
- Birth year, contact information, notes, and exported reports require explicit handling rules before implementation.
- Team data must be isolated so one team cannot read or mutate another team's roster, games, events, reports, or exports.
- Public sharing is not part of the MVP. Any future public report must omit sensitive fields by default and require explicit authorization.
- Audit history must record scoring corrections and privileged actions without exposing unnecessary personal data.

## Success Metrics

Scoring speed:

- A trained scorekeeper can record a common plate appearance result in 10 seconds or less.
- A trained scorekeeper can record a runner advancement or out adjustment in 15 seconds or less.

Correction quality:

- A scoring correction records who changed what, when, and why.
- Replaying a corrected event stream produces deterministic score and stat outputs.

Reliability:

- A completed game can be replayed from its event sequence without manual aggregate edits.
- Pending save failures are visible before a game can be marked verified.

Report trust:

- Box score team totals reconcile with player totals and recorded events for representative fixtures.
- Coaches can identify whether a game is complete, corrected, or unverified from the report.

Usability:

- Game setup, scoring, correction, and report review are usable on phone, tablet, and desktop.
- A new contributor or tester can run the app and execute the verification suite from a clean checkout once the foundation milestone exits.

## MVP Completion Criteria

The MVP is successfully complete when a team can set up a season and roster, score a representative baseball game on a touch device, apply an auditable correction, verify a box score, and review basic player, team, game, and season statistics derived from the event record.

The release is not complete if core statistics require manual aggregate edits, corrected games cannot be replayed deterministically, team access boundaries are not enforced server-side, or brief save failures can be mistaken for verified data.

## Risks, Assumptions, and Open Questions

- Scoring complexity risk: ambiguous plays such as errors, fielder's choice, sacrifice plays, interference, double plays, and earned-run attribution may expand the event vocabulary. Issue #4 must resolve these before full scoring implementation.
- Persistence risk: event storage, derived projections, tenancy, migrations, seed data, and rollback rules are defined in [PERSISTENCE_AND_TENANCY.md](PERSISTENCE_AND_TENANCY.md). Production schema work remains deferred to M1.
- Security risk: youth-player data, team isolation, exports, and report sharing require a threat model before production data is accepted.
- Connectivity risk: online-first MVP expectations may still require local draft or pending-event recovery for scorekeeping confidence.
- UX risk: fast touch scoring may require iterative usability testing with real scorekeepers before the first release can be considered trustworthy.
- Product assumption: the first release serves one team's coaching and scorekeeping workflow well before expanding to league administration or public spectator experiences.
