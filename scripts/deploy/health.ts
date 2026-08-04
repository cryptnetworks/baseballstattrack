import type { ComposeDeployment } from "./compose.ts";

type Fetch = typeof fetch;

async function endpoint(
  url: string,
  expectedStatus: number,
  fetcher: Fetch,
  attempts = 30,
) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetcher(url, {
        signal: AbortSignal.timeout(2_000),
        headers: { Accept: "application/json" },
      });
      if (response.status === expectedStatus) return true;
    } catch {
      // The service may still be inside its health-check grace period.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return false;
}

export async function validateDeploymentHealth(input: {
  compose: Pick<
    ComposeDeployment,
    "databaseReady" | "migrationStatus" | "serviceStatus"
  >;
  appPort: number;
  databaseUser: string;
  databaseName: string;
  fetcher?: Fetch;
  healthHost?: string;
}) {
  const fetcher = input.fetcher ?? fetch;
  const healthHost =
    input.healthHost ?? process.env.BST_HEALTH_HOST ?? "127.0.0.1";
  const [health, readiness, database, migration, services] = await Promise.all([
    endpoint(`http://${healthHost}:${input.appPort}/api/health`, 200, fetcher),
    endpoint(`http://${healthHost}:${input.appPort}/api/ready`, 200, fetcher),
    input.compose.databaseReady(input.databaseUser, input.databaseName),
    input.compose.migrationStatus(input.databaseUser, input.databaseName),
    input.compose.serviceStatus(),
  ]);
  const unhealthyServices = services.filter((service) => {
    if (!service || typeof service !== "object") return true;
    const value = service as Record<string, unknown>;
    const state = String(value.State ?? value.state ?? "").toLowerCase();
    const healthValue = String(
      value.Health ?? value.health ?? "",
    ).toLowerCase();
    return (
      (state !== "running" && state !== "exited") || healthValue === "unhealthy"
    );
  });
  return Object.freeze({
    health,
    readiness,
    database,
    migration,
    services: unhealthyServices.length === 0,
    ok:
      health &&
      readiness &&
      database &&
      migration &&
      unhealthyServices.length === 0,
  });
}
