import Link from "next/link";
import type { ReactNode } from "react";

import {
  discordSettingsHref,
  discordSettingsSections,
  type DiscordSettingsSection,
} from "@/domain/discord-settings-navigation";

type AccountOption = Readonly<{
  id: string;
  displayName: string;
  slug: string;
}>;

type InstallationOption = Readonly<{
  id: string;
  displayName: string | null;
  status: "PENDING" | "ACTIVE" | "DISCONNECTED" | "REVOKED";
  updatedAt: Date;
}>;

type AccountSelectionAction = (formData: FormData) => void | Promise<void>;

const workspaceCopy: Record<
  DiscordSettingsSection,
  Readonly<{ title: string; description: string; empty: string }>
> = {
  overview: {
    title: "Discord overview",
    description:
      "Review connection health and continue configuration in a focused workspace.",
    empty:
      "This server is connected. Choose a workspace to continue configuration.",
  },
  channels: {
    title: "Channels",
    description:
      "Choose where live updates, reports, and operational messages will be delivered.",
    empty: "No managed Discord channels are configured yet.",
  },
  teams: {
    title: "Teams",
    description:
      "Choose the Account team-seasons this Discord server is allowed to follow.",
    empty: "No team-season scopes are configured yet.",
  },
  updates: {
    title: "Updates",
    description:
      "Control cadence, event triggers, message format, and quiet hours.",
    empty:
      "Update delivery is disabled until settings are configured and saved.",
  },
  permissions: {
    title: "Permissions",
    description:
      "Review which verified Discord roles may use read-only and administrative controls.",
    empty: "No Discord role grants are configured yet.",
  },
  preview: {
    title: "Preview",
    description:
      "Validate effective settings and message rendering before enabling delivery.",
    empty: "Complete the required settings before generating a preview.",
  },
  activity: {
    title: "Activity",
    description:
      "Review connection health, worker activity, current errors, and recent deliveries.",
    empty: "No delivery activity is available yet.",
  },
};

function lifecycleLabel(status: InstallationOption["status"]) {
  return status === "ACTIVE"
    ? "Connected"
    : status === "PENDING"
      ? "Setup incomplete"
      : status === "DISCONNECTED"
        ? "Disconnected"
        : "Revoked";
}

