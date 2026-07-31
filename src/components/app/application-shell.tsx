import Link from "next/link";
import type { ReactNode } from "react";

type ApplicationShellProps = {
  children: ReactNode;
};

export function ApplicationShell({ children }: ApplicationShellProps) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-[var(--line)] bg-white">
        <nav
          aria-label="Primary"
          className="mx-auto flex min-h-20 w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-6"
        >
          <Link
            className="inline-flex min-h-11 items-center rounded-lg px-2 text-base font-semibold"
            href="/"
          >
            Baseball Stat Track
          </Link>
          <div className="flex items-center gap-1 sm:gap-2">
            <Link
              className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-[var(--muted)] hover:text-[var(--foreground)]"
              href="/games/setup"
            >
              Games
            </Link>
            <Link
              className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-[var(--muted)] hover:text-[var(--foreground)]"
              href="/reports/season"
            >
              Seasons
            </Link>
            <Link
              className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-[var(--muted)] hover:text-[var(--foreground)]"
              href="/data"
            >
              Data
            </Link>
            <Link
              className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-[var(--muted)] hover:text-[var(--foreground)]"
              href="/status"
            >
              Status
            </Link>
          </div>
        </nav>
      </header>
      {children}
    </div>
  );
}
