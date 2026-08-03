type Environment = Readonly<Record<string, string | undefined>>;

function source(environment?: Environment): Environment {
  return environment ?? process.env;
}

/**
 * The only server-side boundary allowed to read deployment environment values.
 * Callers receive named, classified values rather than arbitrary environment
 * access. Non-secret Account behavior is deliberately absent.
 */
export function runtimeSecretConfiguration(environment?: Environment) {
  const value = source(environment);
  return Object.freeze({
    databaseUrl: value.DATABASE_URL,
    directDatabaseUrl: value.DIRECT_URL,
    authenticationEncryptionKey: value.AUTHENTICATION_ENCRYPTION_KEY,
    authentikClientSecret: value.AUTHENTIK_OAUTH_CLIENT_SECRET,
    googleOauthClientSecret: value.GOOGLE_OAUTH_CLIENT_SECRET,
    discordLoginClientSecret: value.DISCORD_LOGIN_CLIENT_SECRET,
    facebookOauthClientSecret: value.FACEBOOK_OAUTH_CLIENT_SECRET,
    appleOauthPrivateKey: value.APPLE_OAUTH_PRIVATE_KEY,
    webhookSigningMasterKey: value.WEBHOOK_SIGNING_MASTER_KEY,
    webhookWorkerToken: value.WEBHOOK_WORKER_TOKEN,
    externalIngestionWorkerToken: value.EXTERNAL_INGESTION_WORKER_TOKEN,
    externalDataProviderApiKey: value.EXTERNAL_DATA_PROVIDER_API_KEY,
    calendarFeedSigningKey: value.ICS_FEED_SIGNING_KEY,
    notificationWorkerToken: value.NOTIFICATION_WORKER_TOKEN,
    notificationEventToken: value.NOTIFICATION_EVENT_TOKEN,
    smtpUsername: value.SMTP_USERNAME,
    smtpPassword: value.SMTP_PASSWORD,
    notificationDiscordBotToken: value.NOTIFICATION_DISCORD_BOT_TOKEN,
    discordOauthClientId: value.DISCORD_OAUTH_CLIENT_ID,
    discordOauthClientSecret: value.DISCORD_OAUTH_CLIENT_SECRET,
    discordInstallationBotToken: value.DISCORD_INSTALLATION_BOT_TOKEN,
    discordOauthStateSecret: value.DISCORD_OAUTH_STATE_SECRET,
    discordUpdateEventToken: value.DISCORD_UPDATE_EVENT_TOKEN,
    discordUpdateWorkerToken: value.DISCORD_UPDATE_WORKER_TOKEN,
    discordStatisticsApiToken: value.DISCORD_STATISTICS_API_TOKEN,
    discordUpdateBotToken: value.DISCORD_UPDATE_BOT_TOKEN,
  });
}

export function deploymentConfiguration(environment?: Environment) {
  const value = source(environment);
  return Object.freeze({
    nodeEnvironment: value.NODE_ENV ?? "development",
    appEnvironment: value.NEXT_PUBLIC_APP_ENV ?? "local",
    siteUrl: value.NEXT_PUBLIC_SITE_URL,
    authenticationEnabledProviders:
      value.AUTHENTICATION_ENABLED_PROVIDERS ?? "",
    oauthCallbackUrl: value.OAUTH_CALLBACK_URL,
    externalDataProviderAllowedOrigin:
      value.EXTERNAL_DATA_PROVIDER_ALLOWED_ORIGIN,
    authentikIssuerUrl: value.AUTHENTIK_ISSUER_URL,
    authentikClientId: value.AUTHENTIK_OAUTH_CLIENT_ID,
    googleOauthClientId: value.GOOGLE_OAUTH_CLIENT_ID,
    discordLoginClientId: value.DISCORD_LOGIN_CLIENT_ID,
    facebookOauthClientId: value.FACEBOOK_OAUTH_CLIENT_ID,
    appleOauthClientId: value.APPLE_OAUTH_CLIENT_ID,
    appleOauthTeamId: value.APPLE_OAUTH_TEAM_ID,
    appleOauthKeyId: value.APPLE_OAUTH_KEY_ID,
    discordOauthRedirectUri: value.DISCORD_OAUTH_REDIRECT_URI,
    requiredDatabaseMigration: value.REQUIRED_DATABASE_MIGRATION,
    packageVersion: value.npm_package_version ?? "0.1.0",
  });
}

/** Values accepted only by the explicit one-time database seed path. */
export function legacyConfigurationEnvironment(
  environment?: Environment,
): Environment {
  const value = source(environment);
  return Object.freeze({
    FEATURE_ICS_CALENDAR_ENABLED: value.FEATURE_ICS_CALENDAR_ENABLED,
    FEATURE_EMAIL_NOTIFICATIONS_ENABLED:
      value.FEATURE_EMAIL_NOTIFICATIONS_ENABLED,
    FEATURE_DISCORD_NOTIFICATIONS_ENABLED:
      value.FEATURE_DISCORD_NOTIFICATIONS_ENABLED,
    FEATURE_DISCORD_UPDATES_ENABLED: value.FEATURE_DISCORD_UPDATES_ENABLED,
    ICS_FEED_DETAIL_LEVEL: value.ICS_FEED_DETAIL_LEVEL,
    NOTIFICATION_DESTINATIONS_JSON: value.NOTIFICATION_DESTINATIONS_JSON,
    SMTP_HOST: value.SMTP_HOST,
    SMTP_PORT: value.SMTP_PORT,
    SMTP_SECURE: value.SMTP_SECURE,
    SMTP_FROM: value.SMTP_FROM,
    NOTIFICATION_DISCORD_API_BASE_URL: value.NOTIFICATION_DISCORD_API_BASE_URL,
    DISCORD_INSTALLATION_CREDENTIAL_REFERENCE:
      value.DISCORD_INSTALLATION_CREDENTIAL_REFERENCE,
    DISCORD_INSTALLATION_API_BASE_URL: value.DISCORD_INSTALLATION_API_BASE_URL,
    DISCORD_INSTALLATION_TIMEOUT_MS: value.DISCORD_INSTALLATION_TIMEOUT_MS,
    DISCORD_STATISTICS_API_BASE_URL: value.DISCORD_STATISTICS_API_BASE_URL,
    DISCORD_UPDATE_API_BASE_URL: value.DISCORD_UPDATE_API_BASE_URL,
    EXTERNAL_DATA_PROVIDER_BASE_URL: value.EXTERNAL_DATA_PROVIDER_BASE_URL,
    RATE_LIMIT_POLICIES_JSON: value.RATE_LIMIT_POLICIES_JSON,
  });
}
