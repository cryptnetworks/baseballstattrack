import { z } from "zod";

import { discordSnowflakeSchema } from "@/domain/discord-installation";

type Environment = Readonly<Record<string, string | undefined>>;

function secureUrl(value: string, name: string, allowPath = true): URL {
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    url.username ||
    url.password ||
    url.hash ||
    (!allowPath && url.pathname !== "/")
  ) {
    throw new Error(
      `${name} must be HTTPS (or loopback HTTP) without credentials or fragments.`,
    );
  }
  return url;
}

const configurationSchema = z
  .object({
    clientId: discordSnowflakeSchema,
    clientSecret: z.string().min(32).max(512),
    botToken: z.string().min(32).max(512),
    credentialReference: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/u),
    stateSecret: z.string().min(32).max(512),
    redirectUri: z.string().min(1),
    apiBaseUrl: z.string().min(1),
    timeoutMs: z.number().int().min(1_000).max(30_000),
  })
  .strict();

export type DiscordInstallationConfiguration = Readonly<{
  clientId: string;
  clientSecret: string;
  botToken: string;
  credentialReference: string;
  stateSecret: string;
  redirectUri: string;
  apiBaseUrl: string;
  timeoutMs: number;
}>;

export function loadDiscordInstallationConfiguration(
  environment: Environment = process.env,
): DiscordInstallationConfiguration {
  const siteUrl = environment.NEXT_PUBLIC_SITE_URL;
  const redirectUri =
    environment.DISCORD_OAUTH_REDIRECT_URI ??
    (siteUrl
      ? new URL(
          "/api/admin/discord-installations/callback",
          secureUrl(siteUrl, "NEXT_PUBLIC_SITE_URL"),
        ).toString()
      : undefined);
  const parsed = configurationSchema.parse({
    clientId: environment.DISCORD_OAUTH_CLIENT_ID,
    clientSecret: environment.DISCORD_OAUTH_CLIENT_SECRET,
    botToken: environment.DISCORD_INSTALLATION_BOT_TOKEN,
    credentialReference: environment.DISCORD_INSTALLATION_CREDENTIAL_REFERENCE,
    stateSecret: environment.DISCORD_OAUTH_STATE_SECRET,
    redirectUri,
    apiBaseUrl:
      environment.DISCORD_INSTALLATION_API_BASE_URL ??
      "https://discord.com/api/v10/",
    timeoutMs: Number(environment.DISCORD_INSTALLATION_TIMEOUT_MS ?? "8000"),
  });
  const redirect = secureUrl(parsed.redirectUri, "DISCORD_OAUTH_REDIRECT_URI");
  const apiBase = secureUrl(
    parsed.apiBaseUrl,
    "DISCORD_INSTALLATION_API_BASE_URL",
  );
  if (!apiBase.pathname.endsWith("/")) apiBase.pathname += "/";
  return Object.freeze({
    ...parsed,
    redirectUri: redirect.toString(),
    apiBaseUrl: apiBase.toString(),
  });
}
