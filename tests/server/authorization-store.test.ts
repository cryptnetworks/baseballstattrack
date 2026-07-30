import { Prisma, type PrismaClient, UserStatus } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  safeAuthorizationMessage,
  safeAuthorizationStatus,
} from "@/server/auth/errors";
import { PrismaAuthorizationStore } from "@/server/auth/store";
import { AUTH_PROVIDER } from "@/server/auth/types";

const identity = {
  provider: AUTH_PROVIDER,
  providerSubject: "provider-subject",
} as const;
const activeUser = { id: "user-a", status: UserStatus.ACTIVE };

function uniqueConflict(fields: string[], modelName: unknown = "AppUser") {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: {
      modelName,
      driverAdapterError: {
        cause: {
          constraint: { fields },
        },
      },
    },
  });
}

function createStore(input: {
  findUnique: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
}) {
  return new PrismaAuthorizationStore({
    appUser: input,
  } as unknown as PrismaClient);
}

describe("Prisma authorization user provisioning", () => {
  it("returns an existing stable identity without writing", async () => {
    const findUnique = vi.fn().mockResolvedValue(activeUser);
    const create = vi.fn();
    await expect(
      createStore({ findUnique, create }).resolveOrProvisionUser(identity),
    ).resolves.toEqual({ id: "user-a", active: true });
    expect(create).not.toHaveBeenCalled();
  });

  it("recovers only the exact provider identity conflict", async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(activeUser);
    const create = vi
      .fn()
      .mockRejectedValue(uniqueConflict(["provider", '"providerSubject"']));
    await expect(
      createStore({ findUnique, create }).resolveOrProvisionUser(identity),
    ).resolves.toEqual({ id: "user-a", active: true });
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it("rereads within the bound when the winner becomes visible later", async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(activeUser);
    const create = vi
      .fn()
      .mockRejectedValue(uniqueConflict(["provider", "providerSubject"]));
    await expect(
      createStore({ findUnique, create }).resolveOrProvisionUser(identity),
    ).resolves.toEqual({ id: "user-a", active: true });
    expect(findUnique).toHaveBeenCalledTimes(3);
  });

  it("bounds visibility rereads and returns a safe typed failure", async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const create = vi
      .fn()
      .mockRejectedValue(uniqueConflict(["provider", '"providerSubject"']));
    const store = createStore({ findUnique, create });
    const error = await store
      .resolveOrProvisionUser(identity)
      .catch((failure: unknown) => failure);
    expect(error).toMatchObject({ code: "USER_PROVISIONING_FAILURE" });
    expect(findUnique).toHaveBeenCalledTimes(4);
    expect(safeAuthorizationStatus(error)).toBe(500);
    expect(safeAuthorizationMessage(error)).toBe(
      "Authentication is temporarily unavailable.",
    );
  });

  it("does not swallow unrelated or malformed unique conflicts", async () => {
    for (const failure of [
      uniqueConflict(["provider"]),
      uniqueConflict(["provider", '"providerSubject"'], "OtherModel"),
      { code: "P2002", meta: { modelName: "AppUser" } },
    ]) {
      const store = createStore({
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockRejectedValue(failure),
      });
      await expect(
        store.resolveOrProvisionUser(identity),
      ).rejects.toMatchObject({ code: "USER_PROVISIONING_FAILURE" });
    }
  });
});
