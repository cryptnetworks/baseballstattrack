import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DiscordUpdateContentPanel } from "@/components/discord/discord-update-content-panel";

describe("Discord update content workspace", () => {
  it("renders every trigger, strategy, payload budget, and correction example", () => {
    const markup = renderToStaticMarkup(
      <DiscordUpdateContentPanel
        accountId="account-a"
        installationId="00000000-0000-4000-8000-000000002201"
        notice="content-saved"
        settings={{
          revision: 9,
          triggers: ["SCORING_PLAY", "GAME_COMPLETED", "GAME_CORRECTED"],
          messageStrategy: "APPEND_EVENTS",
          messageFormat: "STANDARD",
        }}
      />,
    );
    for (const copy of [
      "Edit one live message",
      "Append events",
      "Periodic summary",
      "Final only",
      "Game started",
      "Inning changed",
      "Lead changed",
      "Scoring play",
      "Pitching change",
      "Correction accepted",
      "Report ready",
      "1,000 text characters",
      "CORRECTED:",
      "Prior delivery and scoring history remain retained",
      "Update content settings saved",
    ]) {
      expect(markup).toContain(copy);
    }
    expect(markup).toContain("Selected");
    expect(markup).not.toContain("guildId");
    expect(markup).not.toContain("channelId");
  });
});
