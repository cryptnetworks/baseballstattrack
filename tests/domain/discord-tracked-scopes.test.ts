import { describe, expect, it } from "vitest";

import {
  discordGameScopeCategory,
  discordGameScopeTreatments,
  discordTrackedScopesUpdateSchema,
  parseDiscordTrackedScopeKey,
} from "@/domain/discord-tracked-scopes";

const teamId = "00000000-0000-4000-8000-000000001201";
const seasonId = "00000000-0000-4000-8000-000000001202";

describe("Discord tracked scopes", () => {
  it("parses public team-season pairs and rejects duplicate selections", () => {
    expect(parseDiscordTrackedScopeKey(`${teamId}:${seasonId}`)).toEqual({
      teamId,
      seasonId,
    });
    expect(() => parseDiscordTrackedScopeKey(`${teamId}:invalid`)).toThrow();
    expect(
      discordTrackedScopesUpdateSchema.safeParse({
        accountId: "account-a",
        installationId: "00000000-0000-4000-8000-000000001203",
        expectedRevision: 2,
        trackedScopes: [
          { teamId, seasonId },
          { teamId, seasonId },
        ],
      }).success,
    ).toBe(false);
  });

  it("classifies every canonical game lifecycle deliberately", () => {
    expect(discordGameScopeCategory("DRAFT", false)).toBe("upcoming");
    expect(discordGameScopeCategory("READY", false)).toBe("upcoming");
    expect(discordGameScopeCategory("IN_PROGRESS", false)).toBe("inProgress");
    expect(discordGameScopeCategory("SUSPENDED", false)).toBe("inProgress");
    expect(discordGameScopeCategory("COMPLETED", false)).toBe("completed");
    expect(discordGameScopeCategory("VERIFIED", false)).toBe("completed");
    expect(discordGameScopeCategory("CORRECTED", false)).toBe("corrected");
    expect(discordGameScopeCategory("ABANDONED", false)).toBe("incomplete");
    expect(discordGameScopeCategory("CANCELLED", false)).toBe("incomplete");
    expect(discordGameScopeCategory("CORRECTED", true)).toBe("archived");
    expect(discordGameScopeTreatments).toHaveLength(6);
  });
});
