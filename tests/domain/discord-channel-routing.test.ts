import { describe, expect, it } from "vitest";

import {
  discordChannelRoutingSchema,
  discordRoutingCategories,
  groupDiscordRoutes,
} from "@/domain/discord-channel-routing";
import { discordDestinationPurposes } from "@/domain/discord-settings";

const destination = "00000000-0000-4000-8000-000000000801";

describe("Discord channel routing contract", () => {
  it("defines every required output category exactly once", () => {
    expect(discordRoutingCategories.map(({ id }) => id)).toEqual(
      discordDestinationPurposes,
    );
    expect(discordDestinationPurposes).toEqual([
      "LIVE_UPDATES",
      "FINAL_SCORES",
      "CORRECTIONS",
      "SUMMARIES",
      "ERRORS",
      "DIGESTS",
    ]);
  });

  it("groups categories by destination and preserves disabled routes", () => {
    const routes = {
      LIVE_UPDATES: destination,
      FINAL_SCORES: destination,
      CORRECTIONS: null,
      SUMMARIES: null,
      ERRORS: null,
      DIGESTS: null,
    };
    expect(
      discordChannelRoutingSchema.parse({
        accountId: "account-a",
        installationId: "00000000-0000-4000-8000-000000000802",
        expectedRevision: 3,
        routes,
      }),
    ).toMatchObject({ routes });
    expect(groupDiscordRoutes(routes)).toEqual([
      {
        destinationId: destination,
        purposes: ["LIVE_UPDATES", "FINAL_SCORES"],
      },
    ]);
  });
});
