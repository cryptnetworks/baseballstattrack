import { createServer } from "node:http";

import { describe, expect, it } from "vitest";

import {
  readConfiguration,
  startScheduler,
} from "../../container/discord-update-scheduler.mjs";

const environment = () => ({
  DISCORD_UPDATE_WORKER_TOKEN: "synthetic-worker-token-at-least-32-characters",
  DISCORD_UPDATE_WORKER_ID: "worker-01",
  DISCORD_UPDATE_WORKER_BASE_URL: "http://app:3000",
  DISCORD_UPDATE_WORKER_INTERVAL_SECONDS: "15",
  DISCORD_UPDATE_WORKER_TIMEOUT_SECONDS: "55",
  DISCORD_UPDATE_WORKER_HEALTH_PORT: "8080",
});

describe("Discord update scheduler configuration", () => {
  it("accepts an isolated internal app origin with bounded scheduling", () => {
    expect(readConfiguration(environment())).toMatchObject({
      workerId: "worker-01",
      intervalMs: 15_000,
      timeoutMs: 55_000,
      healthPort: 8080,
    });
  });

  it("rejects weak credentials and cleartext external origins", () => {
    expect(() =>
      readConfiguration({
        ...environment(),
        DISCORD_UPDATE_WORKER_TOKEN: "short",
      }),
    ).toThrow(/at least 32/u);
    expect(() =>
      readConfiguration({
        ...environment(),
        DISCORD_UPDATE_WORKER_BASE_URL: "http://example.test",
      }),
    ).toThrow(/HTTPS origin/u);
  });

  it("fails closed on unsafe cadence, identity, and URL input", () => {
    expect(() =>
      readConfiguration({
        ...environment(),
        DISCORD_UPDATE_WORKER_INTERVAL_SECONDS: "1",
      }),
    ).toThrow(/5 through 300/u);
    expect(() =>
      readConfiguration({
        ...environment(),
        DISCORD_UPDATE_WORKER_ID: "bad id",
      }),
    ).toThrow(/stable 8-128/u);
    expect(() =>
      readConfiguration({
        ...environment(),
        DISCORD_UPDATE_WORKER_BASE_URL: "https://user:secret@example.test",
      }),
    ).toThrow(/HTTPS origin/u);
  });

  it("authenticates one immediate cycle and shuts down cleanly", async () => {
    let completeRequest!: () => void;
    const requestCompleted = new Promise<void>((resolve) => {
      completeRequest = resolve;
    });
    const app = createServer((request, response) => {
      expect(request.method).toBe("POST");
      expect(request.url).toBe("/api/internal/discord-updates/run");
      expect(request.headers.authorization).toBe(
        `Bearer ${environment().DISCORD_UPDATE_WORKER_TOKEN}`,
      );
      expect(request.headers["x-discord-update-worker-id"]).toBe("worker-01");
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end('{"disabled":true}');
      completeRequest();
    });
    await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
    const address = app.address();
    if (!address || typeof address === "string") {
      throw new Error("test server did not bind a TCP port");
    }

    const stop = await startScheduler({
      token: environment().DISCORD_UPDATE_WORKER_TOKEN,
      workerId: "worker-01",
      endpoint: new URL(
        "/api/internal/discord-updates/run",
        `http://127.0.0.1:${address.port}`,
      ),
      intervalMs: 5_000,
      timeoutMs: 5_000,
      healthHost: "127.0.0.1",
      healthPort: 0,
    });

    await requestCompleted;
    await stop();
    await new Promise<void>((resolve, reject) =>
      app.close((error) => (error ? reject(error) : resolve())),
    );
  });
});
