import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const route = readFileSync(
  "src/app/api/admin/discord-installations/route.ts",
  "utf8",
);
const callback = readFileSync(
  "src/app/api/admin/discord-installations/callback/route.ts",
  "utf8",
);
const panel = readFileSync(
  "src/components/accounts/discord-installation-panel.tsx",
  "utf8",
);
const repository = readFileSync(
  "src/server/data/discord-installation-repository.ts",
  "utf8",
);

describe("Discord installation HTTP and UI boundaries", () => {
  it("requires exact capabilities, same-origin writes, no-store, and rate limits", () => {
    expect(route).toContain('"discord.settings.view"');
    expect(route).toContain('"discord.settings.configure"');
    expect(route).toContain('"discord.settings.operate"');
    expect(route).toContain("authorizeProtectedRequest");
    expect(route).toContain("requireSameOrigin(request)");
    expect(route).toContain('"Cache-Control": "no-store"');
    expect(route).toContain('"DISCORD_PERMISSION_REQUIRED"');
    expect(route).toContain('"DISCORD_RESOURCE_UNAVAILABLE"');
  });

  it("binds and clears callback state without requiring same-origin OAuth", () => {
    expect(callback).toContain("verifyDiscordOAuthState");
    expect(callback).toContain('"discord.settings.configure"');
    expect(callback).toContain("maxAge: 0");
    expect(callback).toContain('"Cache-Control", "no-store"');
    expect(callback).not.toContain("requireSameOrigin(request)");
  });

  it("explains permissions and never exposes credentials", () => {
    expect(panel).toContain("View Channels");
    expect(panel).toContain("Send Messages");
    expect(panel).toMatch(/Use\s+Application Commands/u);
    expect(panel).toContain("Administrator permission");
    expect(panel).toContain("never");
    expect(route).not.toContain("botToken");
    expect(panel).not.toContain("botToken");
    expect(repository).not.toMatch(
      /credentialReference:\s*installation\.credentialReference/u,
    );
    expect(repository).not.toMatch(/guildId:\s*installation\.guildId/u);
  });
});
