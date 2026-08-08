import { randomUUID } from "node:crypto";

import { OAuthAttemptPurpose } from "@prisma/client";
import { z } from "zod";

import {
  decryptAuthenticationPayload,
  encryptAuthenticationPayload,
  opaqueHash,
  pkceChallenge,
  randomOpaque,
} from "@/server/auth/authentication-crypto";
import {
  applicationSessionCookie,
  getApplicationSessionService,
  type SessionCookie,
} from "@/server/auth/application-session";
import { authCookieOptions } from "@/server/auth/cookie-policy";
import { AuthorizationError } from "@/server/auth/errors";
import { createAuthenticationAdapters } from "@/server/auth/oauth-adapters";
import {
  authenticationProviderKeys,
  type AuthenticationAdapter,
  type AuthenticationProviderKey,
} from "@/server/auth/oauth-provider";
import { loadAuthenticationProviderConfiguration } from "@/server/auth/provider-configuration";
import {
  AuthenticationIdentityConflictError,
  AuthenticationSessionInactiveError,
  AuthenticationUserInactiveError,
  PrismaAuthenticationRepository,
} from "@/server/data/authentication-repository";
import { getPrismaClient } from "@/server/data/prisma";

const OAUTH_ATTEMPT_TTL_MS = 10 * 60 * 1_000;
const providerSchema = z.enum(authenticationProviderKeys);
const authorizationCode = z
  .string()
  .min(1)
  .max(8192)
  .regex(/^[^\u0000-\u001f\u007f]+$/u);
const callbackState = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
const attemptCookieSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/u,
  );
const returnToSchema = z.string().regex(/^\/(?!\/)[A-Za-z0-9/_?=&.-]*$/u);
const attemptSecretsSchema = z
  .object({
    codeVerifier: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/u),
    nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
  })
  .strict();

export const oauthAttemptCookie = Object.freeze({
  name: "bst_oauth_attempt",
  path: "/auth/callback",
  maxAge: OAUTH_ATTEMPT_TTL_MS / 1_000,
});

type Repository = Pick<
  PrismaAuthenticationRepository,
  | "createOAuthAttempt"
  | "consumeOAuthAttempt"
  | "resolveOrCreateIdentity"
  | "linkIdentity"
  | "createSession"
>;

function attemptCookie(
  provider: AuthenticationProviderKey,
  value: string,
): SessionCookie {
  return {
    name: oauthAttemptCookie.name,
    value,
    options: {
      ...authCookieOptions(),
      path: oauthAttemptCookie.path,
      maxAge: oauthAttemptCookie.maxAge,
      ...(provider === "apple"
        ? { sameSite: "none" as const, secure: true }
        : {}),
    },
  };
}

export const clearOAuthAttemptCookies = Object.freeze([
  {
    name: oauthAttemptCookie.name,
    value: "",
    options: {
      ...authCookieOptions(),
      path: oauthAttemptCookie.path,
      maxAge: 0,
    },
  },
  {
    name: oauthAttemptCookie.name,
    value: "",
    options: {
      ...authCookieOptions(),
      path: oauthAttemptCookie.path,
      sameSite: "none" as const,
      secure: true,
      maxAge: 0,
    },
  },
] satisfies readonly SessionCookie[]);

