import { describe, expect, it, vi } from "vitest";

import { DiscordActivityService } from "@/server/app/discord-activity-service";
import { trustedActorForTest } from "../fixtures/trusted-actor";

const accountId = "account-activity";
const installationId = "00000000-0000-4000-8000-000000001145";

function actor(
  capability: "discord.settings.operate" | "discord.settings.view",
  targetAccountId = accountId,
) {
  return trustedActorForTest({
    accountId: targetAccountId,
    actorId: "operator-activity",
    actorKind: "SERVICE",
    actorUserId: null,
    capability,
    scope: { kind: "ACCOUNT" },
    authorizedAt: "2026-08-01T10:00:00.000Z",
  });
}

describe("Discord activity service", () => {
  it("requires exact Account operational authority", async () => {
    const repository = { getWorkspace: vi.fn().mockResolvedValue({}) };
    const service = new DiscordActivityService(repository);
    await expect(
      service.get(accountId, installationId, actor("discord.settings.operate")),
    ).resolves.toEqual({});
    await expect(
      service.get(accountId, installationId, actor("discord.settings.view")),
    ).rejects.toThrow();
    await expect(
      service.get(
        accountId,
        installationId,
        actor("discord.settings.operate", "account-other"),
      ),
    ).rejects.toThrow();
    expect(repository.getWorkspace).toHaveBeenCalledTimes(1);
  });

  it("non-enumerates unavailable installations", async () => {
    const service = new DiscordActivityService({
      getWorkspace: vi.fn().mockResolvedValue(null),
    });
    await expect(
      service.get(accountId, installationId, actor("discord.settings.operate")),
    ).rejects.toThrow("activity resource is unavailable");
  });
});
