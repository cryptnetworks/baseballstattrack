# GitHub taxonomy and planning blueprint

The repository has a materialized issue taxonomy, nine roadmap milestones, and a live Projects v2 delivery board. Keep labels lowercase except for size labels, and use one type, one or more areas, one priority, one status, and one size on planned issues.

## Labels

Type: type:epic, type:feature, type:task, type:bug, type:decision, type:docs.

Area: area:product, area:domain, area:data, area:scorekeeping, area:stats, area:reports, area:ui, area:auth, area:platform, area:security, area:quality.

Priority: priority:p0, priority:p1, priority:p2, priority:p3.

Status: status:blocked, status:needs-design, status:needs-review, status:ready.

Size: size:XS, size:S, size:M, size:L, size:XL.

## Defect workflow

Use `type:bug` for confirmed or suspected defects. The existing priority labels map directly to P0-P3 in [the defect policy](../docs/DEFECT_TRIAGE_AND_REGRESSION_POLICY.md). Reproduction state is recorded in the issue triage record because the current status labels describe planning state rather than every reproduction outcome:

- `status:needs-review` for intake, missing reproduction, and fixed-pending-verification;
- `status:ready` only after a reproducible defect has enough evidence and priority to schedule;
- `status:blocked` when an external dependency prevents reproduction or verification.

Severity labels are not currently materialized. If maintainers later need filterable severity labels, the recommended exact names are `severity:s0`, `severity:s1`, `severity:s2`, and `severity:s3`. Until those labels are deliberately created, record severity in the issue's triage comment and do not claim that a severity label was applied.

Reproduction outcomes such as duplicate, expected behavior, cannot reproduce, verified, and closed are recorded in the triage/verification comment and GitHub issue close reason. Do not overload priority labels as severity.

## Milestones

- M0 — Foundation — due 2026-08-14
- M1 — Domain and data — due 2026-09-18
- M2 — Scorekeeping MVP — due 2026-11-06
- M3 — Season experience — due 2026-12-18
- M4 — Production readiness — due 2027-02-05
- M5 — Integrations and ecosystem — due 2027-04-02 — native milestone 6
- M6 — Advanced analytics — due 2027-05-28 — native milestone 7
- M7 — Offline and mobile — due 2027-07-23 — native milestone 8
- M8 — League ecosystem — due 2027-09-17 — native milestone 9

## Projects v2 delivery board

- Board: [Baseball Stat Track Delivery](https://github.com/users/cryptnetworks/projects/4)
- Repository: https://github.com/cryptnetworks/baseballstattrack
- Views: Table (open issues), Board (workflow by Status), Roadmap (roadmap planning), My Work (assignee filter).
- Fields: Status, Priority, Type, Area, Target, Size, plus GitHub's built-in issue fields.
- The board contains the canonical roadmap and planning issues; expansion issues through #127 are assigned to their native M5–M8 milestones. Issue #96 tracks final reconciliation of board views and planning metadata.
- Use milestone dates for roadmap targets; use the custom Target field for filtering and grouping.

The issue, milestone, security, and project trackers are live. GitHub's built-in Status field currently provides Todo, In Progress, and Done; blocked/needs-design/needs-review/ready remain labels for finer triage.

## Expansion milestones

The next roadmap targets are defined here and in docs/ROADMAP.md. Native GitHub milestones M5–M8 are now available; issue #96 tracks final reconciliation.

- M5 — Integrations and ecosystem: owned by `@cryptnetworks` repository maintainers; primary epic #97 and Discord control-plane epic #108.
- M6 — Advanced analytics: owned by `@cryptnetworks` repository maintainers; primary epic #102.
- M7 — Offline and mobile: owned by `@cryptnetworks` repository maintainers; primary epic #100.
- M8 — League ecosystem: owned by `@cryptnetworks` repository maintainers; primary epic #106 and fantasy product epic #122.

For future issues, use the exact target prefix, corresponding Target metadata, and the matching native GitHub milestone.
