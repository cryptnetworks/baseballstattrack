import { describe, expect, it, vi } from "vitest";

import { createAuthContextHandler } from "@/app/api/auth/context/route";
import type { AuthorizationService } from "@/server/auth/authorization-service";
import { AuthorizationError } from "@/server/auth/errors";
import { authorizeProtectedAction } from "@/server/auth/protected-boundary";
import { AUTH_PROVIDER } from "@/server/auth/types";

describe("protected framework boundaries", () => {
  it("calls the route handler directly and returns only minimum authority", async () => {
    const authorize = vi.fn().mockResolvedValue({
      accountId: "account-a",
      capability: "account.view",
      authorizedAt: "2026-07-30T00:00:00.000Z",
      providerSubject: "must-not-be-serialized",
      membershipId: "must-not-be-serialized",
    });
    const response = await createAuthContextHandler(authorize)(
      new Request(
        "https://app.example.test/api/auth/context?accountId=account-a",
      ),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      accountId: "account-a",
      capability: "account.view",
      authorizedAt: "2026-07-30T00:00:00.000Z",
    });
  });

  it("maps invalid and expired sessions to the same safe 401", async () => {
    for (const code of [
      "AUTHENTICATION_REQUIRED",
      "INVALID_SESSION",
      "SESSION_EXPIRED",
    ] as const) {
      const response = await createAuthContextHandler(async () => {
        throw new AuthorizationError(code);
      })(
        new Request(
          "https://app.example.test/api/auth/context?accountId=account-a",
        ),
      );
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        error: "Authentication is required.",
      });
    }
  });

  it("does not distinguish cross-Account, membership, or resource denials", async () => {
    for (const code of [
      "NO_ACTIVE_MEMBERSHIP",
      "ACCOUNT_UNAVAILABLE",
      "RESOURCE_UNAVAILABLE",
      "INSUFFICIENT_CAPABILITY",
    ] as const) {
      const response = await createAuthContextHandler(async () => {
        throw new AuthorizationError(code);
      })(
        new Request(
          "https://app.example.test/api/auth/context?accountId=enumerated-id",
        ),
      );
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: "The requested operation is unavailable.",
      });
    }
  });

  it("rejects malformed identifiers before calling authority", async () => {
    const authorize = vi.fn();
    const response = await createAuthContextHandler(authorize)(
      new Request("https://app.example.test/api/auth/context"),
    );
    expect(response.status).toBe(400);
    expect(authorize).not.toHaveBeenCalled();
  });

  it("protects direct action invocation with origin and server authority", async () => {
    const authenticate = vi.fn().mockResolvedValue({
      provider: AUTH_PROVIDER,
      providerSubject: "provider-subject",
    });
    const authorize = vi.fn().mockResolvedValue({ capability: "team.manage" });
    const authorization = { authorize } as unknown as AuthorizationService;
    await expect(
      authorizeProtectedAction({
        origin: "https://evil.example.test",
        host: "app.example.test",
        authenticate,
        authorization,
        target: {
          kind: "TEAM",
          accountId: "account-a",
          teamId: "team-a",
        },
        capability: "team.manage",
      }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_REQUIRED" });
    expect(authenticate).not.toHaveBeenCalled();

    await expect(
      authorizeProtectedAction({
        origin: "https://app.example.test",
        host: "app.example.test",
        authenticate,
        authorization,
        target: {
          kind: "TEAM",
          accountId: "account-a",
          teamId: "team-a",
        },
        capability: "team.manage",
      }),
    ).resolves.toMatchObject({ capability: "team.manage" });
    expect(authorize).toHaveBeenCalledWith(
      {
        provider: AUTH_PROVIDER,
        providerSubject: "provider-subject",
      },
      { kind: "TEAM", accountId: "account-a", teamId: "team-a" },
      "team.manage",
    );
  });
});
