import Link from "next/link";

import { ApplicationShell } from "@/components/app/application-shell";
import { StatusBadge } from "@/components/ui/status-badge";
import { getApplicationStatus } from "@/server/app/status-service";

export default function HomePage() {
  const status = getApplicationStatus();

  return (
    <ApplicationShell>
      <main
        className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-5xl flex-col justify-center px-6 py-12"
        id="main-content"
        tabIndex={-1}
      >
        <div className="max-w-3xl">
          <StatusBadge status={status.status} />
          <h1 className="mt-6 text-4xl font-semibold tracking-normal text-[var(--foreground)] sm:text-5xl">
            Baseball Stat Track
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-[var(--muted)]">
            A foundation build for event-oriented scorekeeping. Game events will
            remain the source of truth while scores and statistics are derived
            from replayable records.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              className="inline-flex h-11 items-center rounded-md bg-[var(--accent)] px-5 text-sm font-medium text-white transition hover:bg-[var(--accent-strong)]"
              href="/status"
            >
              View Status
            </Link>
            <a
              className="inline-flex h-11 items-center rounded-md border border-[var(--line)] bg-white px-5 text-sm font-medium text-[var(--foreground)] transition hover:border-[var(--accent)]"
              href="https://github.com/cryptnetworks/baseballstattrack"
            >
              Repository
            </a>
          </div>
        </div>
      </main>
    </ApplicationShell>
  );
}
