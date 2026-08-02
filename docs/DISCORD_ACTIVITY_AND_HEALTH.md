# Discord activity and health

Issue #114 adds an operator-only activity workspace to the Discord control
plane. It reads existing durable installation, schedule, evaluation, and
delivery state; it does not introduce another heartbeat table or timestamp
authority.

## Health signals

The dashboard defines each timestamp from an existing authoritative record:

| Signal                   | Source                                                    |
| ------------------------ | --------------------------------------------------------- |
| Installation state       | `DiscordInstallation.status`                              |
| Last heartbeat           | newest explicit evaluation or delivery-attempt completion |
| Last statistics API read | newest successful evaluation completion                   |
| Last delivery            | newest successful `deliveredAt`                           |
| Next scheduled update    | `DiscordIntegrationSettings.nextScheduledEvaluationAt`    |

An absent value is shown as absent; the application does not invent a current
time or infer success. Evaluation and delivery failures remain current only
while their work is retryable/pending or dead-lettered. Resolved successful or
cancelled work does not keep a stale alert active.

Errors are separated into configuration, authorization, stale-statistics, and
Discord-delivery categories. The UI uses allowlisted remediation text and safe
failure codes; unrecognized database text becomes `UNKNOWN_FAILURE`. It never
renders message content, guild/channel/provider IDs,
credentials, tokens, worker identities, player data, or raw provider bodies.

## Access, history, and observability

The page first establishes `discord.settings.view` access to the Account and
installation selector, then independently requires Account-scoped
`discord.settings.operate` authority for activity. Repository lookup uses the
compound Account/external-installation identity and returns the same generic
unavailable result for missing and cross-Account installations.

Delivery history is ordered newest first and bounded to 25 records. Its public
UUID is the correlation identifier used by the Discord transport; only
operation, status, attempt count, safe failure code, and timestamps are
returned. Existing `discord_update_evaluation` and
`discord_update_delivery` M4 operational events remain the detailed diagnostic
source. The dashboard is a safe durable-state view, not a replacement for
alerts or logs.

The existing `(accountId, settingsId, ...)` delivery index supports the exact
Account/settings filter. No schema migration or extra index is added for the
small bounded result; this avoids write amplification and preserves the
forward-only Discord worker schema.
