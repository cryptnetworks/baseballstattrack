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
      className={`app-nav__link min-h-11 ${active ? "app-nav__link--active" : ""}`.trim()}
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
      <header className="app-header">
        <nav aria-label="Primary" className="app-header__inner">
          <Link className="app-brand" href="/">
            <Image
              src="/icons/icon-192.png"
              alt=""
              width={40}
              height={40}
              priority
              className="size-10 rounded-xl"
            />
            <span>
              <span className="app-brand__name">Baseball Stat Track</span>
              <span className="app-brand__meta">
                Scorekeeping · reference · operations
              </span>
            </span>
          </Link>
          <div className="app-nav overflow-x-auto" aria-label="Workspaces">
            <NavigationLink
              href="/games/setup"
              label="Scorekeeping"
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
              label="Operations"
              pathname={pathname}
            />
            <div className="app-nav__utility">
              <NavigationLink
                href="/accounts"
                label="Accounts"
                pathname={pathname}
              />
              <NavigationLink
                href="/settings/configuration"
                label="Admin"
                pathname={pathname}
              />
              <NavigationLink
                href="/status"
                label="Status"
                pathname={pathname}
              />
            </div>
          </div>
        </nav>
      </header>
      {children}
    </div>
  );
}
