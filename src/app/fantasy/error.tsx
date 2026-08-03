"use client";

import { ApplicationShell } from "@/components/app/application-shell";

export default function FantasyError({ reset }: { reset: () => void }) {
  return (
    <ApplicationShell>
      <main
        className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6"
        id="main-content"
        tabIndex={-1}
      >
        <h1 className="text-2xl font-semibold">Fantasy league unavailable</h1>
        <p className="mt-3 text-[var(--muted)]" role="alert">
          The league could not be loaded. No roster or scoring data was changed.
        </p>
        <button
          className="mt-5 min-h-11 rounded-lg bg-[var(--accent-strong)] px-4 font-semibold text-white"
          onClick={reset}
          type="button"
        >
          Try again
        </button>
      </main>
    </ApplicationShell>
  );
}
