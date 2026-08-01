import { describe, expect, it } from "vitest";

import {
  discordRoleGrantUpdateSchema,
  discordPermissionUiFailure,
  evaluateDiscordPermissions,
} from "@/domain/discord-permissions";

const NOW = new Date("2026-07-31T23:40:00.000Z");

function evidence() {
  return {
    appMembershipActive: true,
    installationStatus: "ACTIVE" as const,
    expectedGuildId: "123456789012345678",
    observedGuildId: "123456789012345678",
    guildMembershipVerifiedAt: new Date("2026-07-31T23:39:00.000Z"),
    observedRoleIds: ["923456789012345678"],
    grants: [
      {
        roleId: "923456789012345678",
        enabled: true,
        status: "ACTIVE" as const,
        actions: ["READ_ONLY" as const, "PREVIEW" as const],
      },
    ],
  };
}

describe("Discord permission evaluation", () => {
  it("combines fresh application and raw Discord role authority", () => {
    expect(evaluateDiscordPermissions(evidence(), "PREVIEW", NOW)).toEqual({
      allowed: true,
      actions: ["READ_ONLY", "PREVIEW"],
    });
  });

  it("fails closed for stale application or guild membership", () => {
    expect(
      evaluateDiscordPermissions(
        { ...evidence(), appMembershipActive: false },
        "READ_ONLY",
        NOW,
      ),
    ).toMatchObject({ allowed: false, code: "APP_MEMBERSHIP_STALE" });
    expect(
      evaluateDiscordPermissions(
        {
          ...evidence(),
          guildMembershipVerifiedAt: new Date("2026-07-31T23:30:00.000Z"),
        },
        "READ_ONLY",
        NOW,
      ),
    ).toMatchObject({ allowed: false, code: "GUILD_MEMBERSHIP_STALE" });
  });

  it("rejects guild mismatches, unavailable roles, and missing actions", () => {
    expect(
      evaluateDiscordPermissions(
        { ...evidence(), observedGuildId: "223456789012345678" },
        "READ_ONLY",
        NOW,
      ),
    ).toMatchObject({ allowed: false, code: "GUILD_MISMATCH" });
    expect(
      evaluateDiscordPermissions(
        { ...evidence(), observedRoleIds: ["823456789012345678"] },
        "READ_ONLY",
        NOW,
      ),
    ).toMatchObject({ allowed: false, code: "ROLE_UNAVAILABLE" });
    expect(
      evaluateDiscordPermissions(evidence(), "OPERATE", NOW),
    ).toMatchObject({ allowed: false, code: "ACTION_NOT_GRANTED" });
  });

  it("does not accept role names or duplicate actions as authority input", () => {
    expect(Object.keys(evidence().grants[0]!)).not.toContain("displayName");
    expect(() =>
      discordRoleGrantUpdateSchema.parse({
        accountId: "account-a",
        installationId: "00000000-0000-4000-8000-000000000701",
        roleId: "00000000-0000-4000-8000-000000000702",
        expectedRevision: 0,
        actions: ["CONFIGURE", "CONFIGURE"],
      }),
    ).toThrow();
  });

  it("turns authorization failures into safe UI recovery guidance", () => {
    expect(discordPermissionUiFailure("DISCORD_MEMBERSHIP_STALE")).toEqual({
      title: "Discord access needs verification",
      recovery: "Refresh your Discord membership before trying again.",
    });
    expect(discordPermissionUiFailure("UNRECOGNIZED_INTERNAL_DETAIL")).toEqual({
      title: "Discord action unavailable",
      recovery: "Try again or contact an account administrator.",
    });
  });
});
