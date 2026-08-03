import {
  createPublicKey,
  createSign,
  verify as verifySignature,
} from "node:crypto";

import { z } from "zod";

import { AuthorizationError } from "@/server/auth/errors";
import type {
  AuthenticationAdapter,
  AuthenticationProviderKey,
  OAuthAuthorizationInput,
  OAuthCallbackInput,
  OAuthProviderIdentity,
} from "@/server/auth/oauth-provider";
import type { AuthenticationProviderConfiguration } from "@/server/auth/provider-configuration";

type Fetcher = typeof fetch;

const tokenSchema = z
  .object({
    access_token: z.string().min(1),
    token_type: z.string().optional(),
    id_token: z.string().optional(),
  })
  .passthrough();

const email = z.email().max(320).nullable();

function callbackFailure(): AuthorizationError {
  return new AuthorizationError("INVALID_OAUTH_CALLBACK");
}

function providerFailure(): AuthorizationError {
  return new AuthorizationError("PROVIDER_FAILURE");
}

function callbackSignal(signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(10_000);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function jsonResponse(
  fetcher: Fetcher,
  url: string | URL,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(url, {
      ...init,
      signal: callbackSignal(signal),
      redirect: "error",
      cache: "no-store",
    });
  } catch {
    throw providerFailure();
  }
  if (!response.ok) throw callbackFailure();
  try {
    return await response.json();
  } catch {
    throw callbackFailure();
  }
}

function authorizationUrl(
  endpoint: string,
  clientId: string,
  scopes: readonly string[],
  input: OAuthAuthorizationInput,
  options: { nonce?: boolean; responseMode?: string } = {},
) {
  const url = new URL(endpoint);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scopes.join(" "));
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (options.nonce) url.searchParams.set("nonce", input.nonce);
  if (options.responseMode)
    url.searchParams.set("response_mode", options.responseMode);
  return url;
}

async function exchangeAccessToken(
  fetcher: Fetcher,
  endpoint: string,
  input: OAuthCallbackInput,
  clientId: string,
  clientSecret: string,
) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
    code_verifier: input.codeVerifier,
  });
  try {
    return tokenSchema.parse(
      await jsonResponse(
        fetcher,
        endpoint,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body,
        },
        input.signal,
      ),
    );
  } catch (error) {
    if (error instanceof AuthorizationError) throw error;
    throw callbackFailure();
  }
}

class UserInfoAdapter implements AuthenticationAdapter {
  constructor(
    readonly key: AuthenticationProviderKey,
    readonly label: string,
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly authorizeEndpoint: string,
    private readonly tokenEndpoint: string,
    private readonly userInfoEndpoint: string,
    private readonly scopes: readonly string[],
    private readonly parseIdentity: (
      value: unknown,
    ) => Omit<OAuthProviderIdentity, "provider">,
    private readonly fetcher: Fetcher = fetch,
    private readonly oidc = false,
  ) {}

  authorizationUrl(input: OAuthAuthorizationInput) {
    return authorizationUrl(
      this.authorizeEndpoint,
      this.clientId,
      this.scopes,
      input,
      { nonce: this.oidc },
    );
  }

