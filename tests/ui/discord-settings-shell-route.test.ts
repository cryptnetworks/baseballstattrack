import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const page = readFileSync("src/app/discord/[[...section]]/page.tsx", "utf8");
const action = readFileSync("src/app/discord/actions.ts", "utf8");
const loading = readFileSync("src/app/discord/loading.tsx", "utf8");
const error = readFileSync("src/app/discord/error.tsx", "utf8");
const notFound = readFileSync("src/app/discord/not-found.tsx", "utf8");
const appShell = readFileSync(
  "src/components/app/application-shell.tsx",
  "utf8",
);
const settingsShell = readFileSync(
  "src/components/discord/discord-settings-shell.tsx",
  "utf8",
);

describe("Discord settings shell route", () => {
  it("rechecks session, Account membership, and exact Discord view capability", () => {
    expect(page).toContain("authenticatePageSession");
    expect(page).toContain("listAvailableAccounts(identity)");
    expect(page).toContain('"discord.settings.view"');
    expect(page).toContain("getDiscordInstallationService().list");
    expect(page).toContain('redirect("/login")');
    expect(page).toContain('error.code === "INSUFFICIENT_CAPABILITY"');
    expect(page).not.toContain("guildId");
    expect(page).not.toContain("credentialReference");
  });

  it("fails closed for unknown sections and non-enumerates server selection", () => {
    expect(page).toContain("discordSettingsSectionSchema.safeParse");
    expect(page).toContain("path.length > 1");
    expect(page).toContain("notFound()");
    expect(page).toContain("That Discord server is unavailable");
    expect(page).toMatch(/A safe\s+available server is selected instead/u);
    expect(notFound).toContain("Discord workspace not found");
  });

  it("protects Account switching and provides route-level loading and retry", () => {
    expect(action).toContain('"use server"');
    expect(action).toContain("authorizeProtectedAction");
    expect(action).toContain('"discord.settings.view"');
    expect(action).toContain('endpointClass: "ACCOUNT_SELECTION"');
    expect(action).toContain("selectedAccountCookie");
    expect(loading).toContain("Loading authorized Discord settings…");
    expect(error).toContain('state="failure"');
    expect(error).toContain("onRetry={reset}");
    expect(appShell).toContain('href="/discord"');
    expect(settingsShell).toContain('prefetch={item.id !== "preview"}');
  });
});
