import { describe, expect, it, vi } from "vitest";

import { DiscordPermissionsService } from "@/server/app/discord-permissions-service";
import {
  createTrustedActorContext,
  type Capability,
} from "@/server/auth/types";
import { DiscordPermissionsConflictError } from "@/server/data/discord-permissions-repository";

const ACCOUNT = "account-a";
const INSTALLATION = "00000000-0000-4000-8000-000000000701";
const ROLE = "00000000-0000-4000-8000-000000000702";

function actor(capability: Capability, accountId = ACCOUNT) {
  return createTrustedActorContext({
    accountId,
    appUserId: "user-a",
    membershipId: "membership-a",
    actorKind: "USER",
    actorId: "user-a",
    actorUserId: "user-a",
    capability,
    authorityReferenceIds: ["role-a"],
    target: {
      kind: "ACCOUNT",
      accountId,
      teamIds: [],
      seasonId: null,
      gameId: null,
    },
    authorizedAt: "2026-07-31T23:40:00.000Z",
  });
}

function update() {
  return {
    accountId: ACCOUNT,
    installationId: INSTALLATION,
    roleId: ROLE,
    expectedRevision: 0,
    actions: ["READ_ONLY" as const, "CONFIGURE" as const],
    reasonCode: "SERVER_ADMIN_POLICY",
  };
}

describe("Discord permissions service", () => {
  it("uses separate view, configure, and operational capabilities", async () => {
    const repository = {
      listGrants: vi.fn().mockResolvedValue({ grants: [] }),
      listAuditHistory: vi.fn().mockResolvedValue([]),
      writeGrant: vi
        .fn()
        .mockResolvedValue({ outcome: "updated", grant: { revision: 1 } }),
    };
    const service = new DiscordPermissionsService(repository as never);

    await expect(
      service.list(ACCOUNT, INSTALLATION, actor("discord.settings.view")),
    ).resolves.toEqual({ grants: [] });
    await expect(
      service.history(ACCOUNT, INSTALLATION, actor("discord.settings.operate")),
    ).resolves.toEqual([]);
    await expect(
      service.update(update(), actor("discord.settings.configure")),
    ).resolves.toEqual({ revision: 1 });
    expect(repository.writeGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        reasonCode: "SERVER_ADMIN_POLICY",
        actor: expect.objectContaining({ accountId: ACCOUNT }),
      }),
    );
  });

  it("rejects cross-account actors before repository access", async () => {
    const repository = { writeGrant: vi.fn() };
    const service = new DiscordPermissionsService(repository as never);
    await expect(
      service.update(
        update(),
        actor("discord.settings.configure", "account-b"),
      ),
    ).rejects.toThrow();
    expect(repository.writeGrant).not.toHaveBeenCalled();
  });

  it("maps stale guild evidence and revision races to safe errors", async () => {
    const stale = new DiscordPermissionsService({
      writeGrant: vi.fn().mockResolvedValue({ outcome: "membership_stale" }),
    } as never);
    await expect(
      stale.update(update(), actor("discord.settings.configure")),
    ).rejects.toMatchObject({ code: "MEMBERSHIP_STALE", status: 403 });

    const conflict = new DiscordPermissionsService({
      writeGrant: vi
        .fn()
        .mockRejectedValue(new DiscordPermissionsConflictError()),
    } as never);
    await expect(
      conflict.update(update(), actor("discord.settings.configure")),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT", status: 409 });
  });
});
