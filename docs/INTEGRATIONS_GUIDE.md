# Integrations guide

Use these guides to configure or extend an external boundary. Every integration
must preserve Account authorization, provenance, rate limits, failure handling,
and the repository's privacy rules.

## Baseball data and public APIs

- [External baseball data ingestion](EXTERNAL_DATA_INGESTION.md)
- [Integrations and partner API program](INTEGRATIONS_AND_PARTNER_API_PROGRAM.md)
- [Statistics read API v1](STATISTICS_API_V1.md)
- [API versioning and compatibility](API_VERSIONING_AND_COMPATIBILITY.md)

## Notifications and interoperability

- [Pull-only calendar feeds](CALENDAR_SYNCHRONIZATION.md)
- [Outbound notifications](OUTBOUND_NOTIFICATIONS.md)
- [Durable integration webhooks](WEBHOOKS.md)

## Discord setup and behavior

Start with [Discord installation and onboarding](DISCORD_INSTALLATION_AND_ONBOARDING.md),
then use the focused references below when configuring or operating the bot.

- [Discord settings contract](DISCORD_SETTINGS_CONTRACT.md)
- [Discord settings web UI](DISCORD_SETTINGS_WEB_UI.md)
- [Discord permissions and audit history](DISCORD_PERMISSIONS_AND_AUDIT.md)
- [Discord channel routing](DISCORD_CHANNEL_ROUTING.md)
- [Discord tracked teams, seasons, and games](DISCORD_TRACKED_SCOPES.md)
- [Discord update cadence and scheduling](DISCORD_UPDATE_CADENCE.md)
- [Discord update content and message strategy](DISCORD_UPDATE_CONTENT.md)
- [Discord update worker](DISCORD_UPDATE_WORKER.md)
- [Discord configuration preview and test delivery](DISCORD_CONFIGURATION_PREVIEW.md)
- [Discord activity and health](DISCORD_ACTIVITY_AND_HEALTH.md)
- [Discord end-to-end fixtures](DISCORD_END_TO_END_FIXTURES.md)
- [Discord control-plane deployment](DISCORD_CONTROL_PLANE_DEPLOYMENT.md)
