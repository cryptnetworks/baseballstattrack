import { describe, expect, it } from "vitest";

import {
  discordInstallationCommandSchema,
  discordInstallationCallbackSchema,
  DISCORD_INSTALLATION_PERMISSIONS,
  DISCORD_INSTALLATION_PERMISSION_FLAGS,
  DISCORD_INSTALLATION_SCOPES,
} from "@/domain/discord-installation";

describe("Discord installation contract", () => {
  it("requests only the documented scopes and minimum permissions", () => {
    expect(DISCORD_INSTALLATION_SCOPES).toEqual([
      "identify",
      "guilds",
      "bot",
      "applications.commands",
    ]);
    expect(DISCORD_INSTALLATION_PERMISSIONS).toBe(
      DISCORD_INSTALLATION_PERMISSION_FLAGS.viewChannel |
        DISCORD_INSTALLATION_PERMISSION_FLAGS.sendMessages |
        DISCORD_INSTALLATION_PERMISSION_FLAGS.useApplicationCommands,
    );
    expect(DISCORD_INSTALLATION_PERMISSIONS & (1n << 3n)).toBe(0n);
  });

  it("strictly validates start, disconnect, and callback boundaries", () => {
    expect(
      discordInstallationCommandSchema.safeParse({
        action: "start",
        accountId: "account-a",
        guildId: "123456789012345678",
      }).success,
    ).toBe(false);
    expect(
      discordInstallationCommandSchema.safeParse({
        action: "disconnect",
        accountId: "account-a",
        installationId: "00000000-0000-4000-8000-000000000110",
      }).success,
    ).toBe(true);
    expect(
      discordInstallationCallbackSchema.safeParse({
        code: "valid-code-value",
        state: "a".repeat(43),
        guildId: "not-a-guild",
        permissions: "0",
      }).success,
    ).toBe(false);
  });
});