  async exchange(input: OAuthCallbackInput) {
    try {
      const token = await exchangeAccessToken(
        this.fetcher,
        this.tokenEndpoint,
        input,
        this.clientId,
        this.clientSecret,
      );
      const identity = this.parseIdentity(
        await jsonResponse(
          this.fetcher,
          this.userInfoEndpoint,
          {
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${token.access_token}`,
            },
          },
          input.signal,
        ),
      );
      return Object.freeze({ provider: this.key, ...identity });
    } catch (error) {
      if (error instanceof AuthorizationError) throw error;
      throw callbackFailure();
    }
  }
}

const oidcIdentitySchema = z
  .object({
    sub: z.string().trim().min(1).max(1024),
    email: email.optional().default(null),
    email_verified: z.boolean().nullable().default(null),
  })
  .passthrough();

const discordIdentitySchema = z
  .object({
    id: z.string().regex(/^\d{2,32}$/u),
    email: email.optional().default(null),
    verified: z.boolean().nullable().default(null),
  })
  .passthrough();

const facebookIdentitySchema = z
  .object({
    id: z.string().trim().min(1).max(1024),
    email: email.optional().default(null),
  })
  .passthrough();

function oidcIdentity(value: unknown) {
  const parsed = oidcIdentitySchema.parse(value);
  return {
    subject: parsed.sub,
    email: parsed.email,
    emailVerified: parsed.email_verified,
  };
}

function appleClientSecret(input: {
  teamId: string;
  keyId: string;
  clientId: string;
  privateKey: string;
  now: Date;
}) {
  const encoded = (value: unknown) =>
    Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  const issuedAt = Math.floor(input.now.getTime() / 1_000);
  const signingInput = `${encoded({ alg: "ES256", kid: input.keyId })}.${encoded(
    {
      iss: input.teamId,
      iat: issuedAt,
      exp: issuedAt + 300,
      aud: "https://appleid.apple.com",
      sub: input.clientId,
    },
  )}`;
  const signature = createSign("SHA256")
    .update(signingInput, "ascii")
    .end()
    .sign({ key: input.privateKey, dsaEncoding: "ieee-p1363" })
    .toString("base64url");
  return `${signingInput}.${signature}`;
}

const jwtHeaderSchema = z.object({ alg: z.literal("RS256"), kid: z.string() });
const appleClaimsSchema = z.object({
  iss: z.literal("https://appleid.apple.com"),
  aud: z.union([z.string(), z.array(z.string())]),
  sub: z.string().trim().min(1).max(1024),
  exp: z.number().int(),
  iat: z.number().int(),
  nonce: z.string(),
  email: email.optional().default(null),
  email_verified: z.union([z.boolean(), z.enum(["true", "false"])]).optional(),
});

const jwksSchema = z.object({
  keys: z.array(
    z
      .object({
        kty: z.literal("RSA"),
        kid: z.string(),
        use: z.literal("sig").optional(),
        n: z.string(),
        e: z.string(),
      })
      .passthrough(),
  ),
});

async function verifyAppleIdentityToken(input: {
  token: string;
  clientId: string;
  nonce: string;
  fetcher: Fetcher;
  signal?: AbortSignal;
  now: Date;
}) {
  try {
    const parts = input.token.split(".");
    if (parts.length !== 3 || parts.some((part) => !part))
      throw callbackFailure();
    const header = jwtHeaderSchema.parse(
      JSON.parse(Buffer.from(parts[0]!, "base64url").toString("utf8")),
    );
    const claims = appleClaimsSchema.parse(
      JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")),
    );
    const keys = jwksSchema.parse(
      await jsonResponse(
        input.fetcher,
        "https://appleid.apple.com/auth/keys",
        { headers: { Accept: "application/json" } },
        input.signal,
      ),
    );
    const key = keys.keys.find((candidate) => candidate.kid === header.kid);
    if (!key) throw callbackFailure();
    const verified = verifySignature(
      "RSA-SHA256",
      Buffer.from(`${parts[0]}.${parts[1]}`, "ascii"),
      createPublicKey({ key: key as JsonWebKey, format: "jwk" }),
      Buffer.from(parts[2]!, "base64url"),
    );
    const now = Math.floor(input.now.getTime() / 1_000);
    const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (
      !verified ||
      !audience.includes(input.clientId) ||
      claims.exp <= now ||
      claims.iat > now + 60 ||
      claims.nonce !== input.nonce
    ) {
      throw callbackFailure();
    }
    return {
      provider: "apple" as const,
      subject: claims.sub,
      email: claims.email,
      emailVerified:
        claims.email_verified === undefined
          ? null
          : claims.email_verified === true || claims.email_verified === "true",
    };
  } catch (error) {
    if (error instanceof AuthorizationError) throw error;
    throw callbackFailure();
  }
}

class AppleAdapter implements AuthenticationAdapter {
  readonly key = "apple" as const;
  readonly label = "Apple";

  constructor(
    private readonly configuration: NonNullable<
      AuthenticationProviderConfiguration["apple"]
    >,
    private readonly fetcher: Fetcher = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  authorizationUrl(input: OAuthAuthorizationInput) {
    return authorizationUrl(
      "https://appleid.apple.com/auth/authorize",
      this.configuration.clientId,
      ["openid", "email"],
      input,
      { nonce: true, responseMode: "form_post" },
    );
  }

  async exchange(input: OAuthCallbackInput) {
    const token = await exchangeAccessToken(
      this.fetcher,
      "https://appleid.apple.com/auth/token",
      input,
      this.configuration.clientId,
      appleClientSecret({ ...this.configuration, now: this.now() }),
    );
    if (!token.id_token) throw callbackFailure();
    return verifyAppleIdentityToken({
      token: token.id_token,
      clientId: this.configuration.clientId,
      nonce: input.nonce,
      fetcher: this.fetcher,
      ...(input.signal ? { signal: input.signal } : {}),
      now: this.now(),
    });
  }
}

export function createAuthenticationAdapters(
  configuration: AuthenticationProviderConfiguration,
  fetcher: Fetcher = fetch,
) {
  const adapters = new Map<AuthenticationProviderKey, AuthenticationAdapter>();
  if (configuration.authentik) {
    const issuer = configuration.authentik.issuerUrl.endsWith("/")
      ? configuration.authentik.issuerUrl
      : `${configuration.authentik.issuerUrl}/`;
    adapters.set(
      "authentik",
      new UserInfoAdapter(
        "authentik",
        "Authentik",
        configuration.authentik.clientId,
        configuration.authentik.clientSecret,
        new URL("../authorize/", issuer).toString(),
        new URL("../token/", issuer).toString(),
        new URL("../userinfo/", issuer).toString(),
        ["openid", "profile", "email"],
        oidcIdentity,
        fetcher,
        true,
      ),
    );
  }
  if (configuration.google) {
    adapters.set(
      "google",
      new UserInfoAdapter(
        "google",
        "Google",
        configuration.google.clientId,
        configuration.google.clientSecret,
        "https://accounts.google.com/o/oauth2/v2/auth",
        "https://oauth2.googleapis.com/token",
        "https://openidconnect.googleapis.com/v1/userinfo",
        ["openid", "profile", "email"],
        oidcIdentity,
        fetcher,
        true,
      ),
    );
  }
  if (configuration.discord) {
    adapters.set(
      "discord",
      new UserInfoAdapter(
        "discord",
        "Discord",
        configuration.discord.clientId,
        configuration.discord.clientSecret,
        "https://discord.com/oauth2/authorize",
        "https://discord.com/api/v10/oauth2/token",
        "https://discord.com/api/v10/users/@me",
        ["identify", "email"],
        (value) => {
          const parsed = discordIdentitySchema.parse(value);
          return {
            subject: parsed.id,
            email: parsed.email,
            emailVerified: parsed.verified,
          };
        },
        fetcher,
      ),
    );
  }
  if (configuration.facebook) {
    adapters.set(
      "facebook",
      new UserInfoAdapter(
        "facebook",
        "Facebook",
        configuration.facebook.clientId,
        configuration.facebook.clientSecret,
        "https://www.facebook.com/dialog/oauth",
        "https://graph.facebook.com/oauth/access_token",
        "https://graph.facebook.com/me?fields=id,email",
        ["email"],
        (value) => {
          const parsed = facebookIdentitySchema.parse(value);
          return {
            subject: parsed.id,
            email: parsed.email,
            emailVerified: null,
          };
        },
        fetcher,
      ),
    );
  }
  if (configuration.apple) {
    adapters.set("apple", new AppleAdapter(configuration.apple, fetcher));
  }
  return adapters;
}
