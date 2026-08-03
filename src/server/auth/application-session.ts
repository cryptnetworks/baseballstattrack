import { z } from "zod";

import { AuthorizationError } from "@/server/auth/errors";
import {
  authenticationProviderKeys,
  type AuthenticationProviderKey,
} from "@/server/auth/oauth-provider";
import type { AuthenticatedIdentity } from "@/server/auth/types";
import { authCookieOptions } from "@/server/auth/cookie-policy";
import { PrismaAuthenticationRepository } from "@/server/data/authentication-repository";
import { getPrismaClient } from "@/server/data/prisma";

export type SessionCookieOptions = Readonly<{
  httpOnly?: boolean;
  sameSite?: "lax" | "strict" | "none";
  secure?: boolean;
  path?: string;
  maxAge?: number;
  expires?: Date;
}>;

export type SessionCookie = Readonly<{
  name: string;
  value: string;
  options?: SessionCookieOptions;
}>;

export type SessionCookieStore = Readonly<{
  getAll(): Array<{ name: string; value: string }>;
  setAll(cookies: SessionCookie[]): void;
}>;

export const applicationSessionCookie = Object.freeze({
  name: "bst_session",
  options: Object.freeze({
    ...authCookieOptions(),
    maxAge: 30 * 24 * 60 * 60,
  }),
});

const providerSchema = z.enum(authenticationProviderKeys);

type Repository = Pick<
  PrismaAuthenticationRepository,
  "authenticateSessionToken" | "revokeSessionToken"
>;

function cookieValue(store: SessionCookieStore) {
  return (
    store.getAll().find(({ name }) => name === applicationSessionCookie.name)
      ?.value ?? null
  );
}

function identity(provider: string, providerSubject: string) {
  return Object.freeze({
    provider: providerSchema.parse(provider),
    providerSubject: z.string().trim().min(1).max(1024).parse(providerSubject),
  }) satisfies AuthenticatedIdentity;
}

export class ApplicationSessionService {
  constructor(
    private readonly repository: Repository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async authenticateToken(token: string, allowRotation: boolean) {
    const result = await this.repository.authenticateSessionToken(
      token,
      this.now(),
      allowRotation,
    );
    if (result.outcome === "expired") {
      throw new AuthorizationError("SESSION_EXPIRED");
    }
    if (result.outcome === "invalid" || result.outcome === "revoked") {
      throw new AuthorizationError("INVALID_SESSION");
    }
    return {
      identity: identity(
        result.identity.provider,
        result.identity.providerSubject,
      ),
      appUserId: result.appUserId,
      sessionId: result.sessionId,
      rotatedToken: result.rotatedToken,
      expiresAt: result.expiresAt,
    };
  }

  async authenticateCookies(
    store: SessionCookieStore,
    allowRotation = true,
  ): Promise<AuthenticatedIdentity> {
    const token = cookieValue(store);
    if (!token) throw new AuthorizationError("AUTHENTICATION_REQUIRED");
    const session = await this.authenticateToken(token, allowRotation);
    if (session.rotatedToken) {
      store.setAll([
        {
          name: applicationSessionCookie.name,
          value: session.rotatedToken,
          options: {
            ...applicationSessionCookie.options,
            expires: session.expiresAt,
          },
        },
      ]);
    }
    return session.identity;
  }

  async authenticateRequest(
    request: Request,
    store: SessionCookieStore,
    allowCookieRotation = true,
  ): Promise<AuthenticatedIdentity> {
    const authorization = request.headers.get("authorization");
    if (!authorization)
      return this.authenticateCookies(store, allowCookieRotation);
    const match = /^Bearer ([^\s]+)$/iu.exec(authorization);
    if (!match?.[1]) throw new AuthorizationError("AUTHENTICATION_REQUIRED");
    return (await this.authenticateToken(match[1], false)).identity;
  }

  async revokeCookies(store: SessionCookieStore) {
    const token = cookieValue(store);
    if (token) {
      try {
        await this.repository.revokeSessionToken(
          token,
          this.now(),
          "USER_SIGN_OUT",
        );
      } catch (error) {
        if (!(error instanceof AuthorizationError)) throw error;
      }
    }
    store.setAll([
      {
        name: applicationSessionCookie.name,
        value: "",
        options: { ...applicationSessionCookie.options, maxAge: 0 },
      },
    ]);
  }
}

let singleton: ApplicationSessionService | undefined;

export function getApplicationSessionService() {
  singleton ??= new ApplicationSessionService(
    new PrismaAuthenticationRepository(getPrismaClient()),
  );
  return singleton;
}

export function isAuthenticationProvider(
  value: string,
): value is AuthenticationProviderKey {
  return providerSchema.safeParse(value).success;
}
