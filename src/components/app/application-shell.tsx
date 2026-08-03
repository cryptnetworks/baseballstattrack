"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

type ApplicationShellProps = {
  children: ReactNode;
};

function NavigationLink({
  href,
  label,
  pathname,
}: {
  href: string;
  label: string;
  pathname: string;
}) {
  const active = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      className={`inline-flex min-h-11 shrink-0 items-center rounded-lg px-3 text-sm font-medium transition-colors ${active ? "bg-[var(--accent-soft)] text-[var(--accent-strong)]" : "text-[var(--muted)] hover:bg-[var(--background)] hover:text-[var(--foreground)]"}`}
      href={href}
      aria-current={active ? "page" : undefined}
    >
      {label}
    </Link>
  );
}

export function ApplicationShell({ children }: ApplicationShellProps) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen">
      <header className="border-b border-[var(--line)] bg-white/95 shadow-[0_1px_0_rgba(22,32,24,0.03)] backdrop-blur">
        <nav
          aria-label="Primary"
          className="mx-auto flex min-h-20 w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6"
        >
          <Link
            className="inline-flex min-h-11 items-center gap-3 rounded-lg px-2 text-base font-semibold"
            href="/"
          >
            <Image
              src="/icons/icon-192.png"
              alt=""
              width={40}
              height={40}
              priority
              className="size-10 rounded-xl"
            />
            <span>
              <span className="block leading-tight">Baseball Stat Track</span>
              <span className="mt-1 block text-xs font-medium text-[var(--muted)]">
                Online-first scorekeeping
              </span>
            </span>
          </Link>
          <div className="flex w-full items-center gap-1 overflow-x-auto pb-1 sm:w-auto sm:gap-2 sm:pb-0">
            <NavigationLink
              href="/games/setup"
              label="Games"
              pathname={pathname}
            />
            <NavigationLink
              href="/reports/season"
              label="Seasons"
              pathname={pathname}
            />
            <NavigationLink href="/data" label="Data" pathname={pathname} />
            <NavigationLink
              href="/fantasy"
              label="Fantasy"
              pathname={pathname}
            />
            <NavigationLink
              href="/discord"
              label="Discord"
              pathname={pathname}
            />
            <NavigationLink
              href="/settings/configuration"
              label="Settings"
              pathname={pathname}
            />
            <NavigationLink href="/status" label="Status" pathname={pathname} />
          </div>
        </nav>
      </header>
      {children}
    </div>
  );
}
