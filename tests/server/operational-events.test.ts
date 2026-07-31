import { describe, expect, it, vi } from "vitest";

import { AuthorizationError } from "@/server/auth/errors";
import {
  classifyOperationalAlert,
  emitOperationalEvent,
  redactOperationalMetadata,
  requestCorrelation,
  safeOperationalErrorCode,
  type OperationalEvent,
  type OperationalEventSink,
} from "@/server/observability/operational-events";

class Collector implements OperationalEventSink {
  readonly events: OperationalEvent[] = [];
  emit(event: OperationalEvent) {
    this.events.push(event);
  }
}

describe("operational event contract", () => {
  it("propagates safe request and correlation identifiers", () => {
    const context = requestCorrelation(
      new Request("https://example.test/api/health", {
        headers: {
          "x-request-id": "request-1234",
          "x-correlation-id": "correlation-1234",
        },
      }),
    );
    expect(context).toEqual({
      requestId: "request-1234",
      correlationId: "correlation-1234",
    });
  });

  it("replaces malformed caller identifiers instead of reflecting them", () => {
    const context = requestCorrelation(
      new Request("https://example.test/api/health", {
        headers: { "x-request-id": "token value" },
      }),
    );
    expect(context.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(context.correlationId).toBe(context.requestId);
  });

  it("redacts sensitive and structured metadata", () => {
    expect(
      redactOperationalMetadata({
        teamCount: 2,
        token: "secret",
        playerName: "Private Player",
        payload: { event: "raw" },
        databaseUrl: "postgresql://secret",
      }),
    ).toEqual({
      teamCount: 2,
      token: "[REDACTED]",
      playerName: "[REDACTED]",
      payload: "[REDACTED]",
      databaseUrl: "[REDACTED]",
    });
  });

  it("uses safe structured codes without error messages", () => {
    expect(
      safeOperationalErrorCode(
        new AuthorizationError(
          "NO_ACTIVE_MEMBERSHIP",
          "private membership detail",
        ),
      ),
    ).toBe("NO_ACTIVE_MEMBERSHIP");
    expect(safeOperationalErrorCode(new Error("postgresql://secret"))).toBe(
      "INTERNAL_ERROR",
    );
  });

  it("does not let an unavailable log sink fail an application operation", () => {
    const sink = {
      emit: vi.fn(() => {
        throw new Error("sink unavailable");
      }),
    };
    expect(() =>
      emitOperationalEvent(sink, {
        category: "application",
        name: "request",
        outcome: "succeeded",
        severity: "info",
      }),
    ).not.toThrow();
  });

  it("classifies paging and nonpaging alerts deterministically", () => {
    expect(
      classifyOperationalAlert({
        category: "security_audit",
        name: "write",
        outcome: "failed",
      }),
    ).toEqual({
      key: "security-audit-write-failure",
      severity: "critical",
      page: true,
    });
    expect(
      classifyOperationalAlert({
        category: "domain_rejection",
        name: "invalid_runner",
        outcome: "rejected",
      }),
    ).toBeNull();
    expect(
      classifyOperationalAlert({
        category: "scoring",
        name: "event_acceptance",
        outcome: "rejected",
        code: "REVISION_CONFLICT",
      }),
    ).toBeNull();
    expect(
      classifyOperationalAlert({
        category: "scoring",
        name: "event_acceptance",
        outcome: "failed",
        code: "INTERNAL_ERROR",
      }),
    ).toEqual({
      key: "scoring-acceptance-failure",
      severity: "critical",
      page: true,
    });
    expect(
      classifyOperationalAlert({
        category: "projection",
        name: "freshness",
        outcome: "degraded",
      }),
    ).toEqual({
      key: "derived-data-stale",
      severity: "warning",
      page: false,
    });
  });

  it("keeps Account-scoped events distinguishable without private payloads", () => {
    const collector = new Collector();
    for (const accountId of ["account-a", "account-b"]) {
      emitOperationalEvent(collector, {
        category: "authorization",
        name: "capability_check",
        outcome: "succeeded",
        severity: "info",
        accountId,
      });
    }
    expect(
      collector.events.filter((event) => event.accountId === "account-a"),
    ).toHaveLength(1);
    expect(JSON.stringify(collector.events)).not.toContain("payload");
  });
});
