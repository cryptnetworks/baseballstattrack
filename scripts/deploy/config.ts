import { randomBytes } from "node:crypto";
import { chmod, mkdir, open, rename } from "node:fs/promises";
import { dirname } from "node:path";

import type {
  GeneratedDeploymentConfiguration,
  GeneratedSecrets,
  InstallationMetadata,
  InstallerAnswers,
  ProviderBootstrap,
} from "./contracts.ts";

const databaseIdentifier = /^[a-z][a-z0-9_]{0,62}$/u;
const accountSlug = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const imageTag = /^[a-z0-9][a-z0-9._-]{0,127}$/u;

function secret(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function generateSecrets(): GeneratedSecrets {
  return Object.freeze({
    databasePassword: secret(32),
    authenticationEncryptionKey: secret(32),
    webhookSigningMasterKey: secret(32),
    webhookWorkerToken: secret(32),
    externalIngestionWorkerToken: secret(32),
    calendarFeedSigningKey: secret(32),
    notificationWorkerToken: secret(32),
    notificationEventToken: secret(32),
    discordUpdateEventToken: secret(32),
    discordUpdateWorkerToken: secret(32),
  });
}

function secureSiteUrl(value: string, mode: InstallerAnswers["mode"]) {
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (
    (url.protocol !== "https:" &&
      !(mode === "local" && url.protocol === "http:" && loopback)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "The site URL must use HTTPS, except loopback HTTP in local mode.",
    );
  }
  return url.origin;
}

function validateProvider(provider: ProviderBootstrap) {
  if (provider.provider === "local") {
    if (!provider.username?.trim() || (provider.password?.length ?? 0) < 16) {
      throw new Error(
        "Local authentication requires a username and a password of at least 16 characters.",
      );
    }
    return;
  }
  if (!provider.clientId.trim())
    throw new Error("The OAuth client ID is required.");
  if (
    provider.provider !== "apple" &&
    (provider.clientSecret?.trim().length ?? 0) < 16
  ) {
    throw new Error(
      "The OAuth client secret must contain at least 16 characters.",
    );
  }
  if (provider.provider === "authentik") {
    const issuer = new URL(provider.issuerUrl ?? "");
    if (issuer.protocol !== "https:" || issuer.username || issuer.password) {
      throw new Error(
        "The Authentik issuer must be a credential-free HTTPS URL.",
      );
    }
  }
  if (
    provider.provider === "apple" &&
    (!provider.teamId?.trim() ||
      !provider.keyId?.trim() ||
      !provider.privateKey?.trim())
  ) {
    throw new Error(
      "Apple authentication requires team ID, key ID, and private key.",
    );
  }
}

export function validateInstallerAnswers(
  answers: InstallerAnswers,
): InstallerAnswers {
  secureSiteUrl(answers.siteUrl, answers.mode);
  if (
    !Number.isInteger(answers.appPort) ||
    answers.appPort < 1 ||
    answers.appPort > 65_535
  ) {
    throw new Error(
      "The application port must be an integer from 1 through 65535.",
    );
  }
  if (!databaseIdentifier.test(answers.databaseName)) {
    throw new Error(
      "The database name must be a lowercase PostgreSQL identifier.",
    );
  }
  if (!databaseIdentifier.test(answers.databaseUser)) {
    throw new Error(
      "The database user must be a lowercase PostgreSQL identifier.",
    );
  }
  if (
    !answers.accountDisplayName.trim() ||
    answers.accountDisplayName.trim().length > 80
  ) {
    throw new Error(
      "The initial Account name must contain 1 through 80 characters.",
    );
  }
  if (!accountSlug.test(answers.accountSlug)) {
    throw new Error(
      "The Account slug must use lowercase letters, numbers, and interior hyphens.",
    );
  }
  if (!imageTag.test(answers.imageTag))
    throw new Error("The image tag is invalid.");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: answers.timezone }).format();
  } catch {
    throw new Error(
      "The timezone must be a valid IANA timezone, such as America/New_York.",
    );
  }
  validateProvider(answers.provider);
  return answers;
}

function providerEnvironment(provider: ProviderBootstrap) {
  const common: Record<string, string> = {
    AUTHENTICATION_ENABLED_PROVIDERS: provider.provider,
  };
  if (provider.provider === "local") {
    common.LOCAL_AUTH_USERNAME = provider.username!.trim().toLowerCase();
    common.LOCAL_AUTH_PASSWORD = provider.password!;
  } else if (provider.provider === "google") {
    common.GOOGLE_OAUTH_CLIENT_ID = provider.clientId;
    common.GOOGLE_OAUTH_CLIENT_SECRET = provider.clientSecret!;
  } else if (provider.provider === "authentik") {
    common.AUTHENTIK_ISSUER_URL = provider.issuerUrl!;
    common.AUTHENTIK_OAUTH_CLIENT_ID = provider.clientId;
    common.AUTHENTIK_OAUTH_CLIENT_SECRET = provider.clientSecret!;
  } else if (provider.provider === "discord") {
    common.DISCORD_LOGIN_CLIENT_ID = provider.clientId;
    common.DISCORD_LOGIN_CLIENT_SECRET = provider.clientSecret!;
  } else if (provider.provider === "facebook") {
    common.FACEBOOK_OAUTH_CLIENT_ID = provider.clientId;
    common.FACEBOOK_OAUTH_CLIENT_SECRET = provider.clientSecret!;
  } else {
    common.APPLE_OAUTH_CLIENT_ID = provider.clientId;
    common.APPLE_OAUTH_TEAM_ID = provider.teamId!;
    common.APPLE_OAUTH_KEY_ID = provider.keyId!;
    common.APPLE_OAUTH_PRIVATE_KEY = provider.privateKey!.replaceAll(
      "\n",
      "\\n",
    );
  }
  return common;
}

