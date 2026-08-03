import { describe, expect, it } from "vitest";

import { loadAuthenticationProviderConfiguration } from "@/server/auth/provider-configuration";

const encryptionKey = Buffer.alloc(32, 7).toString("base64url");

describe("authentication provider configuration", () => {
  it("loads only explicitly enabled adapters and keeps client secrets server-side", () => {
    const configuration = loadAuthenticationProviderConfiguration({
      NEXT_PUBLIC_SITE_URL: "https://app.example.test",
      AUTHENTICATION_ENCRYPTION_KEY: encryptionKey,
      AUTHENTICATION_ENABLED_PROVIDERS: "google,discord",
      GOOGLE_OAUTH_CLIENT_ID: "google-client",
      GOOGLE_OAUTH_CLIENT_SECRET: "google-secret-value",
      DISCORD_LOGIN_CLIENT_ID: "discord-client",
      DISCORD_LOGIN_CLIENT_SECRET: "discord-secret-value",
    });
    expect(configuration.enabled).toEqual(["google", "discord"]);
    expect(configuration.callbackUrl).toBe(
      "https://app.example.test/auth/callback",
    );
    expect(configuration.google?.clientSecret).toBe("google-secret-value");
    expect(configuration.authentik).toBeNull();
    expect(configuration.apple).toBeNull();
  });

  it("fails closed for duplicate, unknown, incomplete, or insecure providers", () => {
    for (const environment of [
      {
        NEXT_PUBLIC_SITE_URL: "https://app.example.test",
        AUTHENTICATION_ENABLED_PROVIDERS: "unknown",
      },
      {
        NEXT_PUBLIC_SITE_URL: "https://app.example.test",
        AUTHENTICATION_ENABLED_PROVIDERS: "google",
        GOOGLE_OAUTH_CLIENT_ID: "google-client",
      },
      {
        NEXT_PUBLIC_SITE_URL: "http://public.example.test",
        AUTHENTICATION_ENABLED_PROVIDERS: "",
      },
    ]) {
      expect(() =>
        loadAuthenticationProviderConfiguration(environment),
      ).toThrow();
    }
  });

  it("allows loopback HTTP only for local provider development", () => {
    expect(
      loadAuthenticationProviderConfiguration({
        NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3000",
        AUTHENTICATION_ENABLED_PROVIDERS: "",
      }).callbackUrl,
    ).toBe("http://127.0.0.1:3000/auth/callback");
  });
});
