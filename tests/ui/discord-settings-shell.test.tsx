import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { DiscordSettingsFeedback } from "@/components/discord/discord-settings-feedback";
import { DiscordSettingsShell } from "@/components/discord/discord-settings-shell";

const installation = {
  id: "00000000-0000-4000-8000-000000000111",
  displayName: "Synthetic server",
  status: "ACTIVE" as const,
  updatedAt: new Date("2026-08-01T03:00:00.000Z"),
};
const accounts = [
  { id: "account-a", displayName: "Account A", slug: "account-a" },
  { id: "account-b", displayName: "Account B", slug: "account-b" },
];

function shell(
  overrides: Partial<Parameters<typeof DiscordSettingsShell>[0]> = {},
) {
  return renderToStaticMarkup(
    <DiscordSettingsShell
      accounts={accounts}
      installations={[installation]}
      section="permissions"
      selectAccountAction={vi.fn()}
      selectedAccountId="account-a"
      selectedInstallationId={installation.id}
      {...overrides}
    />,
  );
}

describe("Discord settings shell", () => {
  it("renders labelled native selectors and seven keyboard-operable workspaces", () => {
    const html = shell();
    for (const label of [
      "Overview",
      "Channels",
      "Teams",
      "Updates",
      "Permissions",
      "Preview",
      "Activity",
    ]) {
      expect(html).toContain(`>${label}</a>`);
    }
    expect(html).toContain('aria-label="Discord workspace selection"');
    expect(html).toContain('for="discord-account"');
    expect(html).toContain('for="discord-server"');
    expect(html).toContain("<select");
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("min-h-11");
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("lg:grid-cols-[14rem_minmax(0,1fr)]");
    expect(html).not.toMatch(/bot.?token|credentialReference|guildId/iu);
  });

  it("makes no-account, no-server, and stale lifecycle states explicit", () => {
    expect(
      shell({
        accounts: [],
        installations: [],
        selectedAccountId: null,
        selectedInstallationId: null,
      }),
    ).toContain("No authorized Account is available");
    expect(
      shell({ installations: [], selectedInstallationId: null }),
    ).toContain("Connect a Discord server");
    const stale = shell({
      installations: [{ ...installation, status: "DISCONNECTED" }],
    });
    expect(stale).toContain('role="alert"');
    expect(stale).toContain("Server connection is disconnected");
    expect(stale).toContain("read-only until");
  });

  it("provides explicit saving, saved, validation, and failure feedback", () => {
    expect(
      renderToStaticMarkup(<DiscordSettingsFeedback state="saving" />),
    ).toContain("Saving changes…");
    expect(
      renderToStaticMarkup(<DiscordSettingsFeedback state="saved" />),
    ).toContain("Changes saved.");
    const validation = renderToStaticMarkup(
      <DiscordSettingsFeedback
        errors={[{ fieldId: "cadence", message: "Choose a cadence." }]}
        state="validation-error"
      />,
    );
    expect(validation).toContain('role="alert"');
    expect(validation).toContain('tabindex="-1"');
    expect(validation).toContain('href="#cadence"');
    expect(validation).toContain("Review the highlighted settings");
    const failure = renderToStaticMarkup(
      <DiscordSettingsFeedback onRetry={vi.fn()} state="failure" />,
    );
    expect(failure).toContain("Changes were not saved");
    expect(failure).toContain("prior configuration is unchanged");
    expect(failure).toContain("Try again");
  });

  it("focuses validation and failure summaries after state changes", () => {
    const source = readFileSync(
      "src/components/discord/discord-settings-feedback.tsx",
      "utf8",
    );
    expect(source).toContain('state === "validation-error"');
    expect(source).toContain('state === "failure"');
    expect(source).toContain("summary.current?.focus()");
    expect(source).toContain("tabIndex={-1}");
  });
});
