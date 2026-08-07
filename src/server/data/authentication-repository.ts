import { randomUUID } from "node:crypto";

import {
  AuthenticationIdentitySource,
  AuthenticationSessionEventType,
  OAuthAttemptPurpose,
  type PrismaClient,
} from "@prisma/client";

import type { OAuthProviderIdentity } from "@/server/auth/oauth-provider";
import {
  hashesEqual,
  issueSessionToken,
  opaqueHash,
  parseSessionToken,
} from "@/server/auth/authentication-crypto";

const SESSION_ABSOLUTE_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const SESSION_IDLE_TTL_MS = 24 * 60 * 60 * 1_000;
const SESSION_ROTATION_MS = 15 * 60 * 1_000;
const SESSION_ROTATION_GRACE_MS = 30 * 1_000;

function plus(date: Date, milliseconds: number) {
  return new Date(date.getTime() + milliseconds);
}

function earlier(left: Date, right: Date) {
  return left.getTime() <= right.getTime() ? left : right;
}

export class AuthenticationIdentityConflictError extends Error {
  constructor() {
    super("The provider identity is already linked to another user.");
    this.name = "AuthenticationIdentityConflictError";
  }
}

export class AuthenticationSessionInactiveError extends Error {
  constructor() {
    super("The initiating application session is no longer active.");
    this.name = "AuthenticationSessionInactiveError";
  }
}

export class AuthenticationUserInactiveError extends Error {
  constructor() {
    super("The application user is not active.");
    this.name = "AuthenticationUserInactiveError";
  }
}

