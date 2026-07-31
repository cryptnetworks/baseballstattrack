# Spray-chart and pitch-chart discovery

Issue #33 evaluates whether optional batted-ball and pitch-location capture can
support useful, explainable charts without turning the core scorekeeping flow
into a pitch-tracking product. This is a discovery decision, not an
implementation or permission to collect new data in production.

## Decision

The data model is viable for M6 only as a separate, versioned **observation
stream** linked to accepted scoring events. Observations are non-authoritative:
they do not change replay, outs, bases, runs, earned-run decisions, box scores,
or verification. Missing observations remain valid and expected.

Do not add coordinates or pitch sequences directly to the current
`PlateAppearanceRecorded` schema. Its strict payload and hash are canonical
baseball evidence. Expanding it would make optional capture part of core event
acceptance, complicate corrections, and risk delaying the scorer.

Existing M6 issue #104 is the appropriate implementation follow-up. No new
issue should be created. #104 should implement the observation boundary only
after its coordinate, authorization, privacy, correction, and performance
decisions are reviewed with the M6 epic (#102).

## Current capability and gap

The core plate-appearance event already records batter, pitcher, outcome,
runner movements, fielding credits, and one nullable batted-ball classification:
`GROUND_BALL`, `FLY_BALL`, `LINE_DRIVE`, `POP_UP`, or `BUNT`. That is enough for
traditional derived statistics and broad batted-ball-type counts, but not a
spray chart.

The current model records one atomic plate appearance, not individual pitches.
It has no pitch sequence, pitch result, pitch type, velocity, strike-zone
location, capture source, or observation confidence. A pitch chart therefore
requires new optional evidence rather than inference from the final outcome.

## Questions the first release may answer

The first release should stay descriptive:

- Which coarse field sectors received a batter's observed balls in play?
- How complete is that observed sample relative to eligible plate appearances?
- Which coarse strike-zone cells contain manually observed pitches, separated
  by called strike, swinging strike, ball, foul, and ball in play?
- Which observations came directly from a scorer and which classifications
  were later derived?

It must not claim exact defensive positioning, pitch quality, injury risk,
player potential, causality, or complete tendencies from sparse/manual data.
Every view discloses games observed, eligible opportunities, missingness,
ruleset, schema/derivation versions, and a minimum-sample warning.

## Proposed observation contract

Use an Account/game-scoped append-only table or stream with these common fields:

| Field                    | Purpose                                                                |
| ------------------------ | ---------------------------------------------------------------------- |
| internal observation ID  | database relationship; never a public authorization mechanism          |
| external UUID            | API/UI reference without exposing internal keys                        |
| Account and game IDs     | mandatory tenant scope and composite foreign keys                      |
| accepted source-event ID | links to the authoritative plate appearance; never changes its meaning |
| observation type/version | `BATTED_BALL_LOCATION` or `PITCH_LOCATION`, independently versioned    |
| ordinal                  | stable pitch/observation order within the linked plate appearance      |
| capture source           | initially `MANUAL`; automated/device sources require a new review      |
| confidence               | `OBSERVED` or explicitly `ESTIMATED`; never silently inferred          |
| actor and timestamp      | minimum accountable correction evidence                                |
| supersession link        | append-only correction; prior observations remain attributable         |

The public and derived contract exposes external IDs and aggregate samples, not
internal keys. Database constraints must enforce exact Account/game/source-event
scope, unique active ordinal per type, bounded coordinates/cells, immutable
identity, and append-only supersession. Observation writers reauthorize the
current game and membership independently from scoring acceptance.

### Batted-ball location

Start with a coarse, keyboard-addressable field-sector grid rather than
pretending a touch coordinate is measured distance. Store the observed sector
and optional normalized point separately:

- origin is home plate; positive depth points toward center field;
- horizontal direction is from the batting team's view;
- normalized coordinates are bounded and venue-independent, while any rendered
  park shape is a display projection;
- `battedBall` remains the authoritative observed trajectory classification on
  the plate-appearance event; chart code labels location as a separate
  observation; and
- foul territory, over-the-fence, and unknown/missed inputs are explicit, not
  forced into an in-play coordinate.

The M6 design must choose and document one coordinate system before persistence.
Changing coordinate interpretation requires a new observation version, never a
silent migration.

### Pitch location

Use a coarse labeled strike-zone grid for manual capture. Do not collect a
player's physical strike-zone height, body dimensions, video, velocity, spin,
GPS, or biometric/device data in the first release. Each optional pitch needs:

- ordinal within the accepted plate appearance;
- observed zone cell plus explicit `OUT_OF_ZONE`/`UNKNOWN` handling;
- pitch result from a bounded vocabulary;
- optional pitch classification only when directly observed; and
- `OBSERVED`/`ESTIMATED` confidence and schema version.

Because the final plate appearance is canonical, an incomplete pitch sequence
is allowed. Charts show completeness and never invent omitted pitches from the
count or outcome.

## Correction and derivation behavior

Observations are immutable and corrected through a superseding observation.
Reversing or replacing a linked plate appearance makes its old observations
ineligible for current charts; it does not delete them or reinterpret the
replacement. A scorer may attach new observations to the replacement event.

Chart projections include observation schema version, derivation version,
source revision, privacy-overlay revision, ruleset version, included-game set,
eligible opportunity count, observed count, and missingness. Rebuilds are
deterministic from effective observations and accepted event history. Sparse or
unsupported samples return a neutral state.

## Scorekeeping UX constraint

Core scoring is always submitted first. Observation capture is an optional
mode or a post-acceptance affordance with a prominent skip path. Its validation,
network request, outage, or retry cannot block or roll back the scoring event.

- Spray capture target: zero extra interaction when disabled; one optional
  field-sector interaction after a ball in play when enabled.
- Pitch capture: a separately enabled pitch-by-pitch mode, never inserted as a
  mandatory step into the existing plate-appearance form.
- Both modes support touch, keyboard, screen-reader labels, undo through
  supersession, visible pending/failure state, and reduced-motion/high-contrast
  rendering.
- The live-scoring bundle and interaction budgets remain authoritative; chart
  visualization code is route-split away from core scoring unless capture mode
  is enabled.

## Privacy and authorization review

Location observations are youth-adjacent sports history and remain inside the
Account privacy boundary. They require current `game.score` authority to write
and current report/game authority to read. No public chart, bearer link,
cross-Account comparison, or analytics-provider copy is implied.

The first release excludes names, contacts, age, notes, video/audio, device IDs,
IP-derived location, venue GPS, biometrics, and free text. APIs and telemetry use
strict allowlists. Player display names are resolved only at authorized render
time through the current privacy overlay and never duplicated into observation
payloads. User/player privacy execution follows the established overlay and
projection invalidation rules; authoritative observations remain opaque sports
evidence and are not exported without an explicit format/privacy review.

## Value, cost, and go/no-go gates

Spray capture has a favorable value-to-friction profile because one optional
post-play input can support a visible chart. Pitch capture is higher cost and
should ship only behind an Account/team disable path after representative
scorekeepers demonstrate that the separate mode does not increase scoring
errors, abandoned submissions, or time-to-accepted plate appearance.

Before #104 implementation is ready to release, it must prove:

1. versioned observation and supersession schemas with tenant/correction tests;
2. no change to canonical replay when observations are absent, malformed, or
   unavailable;
3. explicit completeness, confidence, sample size, and ruleset/derivation
   labeling;
4. privacy/authorization allowlists and a per-Account or team disable path;
5. accessible capture/chart interactions on supported phone and tablet sizes;
6. representative scoring and chart performance budgets; and
7. documented rollout, disable, retention, export, and recovery behavior.

If those gates cannot be met, retain the existing batted-ball classification
and do not ship coordinate or pitch capture.
