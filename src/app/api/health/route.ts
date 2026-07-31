import { NextResponse } from "next/server";

import { getApplicationStatus } from "@/server/app/status-service";
import {
  emitOperationalEvent,
  getOperationalEventSink,
  requestCorrelation,
} from "@/server/observability/operational-events";

export function GET(request: Request) {
  const correlation = requestCorrelation(request);
  emitOperationalEvent(getOperationalEventSink(), {
    severity: "info",
    category: "health",
    name: "liveness",
    outcome: "succeeded",
    ...correlation,
  });
  return NextResponse.json(getApplicationStatus(), {
    headers: {
      "Cache-Control": "no-store",
      "X-Request-Id": correlation.requestId,
      "X-Correlation-Id": correlation.correlationId,
    },
  });
}