export class PrismaAuthenticationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async resolveOrCreateLocalIdentity(input: {
    username: string;
    accountName: string;
    accountSlug: string;
    authenticatedAt: Date;
  }) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT 1::integer
        FROM pg_advisory_xact_lock(hashtextextended(${`local-auth:${input.username}`}, 0))
      `;
      const existing = await tx.authenticationIdentity.findUnique({
        where: {
          provider_providerSubject: {
            provider: "local",
            providerSubject: input.username,
          },
        },
        include: { appUser: { select: { id: true, status: true } } },
      });
      let appUserId: string;
      let identityId: string;
      if (existing) {
        if (existing.appUser.status !== "ACTIVE")
          throw new AuthenticationUserInactiveError();
        const updated = await tx.authenticationIdentity.update({
          where: { id: existing.id },
          data: { lastAuthenticatedAt: input.authenticatedAt },
        });
        appUserId = updated.appUserId;
        identityId = updated.id;
      } else {
        const appUser = await tx.appUser.create({
          data: { provider: "local", providerSubject: input.username },
          select: { id: true },
        });
        const identity = await tx.authenticationIdentity.create({
          data: {
            appUserId: appUser.id,
            provider: "local",
            providerSubject: input.username,
            emailVerified: false,
            source: AuthenticationIdentitySource.LOCAL_SIGN_IN,
            lastAuthenticatedAt: input.authenticatedAt,
          },
          select: { id: true },
        });
        appUserId = appUser.id;
        identityId = identity.id;
      }
      const account = await tx.account.upsert({
        where: { slug: input.accountSlug },
        create: { slug: input.accountSlug, displayName: input.accountName },
        update: {},
        select: { id: true },
      });
      const foundMembership = await tx.accountMembership.findFirst({
        where: { accountId: account.id, userId: appUserId },
        select: { id: true },
      });
      const membership = foundMembership
        ? await tx.accountMembership.update({
            where: { id: foundMembership.id },
            data: {
              status: "ACTIVE",
              activatedAt: input.authenticatedAt,
              disabledAt: null,
              removedAt: null,
            },
            select: { id: true },
          })
        : await tx.accountMembership.create({
            data: {
              accountId: account.id,
              userId: appUserId,
              status: "ACTIVE",
              activatedAt: input.authenticatedAt,
            },
            select: { id: true },
          });
      const ownerId = `${membership.id}-owner`;
      const foundOwner = await tx.membershipRoleAssignment.findFirst({
        where: {
          accountId: account.id,
          membershipId: membership.id,
          role: "OWNER",
          scope: "ACCOUNT",
        },
        select: { id: true },
      });
      if (!foundOwner) {
        await tx.membershipRoleAssignment.create({
          data: {
            id: ownerId,
            accountId: account.id,
            membershipId: membership.id,
            role: "OWNER",
            scope: "ACCOUNT",
          },
        });
      }
      return { appUserId, identityId };
    });
  }

  async resolveOrCreateIdentity(
    identity: OAuthProviderIdentity,
    authenticatedAt: Date,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT 1::integer
        FROM pg_advisory_xact_lock(hashtextextended(${`authentication-identity:${identity.provider}:${identity.subject}`}, 0))
      `;
      const existing = await tx.authenticationIdentity.findUnique({
        where: {
          provider_providerSubject: {
            provider: identity.provider,
            providerSubject: identity.subject,
          },
        },
        include: { appUser: { select: { status: true } } },
      });
      if (existing) {
        if (existing.appUser.status !== "ACTIVE") {
          throw new AuthenticationUserInactiveError();
        }
        const updated = await tx.authenticationIdentity.update({
          where: { id: existing.id },
          data: {
            email: identity.email,
            emailVerified: identity.emailVerified,
            lastAuthenticatedAt: authenticatedAt,
          },
        });
        return { appUserId: updated.appUserId, identityId: updated.id };
      }

      const legacy = await tx.appUser.findUnique({
        where: {
          provider_providerSubject: {
            provider: identity.provider,
            providerSubject: identity.subject,
          },
        },
        select: { id: true, status: true },
      });
      if (legacy && legacy.status !== "ACTIVE") {
        throw new AuthenticationUserInactiveError();
      }
      const appUser =
        legacy ??
        (await tx.appUser.create({
          data: {
            provider: identity.provider,
            providerSubject: identity.subject,
          },
          select: { id: true },
        }));
      const created = await tx.authenticationIdentity.create({
        data: {
          appUserId: appUser.id,
          provider: identity.provider,
          providerSubject: identity.subject,
          email: identity.email,
          emailVerified: identity.emailVerified,
          source: legacy
            ? AuthenticationIdentitySource.LEGACY_BACKFILL
            : AuthenticationIdentitySource.OAUTH_SIGN_IN,
          lastAuthenticatedAt: authenticatedAt,
        },
      });
      return { appUserId: appUser.id, identityId: created.id };
    });
  }

  async linkIdentity(input: {
    appUserId: string;
    linkedByAppUserId: string;
    initiatingSessionId: string;
    identity: OAuthProviderIdentity;
    reason: string;
    authenticatedAt: Date;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const activeSession = await tx.$queryRaw<Array<{ active: number }>>`
        SELECT 1::integer AS active
        FROM "AuthenticationSession" AS auth_session
        JOIN "AppUser" AS app_user
          ON app_user."id" = auth_session."appUserId"
        WHERE auth_session."id" = ${input.initiatingSessionId}
          AND auth_session."appUserId" = ${input.appUserId}
          AND auth_session."revokedAt" IS NULL
          AND auth_session."idleExpiresAt" > ${input.authenticatedAt}
          AND auth_session."absoluteExpiresAt" > ${input.authenticatedAt}
          AND app_user."status" = 'ACTIVE'
        FOR UPDATE OF auth_session, app_user
      `;
      if (!activeSession.length) throw new AuthenticationSessionInactiveError();
      await tx.$queryRaw`
        SELECT 1::integer
        FROM pg_advisory_xact_lock(hashtextextended(${`authentication-identity:${input.identity.provider}:${input.identity.subject}`}, 0))
      `;
      const existing = await tx.authenticationIdentity.findUnique({
        where: {
          provider_providerSubject: {
            provider: input.identity.provider,
            providerSubject: input.identity.subject,
          },
        },
      });
      if (existing && existing.appUserId !== input.appUserId) {
        throw new AuthenticationIdentityConflictError();
      }
      if (existing) {
        await tx.authenticationIdentity.update({
          where: { id: existing.id },
          data: {
            email: input.identity.email,
            emailVerified: input.identity.emailVerified,
            lastAuthenticatedAt: input.authenticatedAt,
          },
        });
        return { appUserId: existing.appUserId, identityId: existing.id };
      }
      const created = await tx.authenticationIdentity.create({
        data: {
          appUserId: input.appUserId,
          provider: input.identity.provider,
          providerSubject: input.identity.subject,
          email: input.identity.email,
          emailVerified: input.identity.emailVerified,
          source: AuthenticationIdentitySource.EXPLICIT_LINK,
          linkedByAppUserId: input.linkedByAppUserId,
          linkedReason: input.reason,
          lastAuthenticatedAt: input.authenticatedAt,
        },
      });
      return { appUserId: created.appUserId, identityId: created.id };
    });
  }

  async createOAuthAttempt(input: {
    externalId: string;
    provider: string;
    purpose: OAuthAttemptPurpose;
    appUserId: string | null;
    initiatingSessionId: string | null;
    stateHash: string;
    browserBindingHash: string;
    encryptedSecrets: string;
    redirectUri: string;
    returnTo: string;
    expiresAt: Date;
    createdAt: Date;
  }) {
    return this.prisma.oAuthLoginAttempt.create({ data: input });
  }

  consumeOAuthAttempt(input: {
    externalId: string;
    stateHash: string;
    browserBindingHash: string;
    consumedAt: Date;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const attempt = await tx.oAuthLoginAttempt.findUnique({
        where: { externalId: input.externalId },
      });
      if (
        !attempt ||
        attempt.consumedAt ||
        attempt.expiresAt.getTime() <= input.consumedAt.getTime() ||
        !hashesEqual(attempt.stateHash, input.stateHash) ||
        !hashesEqual(attempt.browserBindingHash, input.browserBindingHash)
      ) {
        return null;
      }
      const consumed = await tx.oAuthLoginAttempt.updateMany({
        where: { id: attempt.id, consumedAt: null },
        data: { consumedAt: input.consumedAt },
      });
      return consumed.count === 1 ? attempt : null;
    });
  }

  async createSession(input: {
    appUserId: string;
    identityId: string;
    createdAt: Date;
  }) {
    const externalId = randomUUID();
    const issued = issueSessionToken(externalId);
    const absoluteExpiresAt = plus(input.createdAt, SESSION_ABSOLUTE_TTL_MS);
    const session = await this.prisma.$transaction(async (tx) => {
      const created = await tx.authenticationSession.create({
        data: {
          externalId,
          appUserId: input.appUserId,
          identityId: input.identityId,
          tokenHash: opaqueHash(issued.secret, "session"),
          createdAt: input.createdAt,
          lastSeenAt: input.createdAt,
          rotatedAt: input.createdAt,
          idleExpiresAt: earlier(
            plus(input.createdAt, SESSION_IDLE_TTL_MS),
            absoluteExpiresAt,
          ),
          absoluteExpiresAt,
        },
      });
      await tx.authenticationSessionEvent.create({
        data: {
          sessionId: created.id,
          eventType: AuthenticationSessionEventType.CREATED,
          tokenVersion: 1,
          occurredAt: input.createdAt,
        },
      });
      return created;
    });
    return {
      sessionId: session.id,
      token: issued.token,
      expiresAt: session.absoluteExpiresAt,
    };
  }

  async authenticateSessionToken(
    token: string,
    authenticatedAt: Date,
    allowRotation = true,
  ) {
    const parsed = parseSessionToken(token);
    for (let attemptNumber = 0; attemptNumber < 2; attemptNumber += 1) {
      const result = await this.prisma.$transaction(async (tx) => {
        const session = await tx.authenticationSession.findUnique({
          where: { externalId: parsed.externalId },
          include: { identity: true },
        });
        if (!session) return { outcome: "invalid" as const };
        const presentedHash = opaqueHash(parsed.secret, "session");
        const current = hashesEqual(session.tokenHash, presentedHash);
        const previous =
          session.previousTokenHash !== null &&
          session.previousTokenValidUntil !== null &&
          session.previousTokenValidUntil.getTime() >
            authenticatedAt.getTime() &&
          hashesEqual(session.previousTokenHash, presentedHash);
        if (!current && !previous) return { outcome: "invalid" as const };
        if (session.revokedAt) return { outcome: "revoked" as const };
        if (
          session.idleExpiresAt.getTime() <= authenticatedAt.getTime() ||
          session.absoluteExpiresAt.getTime() <= authenticatedAt.getTime()
        ) {
          const expired = await tx.authenticationSession.updateMany({
            where: { id: session.id, revokedAt: null },
            data: {
              revokedAt: authenticatedAt,
              revocationReason: "EXPIRED",
            },
          });
          if (expired.count === 1) {
            await tx.authenticationSessionEvent.create({
              data: {
                sessionId: session.id,
                eventType: AuthenticationSessionEventType.EXPIRED,
                tokenVersion: session.tokenVersion,
                reasonCode: "EXPIRED",
                occurredAt: authenticatedAt,
              },
            });
          }
          return { outcome: "expired" as const };
        }

        const identity = {
          provider: session.identity.provider,
          providerSubject: session.identity.providerSubject,
        };
        const idleExpiresAt = earlier(
          plus(authenticatedAt, SESSION_IDLE_TTL_MS),
          session.absoluteExpiresAt,
        );
        if (
          allowRotation &&
          current &&
          authenticatedAt.getTime() - session.rotatedAt.getTime() >=
            SESSION_ROTATION_MS
        ) {
          const rotated = issueSessionToken(session.externalId);
          const updated = await tx.authenticationSession.updateMany({
            where: {
              id: session.id,
              tokenVersion: session.tokenVersion,
              tokenHash: session.tokenHash,
              revokedAt: null,
            },
            data: {
              tokenHash: opaqueHash(rotated.secret, "session"),
              previousTokenHash: session.tokenHash,
              previousTokenValidUntil: plus(
                authenticatedAt,
                SESSION_ROTATION_GRACE_MS,
              ),
              tokenVersion: session.tokenVersion + 1,
              lastSeenAt: authenticatedAt,
              rotatedAt: authenticatedAt,
              idleExpiresAt,
            },
          });
          if (updated.count !== 1) return { outcome: "retry" as const };
          await tx.authenticationSessionEvent.create({
            data: {
              sessionId: session.id,
              eventType: AuthenticationSessionEventType.ROTATED,
              tokenVersion: session.tokenVersion + 1,
              occurredAt: authenticatedAt,
            },
          });
          return {
            outcome: "authenticated" as const,
            identity,
            appUserId: session.appUserId,
            sessionId: session.id,
            rotatedToken: rotated.token,
            expiresAt: session.absoluteExpiresAt,
          };
        }
        await tx.authenticationSession.update({
          where: { id: session.id },
          data: { lastSeenAt: authenticatedAt, idleExpiresAt },
        });
        return {
          outcome: "authenticated" as const,
          identity,
          appUserId: session.appUserId,
          sessionId: session.id,
          rotatedToken: null,
          expiresAt: session.absoluteExpiresAt,
        };
      });
      if (result.outcome !== "retry") return result;
    }
    return { outcome: "invalid" as const };
  }

  async revokeSessionToken(
    token: string,
    revokedAt: Date,
    reasonCode = "USER_SIGN_OUT",
  ) {
    const parsed = parseSessionToken(token);
    return this.prisma.$transaction(async (tx) => {
      const session = await tx.authenticationSession.findUnique({
        where: { externalId: parsed.externalId },
      });
      if (!session || session.revokedAt) return false;
      const presentedHash = opaqueHash(parsed.secret, "session");
      const matches =
        hashesEqual(session.tokenHash, presentedHash) ||
        (session.previousTokenHash !== null &&
          session.previousTokenValidUntil !== null &&
          session.previousTokenValidUntil.getTime() > revokedAt.getTime() &&
          hashesEqual(session.previousTokenHash, presentedHash));
      if (!matches) return false;
      await tx.authenticationSession.update({
        where: { id: session.id },
        data: { revokedAt, revocationReason: reasonCode },
      });
      await tx.authenticationSessionEvent.create({
        data: {
          sessionId: session.id,
          eventType: AuthenticationSessionEventType.REVOKED,
          tokenVersion: session.tokenVersion,
          reasonCode,
          occurredAt: revokedAt,
        },
      });
      return true;
    });
  }
}

export { OAuthAttemptPurpose };