export class OAuthAuthenticationService {
  constructor(
    private readonly repository: Repository,
    private readonly adapters: ReadonlyMap<
      AuthenticationProviderKey,
      AuthenticationAdapter
    >,
    private readonly callbackUrl: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  providers() {
    return [...this.adapters.values()].map(({ key, label }) => ({
      key,
      label,
    }));
  }

  startSignIn(providerInput: string, returnTo = "/accounts") {
    return this.start({
      provider: providerInput,
      purpose: OAuthAttemptPurpose.SIGN_IN,
      appUserId: null,
      initiatingSessionId: null,
      returnTo: returnToSchema.parse(returnTo),
    });
  }

  async startLink(providerInput: string, sessionToken: string) {
    const session = await getApplicationSessionService().authenticateToken(
      sessionToken,
      false,
    );
    return this.start({
      provider: providerInput,
      purpose: OAuthAttemptPurpose.LINK,
      appUserId: session.appUserId,
      initiatingSessionId: session.sessionId,
      returnTo: "/accounts",
    });
  }

  private async start(input: {
    provider: string;
    purpose: OAuthAttemptPurpose;
    appUserId: string | null;
    initiatingSessionId: string | null;
    returnTo: string;
  }) {
    const provider = providerSchema.parse(input.provider);
    const adapter = this.adapters.get(provider);
    if (!adapter) {
      throw new AuthorizationError(
        "CONFIGURATION_ERROR",
        "The requested authentication provider is unavailable.",
      );
    }
    const issuedAt = this.now();
    const externalId = randomUUID();
    const state = randomOpaque(32);
    const browserBinding = randomOpaque(32);
    const codeVerifier = randomOpaque(48);
    const nonce = randomOpaque(32);
    await this.repository.createOAuthAttempt({
      externalId,
      provider,
      purpose: input.purpose,
      appUserId: input.appUserId,
      initiatingSessionId: input.initiatingSessionId,
      stateHash: opaqueHash(state, "state"),
      browserBindingHash: opaqueHash(browserBinding, "browser"),
      encryptedSecrets: encryptAuthenticationPayload({ codeVerifier, nonce }),
      redirectUri: this.callbackUrl,
      returnTo: input.returnTo,
      expiresAt: new Date(issuedAt.getTime() + OAUTH_ATTEMPT_TTL_MS),
      createdAt: issuedAt,
    });
    return {
      authorizationUrl: adapter
        .authorizationUrl({
          redirectUri: this.callbackUrl,
          state,
          codeChallenge: pkceChallenge(codeVerifier),
          nonce,
        })
        .toString(),
      cookie: attemptCookie(provider, `${externalId}.${browserBinding}`),
    };
  }

  async complete(inputValue: unknown) {
    const input = z
      .object({
        code: authorizationCode,
        state: callbackState,
        attemptCookie: attemptCookieSchema,
        signal: z.custom<AbortSignal>().optional(),
      })
      .strict()
      .parse(inputValue);
    const [externalId, browserBinding] = input.attemptCookie.split(".");
    const completedAt = this.now();
    const attempt = await this.repository.consumeOAuthAttempt({
      externalId: externalId!,
      stateHash: opaqueHash(input.state, "state"),
      browserBindingHash: opaqueHash(browserBinding!, "browser"),
      consumedAt: completedAt,
    });
    if (!attempt) throw new AuthorizationError("INVALID_OAUTH_CALLBACK");
    const provider = providerSchema.parse(attempt.provider);
    const adapter = this.adapters.get(provider);
    if (!adapter) throw new AuthorizationError("INVALID_OAUTH_CALLBACK");
    const secrets = attemptSecretsSchema.parse(
      decryptAuthenticationPayload(attempt.encryptedSecrets),
    );
    const providerIdentity = await adapter.exchange({
      redirectUri: attempt.redirectUri,
      code: input.code,
      codeVerifier: secrets.codeVerifier,
      nonce: secrets.nonce,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    let linked;
    try {
      linked =
        attempt.purpose === OAuthAttemptPurpose.LINK
          ? await this.repository.linkIdentity({
              appUserId: attempt.appUserId!,
              linkedByAppUserId: attempt.appUserId!,
              initiatingSessionId: attempt.initiatingSessionId!,
              identity: providerIdentity,
              reason: "Explicit authenticated provider link",
              authenticatedAt: completedAt,
            })
          : await this.repository.resolveOrCreateIdentity(
              providerIdentity,
              completedAt,
            );
    } catch (error) {
      if (error instanceof AuthenticationIdentityConflictError) {
        throw new AuthorizationError("IDENTITY_ALREADY_LINKED");
      }
      if (error instanceof AuthenticationSessionInactiveError) {
        throw new AuthorizationError("INVALID_OAUTH_CALLBACK");
      }
      if (error instanceof AuthenticationUserInactiveError) {
        throw new AuthorizationError("USER_DISABLED");
      }
      throw error;
    }
    const session = await this.repository.createSession({
      appUserId: linked.appUserId,
      identityId: linked.identityId,
      createdAt: completedAt,
    });
    return {
      returnTo: returnToSchema.parse(attempt.returnTo),
      sessionCookie: {
        name: applicationSessionCookie.name,
        value: session.token,
        options: {
          ...applicationSessionCookie.options,
          expires: session.expiresAt,
        },
      } satisfies SessionCookie,
    };
  }
}

let singleton: OAuthAuthenticationService | undefined;

export function getOAuthAuthenticationService() {
  if (!singleton) {
    const configuration = loadAuthenticationProviderConfiguration();
    singleton = new OAuthAuthenticationService(
      new PrismaAuthenticationRepository(getPrismaClient()),
      createAuthenticationAdapters(configuration),
      configuration.callbackUrl,
    );
  }
  return singleton;
}
