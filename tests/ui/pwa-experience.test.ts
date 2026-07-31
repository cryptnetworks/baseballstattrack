import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import manifest from "@/app/manifest";

const root = process.cwd();
const source = (relativePath: string) =>
  readFileSync(join(root, relativePath), "utf8");

describe("M7 progressive web app experience", () => {
  it("publishes an installable, online-first manifest", () => {
    const value = manifest();

    expect(value).toMatchObject({
      id: "/",
      name: "Baseball Stat Track",
      short_name: "Stat Track",
      start_url: "/",
      scope: "/",
      display: "standalone",
      theme_color: "#176b4d",
      background_color: "#f7f7f4",
    });
    expect(value.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sizes: "192x192", purpose: "any" }),
        expect.objectContaining({ sizes: "512x512", purpose: "maskable" }),
      ]),
    );
  });

  it("keeps service-worker caching away from navigations and private boundaries", () => {
    const worker = source("public/service-worker.js");

    expect(worker).toContain('request.mode === "navigate"');
    expect(worker).toContain('url.pathname.startsWith("/api/")');
    expect(worker).toContain('url.pathname.startsWith("/auth/")');
    expect(worker).toContain('url.pathname.startsWith("/_next/static/")');
    expect(worker).not.toMatch(/indexedDB|localStorage|background.?sync/i);
    expect(worker).not.toContain('caches.match("/")');
  });

  it("limits browser storage to dismissing the install prompt", () => {
    const pwa = source("src/components/pwa/pwa-experience.tsx");

    expect(pwa).toContain("beforeinstallprompt");
    expect(pwa).toContain(".register(");
    expect(pwa).toContain("Connection interrupted.");
    expect(pwa.match(/localStorage\./g)).toHaveLength(2);
    expect(pwa).not.toMatch(
      /indexedDB|scoring event|pending action|sync queue/i,
    );
  });

  it("keeps the mobile shell accessible and touch-sized", () => {
    const shell = source("src/components/app/application-shell.tsx");
    const css = source("src/app/globals.css");

    expect(shell).toContain('aria-label="Primary"');
    expect(shell).toContain('aria-current={active ? "page" : undefined}');
    expect(shell).toContain("min-h-11");
    expect(shell).toContain("overflow-x-auto");
    expect(css).toContain("env(safe-area-inset-left)");
    expect(css).toContain("@media (max-width: 36rem)");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
