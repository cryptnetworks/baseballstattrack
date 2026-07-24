# GitHub taxonomy and planning blueprint

The connected GitHub integration used to initialize this repository does not expose label, milestone, or Projects mutations. Use this document as the canonical configuration to apply when those operations are available.

## Labels

Use lowercase, stable names.

Type: type:epic, type:feature, type:task, type:bug, type:decision, type:docs.

Area: area:product, area:domain, area:data, area:scorekeeping, area:stats, area:reports, area:ui, area:auth, area:platform, area:security, area:quality.

Priority: priority:p0, priority:p1, priority:p2, priority:p3.

Status: status:blocked, status:needs-design, status:needs-review, status:ready.

## Milestones

- M0 — Foundation: decisions, architecture, governance, and development baseline.
- M1 — Domain and data: schema, event model, calculations, and persistence.
- M2 — Scorekeeping MVP: game setup, live scoring, corrections, and box score.
- M3 — Season experience: dashboards, reports, exports, and accessibility polish.
- M4 — Production readiness: security, observability, performance, backup, and release readiness.

## GitHub Project layout

Create a Projects v2 board named Baseball Stat Track Delivery with columns Backlog, Ready, In progress, In review, Blocked, and Done.

Recommended fields: Status, Priority, Area, Target (M0–M4), Size (XS/S/M/L/XL), Start date, and Target date.

Recommended views: Board grouped by Status; Roadmap grouped by Target; Table filtered to open issues; My work filtered by assignee.