export function createDeploymentConfiguration(
  input: InstallerAnswers,
  generated: GeneratedSecrets = generateSecrets(),
): GeneratedDeploymentConfiguration {
  const answers = validateInstallerAnswers(input);
  const siteUrl = secureSiteUrl(answers.siteUrl, answers.mode);
  const encodedPassword = encodeURIComponent(generated.databasePassword);
  const databaseUrl = `postgresql://${answers.databaseUser}:${encodedPassword}@db:5432/${answers.databaseName}?schema=public`;
  const prefix = answers.buildLocalImages
    ? "baseballstattrack"
    : "ghcr.io/cryptnetworks/baseballstattrack";
  const composeEnvironment = Object.freeze({
    APP_IMAGE: `${prefix}:${answers.imageTag}`,
    MIGRATION_IMAGE: `${prefix}-migration:${answers.imageTag}`,
    DISCORD_BOT_IMAGE: `${prefix}-discord-bot:${answers.imageTag}`,
    IMAGE_PULL_POLICY: answers.buildLocalImages ? "never" : "always",
    APP_ENV_FILE: "./app.env",
    COMPOSE_PROFILES: "",
    APP_BIND_ADDRESS: answers.bindAddress,
    APP_PORT: String(answers.appPort),
    NEXT_PUBLIC_SITE_URL: siteUrl,
    POSTGRES_DB: answers.databaseName,
    POSTGRES_USER: answers.databaseUser,
    POSTGRES_PASSWORD: generated.databasePassword,
    DATABASE_URL: databaseUrl,
    DIRECT_URL: databaseUrl,
    DISCORD_UPDATE_WORKER_TOKEN: generated.discordUpdateWorkerToken,
  });
  const applicationEnvironment = Object.freeze({
    NEXT_PUBLIC_APP_ENV: answers.mode === "local" ? "local" : "production",
    NEXT_PUBLIC_SITE_URL: siteUrl,
    OAUTH_CALLBACK_URL: new URL("/auth/callback", siteUrl).toString(),
    AUTHENTICATION_ENCRYPTION_KEY: generated.authenticationEncryptionKey,
    ...providerEnvironment(answers.provider),
    ...(answers.provider.provider === "local"
      ? {
          LOCAL_ACCOUNT_NAME: answers.accountDisplayName.trim(),
          LOCAL_ACCOUNT_SLUG: answers.accountSlug,
        }
      : {}),
    WEBHOOK_SIGNING_MASTER_KEY: generated.webhookSigningMasterKey,
    WEBHOOK_WORKER_TOKEN: generated.webhookWorkerToken,
    EXTERNAL_INGESTION_WORKER_TOKEN: generated.externalIngestionWorkerToken,
    ICS_FEED_SIGNING_KEY: generated.calendarFeedSigningKey,
    NOTIFICATION_WORKER_TOKEN: generated.notificationWorkerToken,
    NOTIFICATION_EVENT_TOKEN: generated.notificationEventToken,
    DISCORD_UPDATE_EVENT_TOKEN: generated.discordUpdateEventToken,
    DISCORD_UPDATE_WORKER_TOKEN: generated.discordUpdateWorkerToken,
  });
  return Object.freeze({
    composeEnvironment,
    applicationEnvironment,
    secrets: generated,
  });
}

function encodeEnvironmentValue(value: string) {
  if (/^[A-Za-z0-9_./:@?+=,-]*$/u.test(value)) return value;
  return `'${value.replaceAll("'", "\\'")}'`;
}

export function serializeEnvironment(values: Readonly<Record<string, string>>) {
  return `${Object.entries(values)
    .map(([key, value]) => `${key}=${encodeEnvironmentValue(value)}`)
    .join("\n")}\n`;
}

export function parseEnvironment(content: string) {
  const values: Record<string, string> = {};
  for (const line of content.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0)
      throw new Error("The deployment environment file is malformed.");
    const key = trimmed.slice(0, separator);
    const encoded = trimmed.slice(separator + 1);
    if (encoded.startsWith("'") && encoded.endsWith("'")) {
      values[key] = encoded.slice(1, -1).replaceAll("\\'", "'");
    } else {
      values[key] = encoded.startsWith('"')
        ? (JSON.parse(encoded) as string)
        : encoded;
    }
  }
  return values;
}

export async function writeProtectedFile(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.partial-${process.pid}`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(content, "utf8");
  } finally {
    await handle.close();
  }
  await rename(temporary, path);
  await chmod(path, 0o600).catch(() => undefined);
}

export function redactSensitive(input: string, secrets: readonly string[]) {
  let redacted = input.replace(
    /postgres(?:ql)?:\/\/([^:\s/]+):([^@\s]+)@/giu,
    "postgresql://$1:[REDACTED]@",
  );
  for (const value of secrets.filter((entry) => entry.length >= 8)) {
    redacted = redacted.replaceAll(value, "[REDACTED]");
    redacted = redacted.replaceAll(encodeURIComponent(value), "[REDACTED]");
  }
  return redacted;
}

export function installationMetadata(
  answers: InstallerAnswers,
  now = new Date(),
): InstallationMetadata {
  return Object.freeze({
    schemaVersion: 1,
    projectName: "baseballstattrack",
    mode: answers.mode,
    siteUrl: secureSiteUrl(answers.siteUrl, answers.mode),
    timezone: answers.timezone,
    appPort: answers.appPort,
    accountDisplayName: answers.accountDisplayName.trim(),
    accountSlug: answers.accountSlug,
    administratorProvider: answers.provider.provider,
    imageTag: answers.imageTag,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  });
}
