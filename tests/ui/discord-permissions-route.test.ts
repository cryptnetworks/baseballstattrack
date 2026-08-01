import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const route = readFileSync(
  join(process.cwd(), "src/app/api/admin/discord-permissions/route.ts"),
  "utf8",
);
const documentation = readFileSync(
  join(process.cwd(), "docs/DISCORD_PERMISSIONS_AND_AUDIT.md"),
  "utf8",
);

describe("Discord permission HTTP boundary", () => {
  it("uses explicit capabilities and same-origin mutation protection", () => {
    expect(route).toContain('"discord.settings.view"');
    expect(route).toContain('"discord.settings.configure"');
    expect(route).toContain('"discord.settings.operate"');
    expect(route).toContain("requireSameOrigin(request)");
    expect(route).toContain('"Cache-Control": "no-store"');
  });

  it("provides stable, non-disclosing recovery codes for future UI", () => {
    expect(route).toContain('"SIGN_IN_REQUIRED"');
    expect(route).toContain('"DISCORD_PERMISSION_REQUIRED"');
    expect(route).toContain('"DISCORD_MEMBERSHIP_STALE"');
    expect(route).toContain('"DISCORD_RESOURCE_UNAVAILABLE"');
    expect(route).toContain('"DISCORD_PERMISSION_CONFLICT"');
    expect(route).toContain('"DISCORD_PERMISSION_TEMPORARILY_UNAVAILABLE"');
    expect(documentation).toContain("Role display names");
    expect(documentation).toContain(
      "are informational only and are never accepted as authorization evidence",
    );
  });
});
