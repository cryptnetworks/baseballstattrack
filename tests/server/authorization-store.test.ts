import { type PrismaClient, UserStatus } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  safeAuthorizationMessage,
  safeAuthorizationStatus,
} from "@/server/auth/errors";
import { PrismaAuthorizationStore } from "@/server/auth/store";

const identity = {
  provider: "google" as const,
  providerSubject: "provider-subject",
};

function createStore(findUnique: ReturnType<typeof vi.fn>) {
  return new PrismaAuthorizationStore({
    authenticationIdentity: { findUnique },
  } as unknown as PrismaClient);
}

describe("Prisma authorization identity resolution", () => {
  it("returns the application user attached to an exact provider subject", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      appUser: { id: "user-a", status: UserStatus.ACTIVE },
    });
    await expect(
      createStore(findUnique).resolveUser(identity),
    ).resolves.toEqual({ id: "user-a", active: true });
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          provider_providerSubject: {
            provider: "google",
            providerSubject: "provider-subject",
          },
        },
      }),
    );
  });

  it("preserves disabled application-user state", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      appUser: { id: "user-a", status: UserStatus.DISABLED },
    });
    await expect(
      createStore(findUnique).resolveUser(identity),
    ).resolves.toEqual({ id: "user-a", active: false });
  });

  it("never provisions, falls back to email, or reveals a missing identity", async () => {
    const error = await createStore(vi.fn().mockResolvedValue(null))
      .resolveUser(identity)
      .catch((failure: unknown) => failure);
    expect(error).toMatchObject({ code: "USER_PROVISIONING_FAILURE" });
    expect(safeAuthorizationStatus(error)).toBe(500);
    expect(safeAuthorizationMessage(error)).toBe(
      "Authentication is temporarily unavailable.",
    );
  });
});
