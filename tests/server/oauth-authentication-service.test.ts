import { randomUUID } from "node:crypto";

import { OAuthAttemptPurpose } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OAuthAuthenticationService } from "@/server/app/oauth-authentication-service";
import { encryptAuthenticationPayload } from "@/server/auth/authentication-crypto";
import type { AuthenticationAdapter } from "@/server/auth/oauth-provider";
import {
  AuthenticationIdentityConflictError,
  AuthenticationUserInactiveError,
  type PrismaAuthenticationRepository,
} from "@/server/data/authentication-repository";

const key = Buffer.alloc(32, 9).toString("base64url");
const externalId = randomUUID();
const browserBinding = "b".repeat(43);
const repository = {
  createOAuthAttempt: vi.fn(),
  consumeOAuthAttempt: vi.fn(),
  resolveOrCreateIdentity: vi.fn(),
  linkIdentity: vi.fn(),
  createSession: vi.fn(),
};
const adapter: AuthenticationAdapter = {
  key: "google",
  label: "Google",
  authorizationUrl: vi.fn(
    ({ state }) =>
      new URL(`https://accounts.example.test/authorize?state=${state}`),
  ),
  exchange: vi.fn(),
};
const now = new Date("2026-08-03T12:00:00.000Z");

function service() {
  return new OAuthAuthenticationService(
    repository as unknown as Pick<
      PrismaAuthenticationRepository,
      | "createOAuthAttempt"
      | "consumeOAuthAttempt"
      | "resolveOrCreateIdentity"
      | "linkIdentity"
      | "createSession"
    >,
    new Map([["google", adapter]]),
    "https://app.example.test/auth/callback",
    () => now,
  );
}

function validAttempt(
  purpose: OAuthAttemptPurpose = OAuthAttemptPurpose.SIGN_IN,
) {
  return {
    provider: "google",
    purpose,
    appUserId: purpose === OAuthAttemptPurpose.LINK ? "user-a" : null,
    initiatingSessionId:
      purpose === OAuthAttemptPurpose.LINK ? "session-a" : null,
    redirectUri: "https://app.example.test/auth/callback",
    returnTo: "/accounts",
    encryptedSecrets: encryptAuthenticationPayload({
      codeVerifier: "v".repeat(43),
      nonce: "n".repeat(43),
    }),
  };
}

describe("OAuth authentication orchestration", () => {
  beforeEach(() => {
    vi.stubEnv("AUTHENTICATION_ENCRYPTION_KEY", key);
    for (const mock of Object.values(repository)) mock.mockReset();
    vi.mocked(adapter.authorizationUrl).mockClear();
    vi.mocked(adapter.exchange).mockReset();
  });

  afterEach(() => vi.unstubAllEnvs());

  it("persists only state/browser hashes and encrypted PKCE material", async () => {
    repository.createOAuthAttempt.mockResolvedValue({});
    const started = await service().startSignIn("google");
    expect(started.authorizationUrl).toContain("https://accounts.example.test");
    expect(started.cookie).toMatchObject({
      name: "bst_oauth_attempt",
      options: { httpOnly: true, sameSite: "lax", maxAge: 600 },
    });
    const persisted = repository.createOAuthAttempt.mock.calls[0]![0];
    expect(persisted.stateHash).toMatch(/^hmac-sha256:v1:/u);
    expect(persisted.browserBindingHash).toMatch(/^hmac-sha256:v1:/u);
    expect(persisted.encryptedSecrets).toMatch(/^aes-256-gcm:v1:/u);
    expect(persisted.encryptedSecrets).not.toContain("codeVerifier");
  });

  it("rejects invalid, expired, mismatched, or replayed callback state", async () => {
    repository.consumeOAuthAttempt.mockResolvedValue(null);
    await expect(
      service().complete({
        code: "c".repeat(16),
        state: "s".repeat(43),
        attemptCookie: `${externalId}.${browserBinding}`,
      }),
    ).rejects.toMatchObject({ code: "INVALID_OAUTH_CALLBACK" });
    expect(adapter.exchange).not.toHaveBeenCalled();
  });

  it("creates an application-owned identity and session from server claims", async () => {
    repository.consumeOAuthAttempt.mockResolvedValue(validAttempt());
    vi.mocked(adapter.exchange).mockResolvedValue({
      provider: "google",
      subject: "stable-provider-subject",
      email: "mutable@example.test",
      emailVerified: true,
    });
    repository.resolveOrCreateIdentity.mockResolvedValue({
      appUserId: "user-a",
      identityId: "identity-a",
    });
    repository.createSession.mockResolvedValue({
      token: `bst1.${externalId}.${"t".repeat(43)}`,
      expiresAt: new Date("2026-09-02T12:00:00.000Z"),
    });
    await expect(
      service().complete({
        code: "c".repeat(16),
        state: "s".repeat(43),
        attemptCookie: `${externalId}.${browserBinding}`,
      }),
    ).resolves.toMatchObject({
      returnTo: "/accounts",
      sessionCookie: { name: "bst_session", options: { httpOnly: true } },
    });
    expect(repository.resolveOrCreateIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "stable-provider-subject" }),
      now,
    );
    expect(repository.createSession).toHaveBeenCalledWith({
      appUserId: "user-a",
      identityId: "identity-a",
      createdAt: now,
    });
  });

  it("refuses an explicit link already owned by another application user", async () => {
    repository.consumeOAuthAttempt.mockResolvedValue(
      validAttempt(OAuthAttemptPurpose.LINK),
    );
    vi.mocked(adapter.exchange).mockResolvedValue({
      provider: "google",
      subject: "already-owned",
      email: null,
      emailVerified: null,
    });
    repository.linkIdentity.mockRejectedValue(
      new AuthenticationIdentityConflictError(),
    );
    await expect(
      service().complete({
        code: "c".repeat(16),
        state: "s".repeat(43),
        attemptCookie: `${externalId}.${browserBinding}`,
      }),
    ).rejects.toMatchObject({ code: "IDENTITY_ALREADY_LINKED" });
    expect(repository.createSession).not.toHaveBeenCalled();
  });

  it("does not issue a session for a disabled application user", async () => {
    repository.consumeOAuthAttempt.mockResolvedValue(validAttempt());
    vi.mocked(adapter.exchange).mockResolvedValue({
      provider: "google",
      subject: "disabled-subject",
      email: "mutable@example.test",
      emailVerified: true,
    });
    repository.resolveOrCreateIdentity.mockRejectedValue(
      new AuthenticationUserInactiveError(),
    );
    await expect(
      service().complete({
        code: "c".repeat(16),
        state: "s".repeat(43),
        attemptCookie: `${externalId}.${browserBinding}`,
      }),
    ).rejects.toMatchObject({ code: "USER_DISABLED" });
    expect(repository.createSession).not.toHaveBeenCalled();
  });
});
