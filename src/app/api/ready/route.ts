import { NextResponse } from "next/server";

import { getApplicationReadiness } from "@/server/app/readiness-service";
import {
  emitOperationalEvent,
  getOperationalEventSink,
  requestCorrelation,
} from "@/server/observability/operational-events";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const correlation = requestCorrelation(request);
  const readiness = await getApplicationReadiness();
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
