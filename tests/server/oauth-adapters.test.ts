import { createSign, generateKeyPairSync } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { createAuthenticationAdapters } from "@/server/auth/oauth-adapters";
import type {
  AuthenticationProviderKey,
  OAuthCallbackInput,
} from "@/server/auth/oauth-provider";
import type { AuthenticationProviderConfiguration } from "@/server/auth/provider-configuration";

const configuration: AuthenticationProviderConfiguration = {
  enabled: ["authentik", "google", "discord", "facebook", "apple"],
  callbackUrl: "https://app.example.test/auth/callback",
  authentik: {
    issuerUrl: "https://identity.example.test/application/o/baseball/",
    clientId: "authentik-client",
    clientSecret: "authentik-client-secret",
  },
  google: {
    clientId: "google-client",
    clientSecret: "google-client-secret",
  },
  discord: {
    clientId: "discord-client",
    clientSecret: "discord-client-secret",
  },
  facebook: {
    clientId: "facebook-client",
    clientSecret: "facebook-client-secret",
  },
  apple: {
    clientId: "apple-client",
    teamId: "apple-team",
    keyId: "apple-key",
    privateKey: "not-used-to-create-an-authorization-url",
  },
};

const authorizationInput = {
  redirectUri: configuration.callbackUrl,
  state: "state-value",
  codeChallenge: "pkce-challenge",
  nonce: "nonce-value",
};
const callbackInput: OAuthCallbackInput = {
  redirectUri: configuration.callbackUrl,
  code: "authorization-code",
  codeVerifier: "code-verifier",
  nonce: "nonce-value",
};

describe("OAuth authentication adapters", () => {
  it("builds secure authorization-code plus PKCE flows for every provider", () => {
    const adapters = createAuthenticationAdapters(configuration, vi.fn());
    const expected = {
      authentik: "https://identity.example.test/application/o/authorize/",
      google: "https://accounts.google.com/o/oauth2/v2/auth",
      discord: "https://discord.com/oauth2/authorize",
      facebook: "https://www.facebook.com/dialog/oauth",
      apple: "https://appleid.apple.com/auth/authorize",
    } satisfies Record<AuthenticationProviderKey, string>;
    for (const [provider, endpoint] of Object.entries(expected)) {
      const url = adapters
        .get(provider as AuthenticationProviderKey)!
        .authorizationUrl(authorizationInput);
      expect(`${url.origin}${url.pathname}`).toBe(endpoint);
      expect(url.searchParams.get("response_type")).toBe("code");
      expect(url.searchParams.get("state")).toBe("state-value");
      expect(url.searchParams.get("code_challenge")).toBe("pkce-challenge");
      expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    }
    expect(
      adapters.get("apple")!.authorizationUrl(authorizationInput).searchParams,
    ).toMatchObject(expect.any(URLSearchParams));
    expect(
      adapters
        .get("apple")!
        .authorizationUrl(authorizationInput)
        .searchParams.get("response_mode"),
    ).toBe("form_post");
  });

  it.each([
    [
      "authentik",
      { sub: "subject-a", email: "a@example.test", email_verified: true },
    ],
    [
      "google",
      { sub: "subject-g", email: "g@example.test", email_verified: true },
    ],
    [
      "discord",
      { id: "123456789012345678", email: "d@example.test", verified: true },
    ],
    ["facebook", { id: "subject-f", email: "f@example.test" }],
  ] as const)(
    "maps %s server user-info by stable subject",
    async (provider, userInfo) => {
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ access_token: "provider-token" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify(userInfo), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      const adapter = createAuthenticationAdapters(configuration, fetcher).get(
        provider,
      )!;
      const mapped = await adapter.exchange(callbackInput);
      expect(mapped).toMatchObject({
        provider,
        subject: "sub" in userInfo ? userInfo.sub : userInfo.id,
        email: userInfo.email,
      });
      expect(fetcher).toHaveBeenNthCalledWith(
        2,
        expect.anything(),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer provider-token",
          }),
          redirect: "error",
          cache: "no-store",
        }),
      );
    },
  );

  it("rejects invalid provider responses instead of trusting callback claims", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ access_token: "provider-token" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(
      createAuthenticationAdapters(configuration, fetcher)
        .get("google")!
        .exchange(callbackInput),
    ).rejects.toMatchObject({ code: "INVALID_OAUTH_CALLBACK" });
  });

  it("verifies Apple issuer, audience, nonce, expiry, and JWKS signature", async () => {
    const appleClientKey = generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
    })
      .privateKey.export({ format: "pem", type: "pkcs8" })
      .toString();
    const appleSigningKey = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const encoded = (value: unknown) =>
      Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
    const now = Math.floor(Date.now() / 1_000);
    const signingInput = `${encoded({ alg: "RS256", kid: "apple-signing-key" })}.${encoded(
      {
        iss: "https://appleid.apple.com",
        aud: "apple-client",
        sub: "apple-stable-subject",
        exp: now + 300,
        iat: now,
        nonce: callbackInput.nonce,
        email: "private-relay@example.test",
        email_verified: "true",
      },
    )}`;
    const idToken = `${signingInput}.${createSign("RSA-SHA256")
      .update(signingInput, "ascii")
      .end()
      .sign(appleSigningKey.privateKey)
      .toString("base64url")}`;
    const jwk = appleSigningKey.publicKey.export({ format: "jwk" });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: "apple-token", id_token: idToken }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            keys: [{ ...jwk, kid: "apple-signing-key", use: "sig" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    const adapter = createAuthenticationAdapters(
      {
        ...configuration,
        apple: { ...configuration.apple!, privateKey: appleClientKey },
      },
      fetcher,
    ).get("apple")!;
    await expect(adapter.exchange(callbackInput)).resolves.toEqual({
      provider: "apple",
      subject: "apple-stable-subject",
      email: "private-relay@example.test",
      emailVerified: true,
    });
    expect(String(fetcher.mock.calls[0]![1]?.body)).toContain(
      "code_verifier=code-verifier",
    );
  });
});
