import Link from "next/link";

import { ApplicationShell } from "@/components/app/application-shell";

export default function FantasyNotFound() {
  return (
    <ApplicationShell>
      <main
        className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6"
        id="main-content"
        tabIndex={-1}
      >
        <h1 className="text-2xl font-semibold">Fantasy league unavailable</h1>
        <p className="mt-3 text-[var(--muted)]">
          The requested section is invalid or you do not have permission to use
          it.
        </p>
        <Link
          className="mt-5 inline-flex min-h-11 items-center rounded-lg border border-[var(--line)] bg-white px-4 font-medium"
          href="/fantasy"
        >
          Back to fantasy leagues
        </Link>
      </main>
    </ApplicationShell>
  );
}
