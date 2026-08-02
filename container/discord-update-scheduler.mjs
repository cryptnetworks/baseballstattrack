import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const log = (event, fields = {}, severity = "info") => {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      severity,
      service: "baseballstattrack-discord-update-worker",
      event,
      ...fields,
    }),
  );
};

const integer = (value, name, minimum, maximum) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(
      `${name} must be an integer from ${minimum} through ${maximum}.`,
    );
  }
  return parsed;
};

export function readConfiguration(environment = process.env) {
  const token = environment.DISCORD_UPDATE_WORKER_TOKEN?.trim() ?? "";
  if (token.length < 32) {
    throw new Error(
      "DISCORD_UPDATE_WORKER_TOKEN must contain at least 32 characters.",
    );
  }

  const workerId =
    environment.DISCORD_UPDATE_WORKER_ID?.trim() ?? "discord-compose-worker";
  if (!/^[A-Za-z0-9._:-]{8,128}$/u.test(workerId)) {
    throw new Error(
      "DISCORD_UPDATE_WORKER_ID must be a stable 8-128 character identifier.",
    );
  }

  const baseUrl = new URL(
    environment.DISCORD_UPDATE_WORKER_BASE_URL ?? "http://app:3000",
  );
  const internalHttp =
    baseUrl.protocol === "http:" &&
    ["app", "localhost", "127.0.0.1", "::1"].includes(baseUrl.hostname);
  if (
    (baseUrl.protocol !== "https:" && !internalHttp) ||
    baseUrl.username ||
    baseUrl.password ||
    baseUrl.search ||
    baseUrl.hash ||
    baseUrl.pathname !== "/"
  ) {
    throw new Error(
      "DISCORD_UPDATE_WORKER_BASE_URL must be an HTTPS origin or the internal app origin.",
    );
  }

  return {
    token,
    workerId,
    endpoint: new URL("/api/internal/discord-updates/run", baseUrl),
    intervalMs:
      integer(
        environment.DISCORD_UPDATE_WORKER_INTERVAL_SECONDS ?? "15",
        "DISCORD_UPDATE_WORKER_INTERVAL_SECONDS",
        5,
        300,
      ) * 1_000,
    timeoutMs:
      integer(
        environment.DISCORD_UPDATE_WORKER_TIMEOUT_SECONDS ?? "55",
        "DISCORD_UPDATE_WORKER_TIMEOUT_SECONDS",
        5,
        60,
      ) * 1_000,
    healthHost: environment.DISCORD_UPDATE_WORKER_HEALTH_HOST ?? "0.0.0.0",
    healthPort: integer(
      environment.DISCORD_UPDATE_WORKER_HEALTH_PORT ?? "8080",
      "DISCORD_UPDATE_WORKER_HEALTH_PORT",
      1,
      65_535,
    ),
  };
}

export async function startScheduler(configuration = readConfiguration()) {
  let lastSuccessAt = 0;
  let stopping = false;
  let activeRequest;
  let wake;
  let waitTimer;

  const health = createServer((request, response) => {
    const readyWindowMs = Math.max(configuration.intervalMs * 3, 60_000);
    const ready =
      lastSuccessAt > 0 &&
      Date.now() - lastSuccessAt <= readyWindowMs &&
      !stopping;
    const live = request.url === "/healthz";
    const readiness = request.url === "/readyz";
    const status = live || (readiness && ready) ? 200 : readiness ? 503 : 404;
    const body = JSON.stringify({
      status: live
        ? "alive"
        : readiness
          ? ready
            ? "ready"
            : "not_ready"
          : "not_found",
    });
    response.writeHead(status, {
      "Cache-Control": "no-store",
      "Content-Length": Buffer.byteLength(body),
      "Content-Type": "application/json",
    });
    response.end(body);
  });

  await new Promise((resolve, reject) => {
    health.once("error", reject);
    health.listen(configuration.healthPort, configuration.healthHost, resolve);
  });

  const invoke = async () => {
    const startedAt = Date.now();
    activeRequest = new AbortController();
    const timeout = setTimeout(
      () => activeRequest?.abort(),
      configuration.timeoutMs,
    );
    try {
      const response = await fetch(configuration.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${configuration.token}`,
          "X-Discord-Update-Worker-Id": configuration.workerId,
        },
        signal: activeRequest.signal,
      });
      await response.arrayBuffer();
      if (!response.ok) {
        throw new Error(`worker endpoint returned HTTP ${response.status}`);
      }
      lastSuccessAt = Date.now();
      log("worker_cycle_succeeded", {
        durationMs: lastSuccessAt - startedAt,
        responseStatus: response.status,
      });
    } catch (error) {
      if (!stopping) {
        log(
          "worker_cycle_failed",
          {
            durationMs: Date.now() - startedAt,
            reason: error instanceof Error ? error.message : "unknown failure",
          },
          "warning",
        );
      }
    } finally {
      clearTimeout(timeout);
      activeRequest = undefined;
    }
  };

  const loop = (async () => {
    while (!stopping) {
      await invoke();
      if (stopping) break;
      await new Promise((resolve) => {
        wake = resolve;
        waitTimer = setTimeout(resolve, configuration.intervalMs);
      });
      wake = undefined;
      waitTimer = undefined;
    }
  })();

  log("worker_scheduler_started", {
    intervalSeconds: configuration.intervalMs / 1_000,
    workerId: configuration.workerId,
  });

  return async () => {
    if (stopping) return;
    stopping = true;
    activeRequest?.abort();
    clearTimeout(waitTimer);
    wake?.();
    await loop;
    await new Promise((resolve, reject) => {
      health.close((error) => (error ? reject(error) : resolve()));
    });
    log("worker_scheduler_stopped", { workerId: configuration.workerId });
  };
}

async function main() {
  let configuration;
  try {
    configuration = readConfiguration();
  } catch (error) {
    console.error(
      `Discord update worker configuration error: ${error instanceof Error ? error.message : "invalid configuration"}`,
    );
    process.exitCode = 2;
    return;
  }

  const stop = await startScheduler(configuration);
  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      if (stopping) return;
      stopping = true;
      void stop().catch(() => {
        console.error("Discord update worker shutdown failed.");
        process.exitCode = 1;
      });
    });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
