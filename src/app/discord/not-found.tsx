import Link from "next/link";

import { ApplicationShell } from "@/components/app/application-shell";

export default function DiscordSettingsNotFound() {
  return (
    <ApplicationShell>
      <main
        className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6"
        id="main-content"
        tabIndex={-1}
      >
        <h1 className="text-3xl font-semibold">Discord workspace not found</h1>
        <p className="mt-3 text-[var(--muted)]">
          Choose one of the available Discord settings sections.
        </p>
        <Link
          className="mt-5 inline-flex min-h-11 items-center rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-white"
          href="/discord/overview"
        >
          Open Discord overview
        </Link>
      </main>
    </ApplicationShell>
  );
}
