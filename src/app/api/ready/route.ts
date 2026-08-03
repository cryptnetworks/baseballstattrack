import { NextResponse } from "next/server";

import { getApplicationReadiness } from "@/server/app/readiness-service";
import { getApplicationConfigurationService } from "@/server/app/application-configuration-service";
import {
  emitOperationalEvent,
  getOperationalEventSink,
  requestCorrelation,
} from "@/server/observability/operational-events";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const correlation = requestCorrelation(request);
  const databaseReadiness = await getApplicationReadiness();
  let configurationLoaded = false;
  if (databaseReadiness.status === "ready") {
    try {
      await getApplicationConfigurationService().preload();
      configurationLoaded = true;
    } catch {
      configurationLoaded = false;
    }
  }
  const readiness = {
    ...databaseReadiness,
    status:
      databaseReadiness.status === "ready" && configurationLoaded
        ? ("ready" as const)
        : ("not_ready" as const),
    checks: {
      ...databaseReadiness.checks,
      configuration: configurationLoaded,
    },
  };
  emitOperationalEvent(getOperationalEventSink(), {
    severity: readiness.status === "ready" ? "info" : "critical",
    category: "health",
    name: "readiness",
    outcome: readiness.status === "ready" ? "succeeded" : "failed",
    ...correlation,
    metadata: readiness.checks,
  });

  return NextResponse.json(readiness, {
    status: readiness.status === "ready" ? 200 : 503,
    headers: {
      "Cache-Control": "no-store",
      "X-Request-Id": correlation.requestId,
      "X-Correlation-Id": correlation.correlationId,
    },
  });
}
