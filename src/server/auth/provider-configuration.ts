import { z } from "zod";

import {
  authenticationProviderKeys,
  type AuthenticationProviderKey,
} from "@/server/auth/oauth-provider";
import {
  deploymentConfiguration,
  runtimeSecretConfiguration,
} from "@/server/config/runtime-environment";

const secureUrl = z.url().refine((value) => {
  const url = new URL(value);
  return (
    (url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["127.0.0.1", "localhost", "::1"].includes(url.hostname))) &&
    !url.username &&
    !url.password &&
    !url.hash &&
    !url.search
  );
}, "OAuth URLs must use HTTPS, or loopback HTTP for local development.");

const nonempty = z.string().trim().min(1).max(512);
const secret = z.string().trim().min(16).max(16_384);

export type AuthenticationProviderConfiguration = Readonly<{
  enabled: readonly AuthenticationProviderKey[];
  callbackUrl: string;
  authentik: Readonly<{
    issuerUrl: string;
    clientId: string;
    clientSecret: string;
  }> | null;
  google: Readonly<{ clientId: string; clientSecret: string }> | null;
  discord: Readonly<{ clientId: string; clientSecret: string }> | null;
  facebook: Readonly<{ clientId: string; clientSecret: string }> | null;
  apple: Readonly<{
    clientId: string;
    teamId: string;
    keyId: string;
    privateKey: string;
  }> | null;
}>;

function enabledProviders(value: string) {
  const entries = value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return z.array(z.enum(authenticationProviderKeys)).max(5).parse(entries);
}

function requiredWhenEnabled<T>(
  enabled: readonly AuthenticationProviderKey[],
  key: AuthenticationProviderKey,
  value: () => T,
): T | null {
  return enabled.includes(key) ? value() : null;
}

export function loadAuthenticationProviderConfiguration(
  environment?: Readonly<Record<string, string | undefined>>,
): AuthenticationProviderConfiguration {
  const deployment = deploymentConfiguration(environment);
  const secrets = runtimeSecretConfiguration(environment);
  const enabled = enabledProviders(deployment.authenticationEnabledProviders);
  const callbackUrl = secureUrl.parse(
    deployment.oauthCallbackUrl ??
      (deployment.siteUrl
        ? new URL("/auth/callback", deployment.siteUrl).toString()
        : undefined),
  );
  return Object.freeze({
    enabled: Object.freeze([...new Set(enabled)]),
    callbackUrl,
    authentik: requiredWhenEnabled(enabled, "authentik", () =>
      Object.freeze({
        issuerUrl: secureUrl.parse(deployment.authentikIssuerUrl),
        clientId: nonempty.parse(deployment.authentikClientId),
        clientSecret: secret.parse(secrets.authentikClientSecret),
      }),
    ),
    google: requiredWhenEnabled(enabled, "google", () =>
      Object.freeze({
        clientId: nonempty.parse(deployment.googleOauthClientId),
        clientSecret: secret.parse(secrets.googleOauthClientSecret),
      }),
    ),
    discord: requiredWhenEnabled(enabled, "discord", () =>
      Object.freeze({
        clientId: nonempty.parse(deployment.discordLoginClientId),
        clientSecret: secret.parse(secrets.discordLoginClientSecret),
      }),
    ),
    facebook: requiredWhenEnabled(enabled, "facebook", () =>
      Object.freeze({
        clientId: nonempty.parse(deployment.facebookOauthClientId),
        clientSecret: secret.parse(secrets.facebookOauthClientSecret),
      }),
    ),
    apple: requiredWhenEnabled(enabled, "apple", () =>
      Object.freeze({
        clientId: nonempty.parse(deployment.appleOauthClientId),
        teamId: nonempty.parse(deployment.appleOauthTeamId),
        keyId: nonempty.parse(deployment.appleOauthKeyId),
        privateKey: secret
          .parse(secrets.appleOauthPrivateKey)
          .replaceAll("\\n", "\n"),
      }),
    ),
  });
}
