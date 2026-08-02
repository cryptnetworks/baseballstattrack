import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

import { describe, expect, it, vi } from "vitest";

type WorkerRequest = {
  method: string;
  mode: string;
  url: string;
};

type FetchEvent = {
  request: WorkerRequest;
  respondWith: (response: Promise<unknown>) => void;
};

function workerHarness(fetcher = vi.fn()) {
  const listeners = new Map<string, (event: FetchEvent) => void>();
  const cachedResponse = { source: "cache" };
  const match = vi.fn().mockResolvedValue(undefined);
  const put = vi.fn().mockResolvedValue(undefined);
  const cache = { addAll: vi.fn(), match, put };
  const caches = {
    delete: vi.fn(),
    keys: vi.fn().mockResolvedValue([]),
    match: vi.fn().mockResolvedValue(cachedResponse),
    open: vi.fn().mockResolvedValue(cache),
  };
  const self = {
    location: { origin: "https://app.example.test" },
    addEventListener: (name: string, listener: (event: FetchEvent) => void) =>
      listeners.set(name, listener),
  };

  runInNewContext(
    readFileSync(join(process.cwd(), "public/service-worker.js"), "utf8"),
    { caches, fetch: fetcher, self, URL },
  );

  function dispatch(request: WorkerRequest) {
    let response: Promise<unknown> | undefined;
    listeners.get("fetch")?.({
      request,
      respondWith: (value) => {
        response = value;
      },
    });
    return response;
  }

  return { cache, caches, dispatch, match, put };
}

describe("PWA service worker runtime boundary", () => {
  it.each([
    ["navigation", "GET", "navigate", "https://app.example.test/games/1"],
    ["API data", "GET", "cors", "https://app.example.test/api/health"],
    ["authentication", "GET", "cors", "https://app.example.test/auth/callback"],
    ["mutation", "POST", "cors", "https://app.example.test/icons/icon.svg"],
    ["cross-origin", "GET", "cors", "https://cdn.example.test/icon.svg"],
  ])("does not intercept %s requests", (_label, method, mode, url) => {
    const { dispatch } = workerHarness();

    expect(dispatch({ method, mode, url })).toBeUndefined();
  });

  it("stores only a successful same-origin static response on cache miss", async () => {
    const networkResponse = {
      ok: true,
      type: "basic",
      clone: vi.fn(),
    };
    networkResponse.clone.mockReturnValue(networkResponse);
    const fetcher = vi.fn().mockResolvedValue(networkResponse);
    const { dispatch, put } = workerHarness(fetcher);
    const request = {
      method: "GET",
      mode: "cors",
      url: "https://app.example.test/_next/static/chunks/example.js",
    };

    await expect(dispatch(request)).resolves.toBe(networkResponse);
    expect(fetcher).toHaveBeenCalledWith(request);
    expect(put).toHaveBeenCalledWith(request, networkResponse);
  });

  it("uses the cached manifest only when the network is unavailable", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("network unavailable"));
    const { caches, dispatch } = workerHarness(fetcher);
    const request = {
      method: "GET",
      mode: "cors",
      url: "https://app.example.test/manifest.webmanifest",
    };

    await expect(dispatch(request)).resolves.toEqual({ source: "cache" });
    expect(caches.match).toHaveBeenCalledWith(request);
  });
});
