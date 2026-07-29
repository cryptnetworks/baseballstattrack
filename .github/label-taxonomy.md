# GitHub taxonomy and planning blueprint

The repository has a materialized issue taxonomy, five dated milestones, and a live Projects v2 delivery board. Keep labels lowercase except for size labels, and use one type, one or more areas, one priority, one status, and one size on planned issues.

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

## Projects v2 delivery board

- Board: [Baseball Stat Track Delivery](https://github.com/users/cryptnetworks/projects/4)
- Repository: https://github.com/cryptnetworks/baseballstattrack
- Views: Table (open issues), Board (workflow by Status), Roadmap (roadmap planning), My Work (assignee filter).
- Fields: Status, Priority, Type, Area, Target, Size, plus GitHub's built-in issue fields.
- The board contains the 37 canonical roadmap and planning issues (#1–#34, #51, #67, #68).
- Use milestone dates for roadmap targets; use the custom Target field for filtering and grouping.

The issue, milestone, security, and project trackers are live. GitHub's built-in Status field currently provides Todo, In Progress, and Done; blocked/needs-design/needs-review/ready remain labels for finer triage.
