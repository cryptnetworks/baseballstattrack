import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ApplicationSessionService,
  applicationSessionCookie,
  type SessionCookieStore,
} from "@/server/auth/application-session";
import type { PrismaAuthenticationRepository } from "@/server/data/authentication-repository";

const authenticateSessionToken = vi.fn();
const revokeSessionToken = vi.fn();
const repository = {
  authenticateSessionToken,
  revokeSessionToken,
} as unknown as Pick<
  PrismaAuthenticationRepository,
  "authenticateSessionToken" | "revokeSessionToken"
>;
const storedCookies: Array<{ name: string; value: string }> = [];
const cookieStore: SessionCookieStore = {
  getAll: () => [
    { name: applicationSessionCookie.name, value: "opaque-session-token" },
  ],
  setAll: (values) => storedCookies.push(...values),
};
const authenticated = {
  outcome: "authenticated" as const,
  identity: { provider: "google", providerSubject: "provider-subject" },
  appUserId: "user-a",
  sessionId: "session-a",
  rotatedToken: null,
  expiresAt: new Date("2026-09-01T00:00:00.000Z"),
};

describe("application-owned session authentication", () => {
  beforeEach(() => {
    storedCookies.length = 0;
    authenticateSessionToken.mockReset();
    revokeSessionToken.mockReset();
  });

  it("returns only the exact server-resolved provider subject", async () => {
    authenticateSessionToken.mockResolvedValue(authenticated);
    const service = new ApplicationSessionService(repository);
    await expect(service.authenticateCookies(cookieStore)).resolves.toEqual({
      provider: "google",
      providerSubject: "provider-subject",
    });
    expect(authenticateSessionToken).toHaveBeenCalledWith(
      "opaque-session-token",
      expect.any(Date),
      true,
    );
  });

  it.each(["invalid", "revoked"] as const)(
    "rejects %s sessions without disclosing lifecycle state",
    async (outcome) => {
      authenticateSessionToken.mockResolvedValue({ outcome });
      await expect(
        new ApplicationSessionService(repository).authenticateCookies(
          cookieStore,
        ),
      ).rejects.toMatchObject({ code: "INVALID_SESSION" });
    },
  );

  it("reports an expired session through the common safe status boundary", async () => {
    authenticateSessionToken.mockResolvedValue({ outcome: "expired" });
    await expect(
      new ApplicationSessionService(repository).authenticateCookies(
        cookieStore,
      ),
    ).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
  });

  it("rotates cookie sessions but does not rotate bearer requests", async () => {
    authenticateSessionToken.mockResolvedValueOnce({
      ...authenticated,
      rotatedToken: "rotated-session-token",
    });
    const service = new ApplicationSessionService(repository);
    await service.authenticateCookies(cookieStore);
    expect(storedCookies).toContainEqual(
      expect.objectContaining({
        name: applicationSessionCookie.name,
        value: "rotated-session-token",
        options: expect.objectContaining({
          httpOnly: true,
          sameSite: "lax",
        }),
      }),
    );

    authenticateSessionToken.mockResolvedValueOnce(authenticated);
    await service.authenticateRequest(
      new Request("https://app.example.test/api/auth/context", {
        headers: { authorization: "Bearer bearer-session-token" },
      }),
      cookieStore,
    );
    expect(authenticateSessionToken).toHaveBeenLastCalledWith(
      "bearer-session-token",
      expect.any(Date),
      false,
    );
  });

  it("revokes the server session and expires the secure cookie", async () => {
    revokeSessionToken.mockResolvedValue(true);
    await new ApplicationSessionService(repository).revokeCookies(cookieStore);
    expect(revokeSessionToken).toHaveBeenCalledWith(
      "opaque-session-token",
      expect.any(Date),
      "USER_SIGN_OUT",
    );
    expect(storedCookies.at(-1)).toMatchObject({
      name: applicationSessionCookie.name,
      value: "",
      options: { httpOnly: true, maxAge: 0 },
    });
  });
});
