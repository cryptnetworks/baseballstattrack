import { randomBytes } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  AuthenticationIdentityConflictError,
  AuthenticationSessionInactiveError,
  AuthenticationUserInactiveError,
  PrismaAuthenticationRepository,
} from "@/server/data/authentication-repository";

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const prefix = `provider-neutral-auth-${process.pid}-${Date.now()}`;

integration("provider-neutral authentication persistence", () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl! }),
  });
  const repository = new PrismaAuthenticationRepository(prisma);

  beforeAll(() => {
    process.env.AUTHENTICATION_ENCRYPTION_KEY =
      randomBytes(32).toString("base64url");
  });

  afterAll(() => prisma.$disconnect());

  async function createIdentity(subject: string) {
    const resolved = await repository.resolveOrCreateIdentity(
      {
        provider: "google",
        subject,
        email: "shared@example.test",
        emailVerified: true,
      },
      new Date(),
    );
    return resolved;
  }

  it("never merges distinct provider subjects that share an email", async () => {
    const [left, right] = await Promise.all([
      createIdentity(`${prefix}-left`),
      createIdentity(`${prefix}-right`),
    ]);
    expect(left.appUserId).not.toBe(right.appUserId);
    await expect(
      prisma.authenticationIdentity.count({
        where: { email: "shared@example.test" },
      }),
    ).resolves.toBeGreaterThanOrEqual(2);
  });

  it("prevents duplicate ownership during explicit provider linking", async () => {
    const owner = await createIdentity(`${prefix}-owner`);
    const other = await createIdentity(`${prefix}-other`);
    const session = await repository.createSession({
      appUserId: other.appUserId,
      identityId: other.identityId,
      createdAt: new Date(),
    });
    await expect(
      repository.linkIdentity({
        appUserId: other.appUserId,
        linkedByAppUserId: other.appUserId,
        initiatingSessionId: session.sessionId,
        identity: {
          provider: "google",
          subject: `${prefix}-owner`,
          email: null,
          emailVerified: null,
        },
        reason: "Expected conflict",
        authenticatedAt: new Date(),
      }),
    ).rejects.toBeInstanceOf(AuthenticationIdentityConflictError);
    await expect(
      prisma.authenticationIdentity.findUnique({
        where: { id: owner.identityId },
        select: { appUserId: true },
      }),
    ).resolves.toEqual({ appUserId: owner.appUserId });

    await repository.revokeSessionToken(
      session.token,
      new Date(),
      "LINK_CANCELLED",
    );
    await expect(
      repository.linkIdentity({
        appUserId: other.appUserId,
        linkedByAppUserId: other.appUserId,
        initiatingSessionId: session.sessionId,
        identity: {
          provider: "discord",
          subject: "123456789012345679",
          email: null,
          emailVerified: null,
        },
        reason: "Must not link after revocation",
        authenticatedAt: new Date(),
      }),
    ).rejects.toBeInstanceOf(AuthenticationSessionInactiveError);
  });

  it("does not issue or repopulate profile data for a disabled user", async () => {
    const identity = await createIdentity(`${prefix}-disabled`);
    await prisma.appUser.update({
      where: { id: identity.appUserId },
      data: { status: "DISABLED" },
    });
    await expect(
      repository.resolveOrCreateIdentity(
        {
          provider: "google",
          subject: `${prefix}-disabled`,
          email: "must-not-be-restored@example.test",
          emailVerified: true,
        },
        new Date(),
      ),
    ).rejects.toBeInstanceOf(AuthenticationUserInactiveError);
    await expect(
      prisma.authenticationIdentity.findUnique({
        where: { id: identity.identityId },
        select: { email: true },
      }),
    ).resolves.toEqual({ email: "shared@example.test" });
  });

  it("rotates, replays briefly, expires, and revokes opaque sessions", async () => {
    const identity = await createIdentity(`${prefix}-session`);
    const createdAt = new Date(Date.now() - 16 * 60 * 1_000);
    const session = await repository.createSession({
      appUserId: identity.appUserId,
      identityId: identity.identityId,
      createdAt,
    });
    const authenticatedAt = new Date();
    const rotated = await repository.authenticateSessionToken(
      session.token,
      authenticatedAt,
      true,
    );
    expect(rotated).toMatchObject({
      outcome: "authenticated",
      appUserId: identity.appUserId,
    });
    expect(rotated.outcome === "authenticated" && rotated.rotatedToken).toEqual(
      expect.any(String),
    );
    await expect(
      repository.authenticateSessionToken(
        session.token,
        new Date(authenticatedAt.getTime() + 10_000),
        true,
      ),
    ).resolves.toMatchObject({ outcome: "authenticated" });
    const newToken =
      rotated.outcome === "authenticated" ? rotated.rotatedToken! : "";
    await expect(
      repository.revokeSessionToken(
        newToken,
        new Date(authenticatedAt.getTime() + 20_000),
        "SECURITY_REVIEW",
      ),
    ).resolves.toBe(true);
    await expect(
      repository.authenticateSessionToken(
        newToken,
        new Date(authenticatedAt.getTime() + 21_000),
      ),
    ).resolves.toMatchObject({ outcome: "revoked" });

    const expiring = await repository.createSession({
      appUserId: identity.appUserId,
      identityId: identity.identityId,
      createdAt: new Date(),
    });
    await prisma.authenticationSession.update({
      where: { id: expiring.sessionId },
      data: { idleExpiresAt: new Date(Date.now() - 1) },
    });
    await expect(
      repository.authenticateSessionToken(expiring.token, new Date()),
    ).resolves.toMatchObject({ outcome: "expired" });
  });
});
