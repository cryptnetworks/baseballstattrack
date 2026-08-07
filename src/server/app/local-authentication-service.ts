import { z } from "zod";

import {
  applicationSessionCookie,
  type SessionCookie,
} from "@/server/auth/application-session";
import { localPasswordMatches } from "@/server/auth/authentication-crypto";
import { authCookieOptions } from "@/server/auth/cookie-policy";
import { AuthorizationError } from "@/server/auth/errors";
import { loadAuthenticationProviderConfiguration } from "@/server/auth/provider-configuration";
import { PrismaAuthenticationRepository } from "@/server/data/authentication-repository";
import { getPrismaClient } from "@/server/data/prisma";

const usernameSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9._-]+$/u);
const passwordSchema = z.string().min(1).max(1024);

type Repository = Pick<
  PrismaAuthenticationRepository,
  "resolveOrCreateLocalIdentity" | "createSession"
>;

export class LocalAuthenticationService {
  constructor(
    private readonly repository: Repository,
    private readonly configuration = loadAuthenticationProviderConfiguration(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  enabled() {
    return this.configuration.local !== null;
  }

  async signIn(usernameInput: string, passwordInput: string) {
    const local = this.configuration.local;
    if (!local)
      throw new AuthorizationError(
        "CONFIGURATION_ERROR",
        "Local authentication is not configured.",
      );
    const username = usernameSchema.parse(usernameInput).toLowerCase();
    const password = passwordSchema.parse(passwordInput);
    if (
      username !== local.username ||
      !localPasswordMatches(password, local.password)
    ) {
      throw new AuthorizationError(
        "INVALID_LOCAL_CREDENTIALS",
        "Invalid username or password.",
      );
    }
    const createdAt = this.now();
    const identity = await this.repository.resolveOrCreateLocalIdentity({
      username,
      accountName: local.accountName,
      accountSlug: local.accountSlug,
      authenticatedAt: createdAt,
    });
    const session = await this.repository.createSession({
      ...identity,
      createdAt,
    });
    const cookie: SessionCookie = {
      name: applicationSessionCookie.name,
      value: session.token,
      options: {
        ...applicationSessionCookie.options,
        ...authCookieOptions(),
        expires: session.expiresAt,
      },
    };
    return { cookie, expiresAt: session.expiresAt };
  }
}

let singleton: LocalAuthenticationService | undefined;

export function getLocalAuthenticationService() {
  singleton ??= new LocalAuthenticationService(
    new PrismaAuthenticationRepository(getPrismaClient()),
  );
  return singleton;
}
