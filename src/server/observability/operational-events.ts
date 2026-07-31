import { randomUUID } from "node:crypto";

import { AuthorizationError } from "@/server/auth/errors";

export type OperationalSeverity = "debug" | "info" | "warning" | "critical";
export type OperationalOutcome =
  "started" | "succeeded" | "rejected" | "failed" | "degraded";
export type OperationalCategory =
  | "application"
  | "authentication"
  | "authorization"
  | "security_audit"
  | "scoring"
  | "projection"
  | "report"
  | "background_job"
  | "migration"
  | "health"
  | "domain_rejection";

export type OperationalEvent = Readonly<{
  occurredAt: string;
  severity: OperationalSeverity;
  category: OperationalCategory;
  name: string;
  outcome: OperationalOutcome;
  requestId?: string;
  correlationId?: string;
  accountId?: string;
  capability?: string;
  targetType?: string;
  code?: string;
  durationMs?: number;
  metadata?: Readonly<Record<string, string | number | boolean | null>>;
}>;

export interface OperationalEventSink {
  emit(event: OperationalEvent): void;
}

const safeIdentifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const sensitiveKey =
  /(authorization|cookie|token|secret|password|claim|payload|email|name|note|birth|contact|database.?url)/i;

export function normalizeOperationalIdentifier(
  value: string | null | undefined,
): string | undefined {
  const candidate = value?.trim();
  return candidate && safeIdentifier.test(candidate) ? candidate : undefined;
}

export function requestCorrelation(request: Request): {
  requestId: string;
  correlationId: string;
} {
  const requestId =
    normalizeOperationalIdentifier(request.headers.get("x-request-id")) ??
    randomUUID();
  const correlationId =
    normalizeOperationalIdentifier(request.headers.get("x-correlation-id")) ??
    requestId;
  return { requestId, correlationId };
}

export function safeOperationalErrorCode(error: unknown): string {
  if (error instanceof AuthorizationError) return error.code;
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[A-Z][A-Z0-9_]{2,63}$/.test(error.code)
  ) {
    return error.code;
  }
  return "INTERNAL_ERROR";
}

export function redactOperationalMetadata(
  metadata: Record<string, unknown>,
): Record<string, string | number | boolean | null> {
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => {
      if (sensitiveKey.test(key)) return [key, "[REDACTED]"];
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean" ||
        value === null
      ) {
        return [key, value];
      }
      return [key, "[REDACTED]"];
    }),
  );
}

export function emitOperationalEvent(
  sink: OperationalEventSink,
  event: Omit<OperationalEvent, "occurredAt"> & { occurredAt?: string },
): void {
  const safeEvent: OperationalEvent = {
    ...event,
    occurredAt: event.occurredAt ?? new Date().toISOString(),
    ...(event.metadata
      ? { metadata: redactOperationalMetadata({ ...event.metadata }) }
      : {}),
  };

  try {
    sink.emit(safeEvent);
  } catch {
    // Application telemetry is best-effort. Required security-audit writes
    // remain transactional and fail closed in their owning repositories.
  }
}

class StandardOutputOperationalEventSink implements OperationalEventSink {
  emit(event: OperationalEvent): void {
    process.stdout.write(`${JSON.stringify(event)}\n`);
  }
}

let defaultSink: OperationalEventSink | undefined;

export function getOperationalEventSink(): OperationalEventSink {
  defaultSink ??= new StandardOutputOperationalEventSink();
  return defaultSink;
}

export type AlertClassification = Readonly<{
  key: string;
  severity: OperationalSeverity;
  page: boolean;
}>;

export function classifyOperationalAlert(
  event: Pick<OperationalEvent, "category" | "name" | "outcome" | "code">,
): AlertClassification | null {
  if (event.category === "security_audit" && event.outcome === "failed") {
    return {
      key: "security-audit-write-failure",
      severity: "critical",
      page: true,
    };
  }
  if (
    event.category === "health" &&
    event.name === "readiness" &&
    event.outcome !== "succeeded"
  ) {
    return { key: "application-not-ready", severity: "critical", page: true };
  }
  if (
    event.category === "scoring" &&
    event.outcome === "failed" &&
    event.code === "INTERNAL_ERROR"
  ) {
    return {
      key: "scoring-acceptance-failure",
      severity: "critical",
      page: true,
    };
  }
  if (
    (event.category === "projection" || event.category === "report") &&
    event.outcome === "degraded"
  ) {
    return { key: "derived-data-stale", severity: "warning", page: false };
  }
  if (event.category === "background_job" && event.outcome === "failed") {
    return { key: "background-job-failure", severity: "warning", page: false };
  }
  return null;
}
