import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DiscordTrackedScopesPanel } from "@/components/discord/discord-tracked-scopes-panel";

const accountId = "account-a";
const installationId = "00000000-0000-4000-8000-000000001221";
const teamId = "00000000-0000-4000-8000-000000001222";
const seasonId = "00000000-0000-4000-8000-000000001223";
const games = {
  upcoming: 1,
  inProgress: 2,
  completed: 3,
  corrected: 4,
  archived: 5,
  incomplete: 6,
};

function panel(
  overrides: Partial<Parameters<typeof DiscordTrackedScopesPanel>[0]> = {},
) {
  return renderToStaticMarkup(
    <DiscordTrackedScopesPanel
      accountId={accountId}
      installationId={installationId}
      revision={8}
      scopes={[
        {
          teamId,
          teamName: "Falcons",
          seasonId,
          seasonName: "2027",
          seasonStatus: "ACTIVE",
          startsOn: new Date("2027-03-01T00:00:00.000Z"),
          endsOn: new Date("2027-07-31T00:00:00.000Z"),
          available: true,
          staleReasons: [],
          selected: true,
          games,
          gameCount: 21,
        },
      ]}
      selectedCount={1}
      staleSelectedCount={0}
      {...overrides}
    />,
  );
}

describe("Discord tracked scopes panel", () => {
  it("explains all lifecycle states and renders an accessible pause control", () => {
    const html = panel();
    for (const label of [
      "Upcoming",
      "In progress",
      "Completed",
      "Corrected",
      "Archived",
      "Incomplete",
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("Falcons — 2027");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('checked=""');
    expect(html).toContain("pause tracking without disconnecting Discord");
    expect(html).toContain("Save tracked teams");
    expect(html).toContain("min-h-11");
    expect(html).not.toMatch(/credentialReference|guildId|teamSeasonId/iu);
  });

  it("renders deliberate empty and stale-selected states", () => {
    expect(panel({ scopes: [], selectedCount: 0 })).toContain(
      "No active team-season is available",
    );
    const stale = panel({
      scopes: [
        {
          teamId,
          teamName: "Falcons",
          seasonId,
          seasonName: "2026",
          seasonStatus: "ARCHIVED",
          startsOn: null,
          endsOn: null,
          available: false,
          staleReasons: ["season archived"],
          selected: true,
          games,
          gameCount: 21,
        },
      ],
      selectedCount: 0,
      staleSelectedCount: 1,
    });
    expect(stale).toContain('role="alert"');
    expect(stale).toContain("Archived team-season history");
    expect(stale).toContain("(stale selection)");
    expect(stale).not.toContain('type="checkbox"');
  });

  it("protects saves with a server action and exact Account capability", () => {
    const action = readFileSync("src/app/discord/scope-actions.ts", "utf8");
    const service = readFileSync(
      "src/server/app/discord-tracked-scopes-service.ts",
      "utf8",
    );
    expect(action).toContain('"use server"');
    expect(action).toContain("authorizeProtectedAction");
    expect(action).toContain('capability: "discord.settings.configure"');
    expect(service).toContain('"discord.settings.view"');
    expect(service).toContain('"discord.settings.configure"');
    expect(service).toContain('actor.target.kind !== "ACCOUNT"');
  });
});
