import Link from "next/link";
import type { ReactNode } from "react";

type ApplicationShellProps = {
  children: ReactNode;
};

export function ApplicationShell({ children }: ApplicationShellProps) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-[var(--line)] bg-white">
        <nav className="mx-auto flex h-20 w-full max-w-6xl items-center justify-between px-6">
          <Link className="text-base font-semibold" href="/">
            Baseball Stat Track
          </Link>
          <Link
            className="text-sm font-medium text-[var(--muted)] hover:text-[var(--foreground)]"
            href="/status"
          >
            Status
          </Link>
        </nav>
      </header>
      {children}
    </div>
  );
}