export function DiscordSettingsShell({
  accounts,
  selectedAccountId,
  installations,
  selectedInstallationId,
  section,
  selectAccountAction,
  children,
}: {
  accounts: readonly AccountOption[];
  selectedAccountId: string | null;
  installations: readonly InstallationOption[];
  selectedInstallationId: string | null;
  section: DiscordSettingsSection;
  selectAccountAction: AccountSelectionAction;
  children?: ReactNode;
}) {
  const selected = installations.find(
    ({ id }) => id === selectedInstallationId,
  );
  const copy = workspaceCopy[section];
  const stale = selected && selected.status !== "ACTIVE";

  return (
    <main
      className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6"
      id="main-content"
      tabIndex={-1}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-[var(--accent-strong)]">
            Integrations
          </p>
          <h1 className="mt-1 text-3xl font-semibold">Discord settings</h1>
          <p className="mt-2 max-w-2xl text-[var(--muted)]">
            Manage one Account and connected server at a time. Every page
            rechecks current membership and server-side capability.
          </p>
        </div>
        <Link
          className="inline-flex min-h-11 items-center rounded-lg border border-[var(--line)] bg-white px-4 text-sm font-medium"
          href="/accounts"
        >
          Account administration
        </Link>
      </div>

      {accounts.length === 0 ? (
        <section
          aria-labelledby="discord-no-account-heading"
          className="mt-8 rounded-xl border border-[var(--line)] bg-white p-6"
        >
          <h2 className="text-xl font-semibold" id="discord-no-account-heading">
            No authorized Account is available
          </h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Ask an Account owner to restore an active membership before managing
            Discord.
          </p>
        </section>
      ) : (
        <>
          <section
            aria-label="Discord workspace selection"
            className="mt-8 grid gap-4 rounded-xl border border-[var(--line)] bg-white p-5 md:grid-cols-2"
          >
            <form action={selectAccountAction}>
              <input name="section" type="hidden" value={section} />
              <label
                className="block text-sm font-semibold"
                htmlFor="discord-account"
              >
                Account
              </label>
              <div className="mt-2 flex gap-2">
                <select
                  className="min-h-11 min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-white px-3"
                  defaultValue={selectedAccountId ?? ""}
                  id="discord-account"
                  name="accountId"
                >
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.displayName} ({account.slug})
                    </option>
                  ))}
                </select>
                <button
                  className="min-h-11 rounded-lg border border-[var(--line)] px-4 text-sm font-semibold"
                  type="submit"
                >
                  Switch
                </button>
              </div>
            </form>

            <form action={`/discord/${section}`} method="get">
              <label
                className="block text-sm font-semibold"
                htmlFor="discord-server"
              >
                Discord server
              </label>
              <div className="mt-2 flex gap-2">
                <select
                  className="min-h-11 min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-white px-3 disabled:bg-slate-100"
                  defaultValue={selectedInstallationId ?? ""}
                  disabled={installations.length === 0}
                  id="discord-server"
                  name="server"
                >
                  {installations.length === 0 ? (
                    <option value="">No connected servers</option>
                  ) : null}
                  {installations.map((installation) => (
                    <option key={installation.id} value={installation.id}>
                      {installation.displayName ?? "Discord server"} —{" "}
                      {lifecycleLabel(installation.status)}
                    </option>
                  ))}
                </select>
                <button
                  className="min-h-11 rounded-lg border border-[var(--line)] px-4 text-sm font-semibold disabled:text-slate-400"
                  disabled={installations.length === 0}
                  type="submit"
                >
                  Open
                </button>
              </div>
            </form>
          </section>

          {installations.length === 0 ? (
            <section
              aria-labelledby="discord-empty-heading"
              className="mt-6 rounded-xl border border-dashed border-[var(--line)] bg-white p-6"
            >
              <h2 className="text-xl font-semibold" id="discord-empty-heading">
                Connect a Discord server
              </h2>
              <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
                This Account has no Discord installation. Start the secure
                connection from Account administration, then return here.
              </p>
              <Link
                className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-white"
                href="/accounts"
              >
                Connect a server
              </Link>
            </section>
          ) : (
            <div className="mt-6 grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
              <nav aria-label="Discord settings" className="min-w-0">
                <ul className="flex gap-2 overflow-x-auto pb-2 lg:block lg:space-y-1 lg:overflow-visible lg:pb-0">
                  {discordSettingsSections.map((item) => {
                    const active = item.id === section;
                    return (
                      <li className="shrink-0" key={item.id}>
                        <Link
                          aria-current={active ? "page" : undefined}
                          className={`flex min-h-11 items-center rounded-lg px-3 text-sm font-medium ${active ? "bg-[var(--accent-soft)] text-[var(--accent-strong)]" : "text-[var(--muted)] hover:bg-white hover:text-[var(--foreground)]"}`}
                          href={discordSettingsHref(
                            item.id,
                            selectedInstallationId,
                          )}
                          prefetch={item.id !== "preview"}
                        >
                          {item.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </nav>

              <div className="min-w-0">
                {stale ? (
                  <div
                    className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950"
                    role="alert"
                  >
                    <h2 className="font-semibold">
                      Server connection is{" "}
                      {lifecycleLabel(selected.status).toLowerCase()}
                    </h2>
                    <p className="mt-1 text-sm">
                      Settings are read-only until an Account administrator
                      reconnects this Discord server.
                    </p>
                  </div>
                ) : null}
                <section
                  aria-labelledby="discord-workspace-heading"
                  className="rounded-xl border border-[var(--line)] bg-white p-5 sm:p-6"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2
                        className="text-2xl font-semibold"
                        id="discord-workspace-heading"
                      >
                        {copy.title}
                      </h2>
                      <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
                        {copy.description}
                      </p>
                    </div>
                    {selected ? (
                      <span className="rounded-full bg-[var(--accent-soft)] px-3 py-1 text-xs font-semibold text-[var(--accent-strong)]">
                        {lifecycleLabel(selected.status)}
                      </span>
                    ) : null}
                  </div>
                  {children ?? (
                    <div className="mt-6 rounded-lg border border-dashed border-[var(--line)] p-5">
                      <p className="text-sm text-[var(--muted)]">
                        {copy.empty}
                      </p>
                    </div>
                  )}
                </section>
              </div>
            </div>
          )}
        </>
      )}
    </main>
  );
}
