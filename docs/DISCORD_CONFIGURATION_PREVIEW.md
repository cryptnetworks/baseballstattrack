# Discord configuration preview and test delivery

Issue #113 adds a fail-closed preflight workspace for the complete saved
Discord configuration. The preview uses only synthetic data and managed public
identifiers. It never reads a game, exposes Discord guild/channel IDs, or lets
the browser submit an arbitrary provider destination.

## Pre-save compatibility contract

Every complete settings write continues through the versioned Zod boundary.
When delivery is enabled, the boundary rejects a configuration unless it has a
tracked team-season and a destination purpose for every selected trigger:

- live game triggers require `LIVE_UPDATES`;
- completion and verification require `FINAL_SCORES`;
- accepted corrections require `CORRECTIONS`;
- report readiness requires `SUMMARIES`;
- operational failures require `ERRORS`; and
- an enabled digest requires `DIGESTS`.

Quiet hours also cannot cover the entire configured game-day window. Paused
configurations may remain incomplete while an administrator stages them, but
the same checks block enablement. Enum schemas reject unknown cadence modes,
triggers, strategies, and formats before persistence. Event-driven cadence is
rejected with periodic-summary strategy because it has no batching interval;
administrators must choose fixed, manual, or digest scheduling.

The Preview workspace repeats the effective worker validation as five explicit
checks: channels/permissions, tracked teams, schedule, triggers/routing, and
format. It identifies inaccessible selected destinations, aggregate missing bot
permissions, permission evidence older than five minutes, unsupported stored
settings, and missing purpose routes. Recovery links return to the relevant
settings workspace.

## Synthetic message preview

The workspace renders representative live, final, correction, and operational
error messages through the same deterministic content planner used by the
worker. Every message begins with
`[PREVIEW — SYNTHETIC DATA — NOT A LIVE UPDATE]`, uses fictional teams and
scores, and remains within Discord's 2,000-character hard limit. Rendering a
preview does not contact Discord.

Opening a preview requires exact-Account `discord.settings.preview`, consumes
the administration rate limit, and writes `discord.settings.preview` to the
Account security audit log. Audit metadata contains only settings revision,
error/warning counts, and the synthetic-data classification.

## Test delivery boundary

A test can target only a saved destination that is still enabled and has
current View Channel and Send Messages evidence. The server resolves its raw
provider identity after authorization; the browser receives only an opaque
destination UUID and display name. The fixed payload starts with
`[TEST ONLY — SYNTHETIC — NOT A LIVE UPDATE]`, disables Discord mentions, and
contains no game or player data.

Test sends use `discord.settings.preview`, the administration rate limit, and
the existing success/failure audit record. They are attempted once and are
never converted into worker evaluations, retried deliveries, or live game
updates.
