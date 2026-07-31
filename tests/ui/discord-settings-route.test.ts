import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const route = readFileSync(
  "src/app/api/admin/discord-settings/route.ts",
  "utf8",
);
const repository = readFileSync(
  "src/server/data/discord-settings-repository.ts",
  "utf8",
);

describe("Discord settings HTTP boundary", () => {
  it("requires exact Account administration and same-origin writes", () => {
    expect(route).toContain('"account.manage"');
    expect(route).toContain("authorizeProtectedRequest");
    expect(route).toContain("requireSameOrigin(request)");
    expect(route).toContain('"Cache-Control": "no-store"');
  });

  it("exposes revision ETags and non-enumerating resource errors", () => {
    expect(route).toContain(
      "discord-settings-${configuration.settings.revision}",
    );
    expect(route).toContain("The Discord settings resource is unavailable.");
    expect(route).not.toContain("credentialReference");
    expect(route).not.toContain("channelId:");
  });

  it("returns managed destination references without raw credentials or channel IDs", () => {
    expect(repository).toContain("channelReference:");
    expect(repository).not.toMatch(/credentialReference:\s*installation/u);
    expect(repository).not.toMatch(/channelId:\s*route\.destination/u);
  });
});
