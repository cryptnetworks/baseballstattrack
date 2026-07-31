import { describe, expect, it } from "vitest";

import {
  StatisticsApiError,
  decodeStatisticsCursor,
  encodeStatisticsCursor,
  pageSchema,
  statisticsApiEnvelope,
} from "@/domain/statistics-api";

describe("statistics API v1 contract primitives", () => {
  it("round-trips external-only stable cursors", () => {
    const externalId = "00000000-0000-4000-8000-000000000091";
    const cursor = encodeStatisticsCursor({ externalId, direction: "asc" });
    expect(cursor).not.toContain(externalId);
    expect(decodeStatisticsCursor(cursor, "asc")).toBe(externalId);
    expect(() => decodeStatisticsCursor(cursor, "desc")).toThrowError(
      expect.objectContaining<Partial<StatisticsApiError>>({
        code: "INVALID_QUERY",
      }),
    );
  });

  it("bounds pages and rejects malformed filters", () => {
    expect(pageSchema.parse({})).toMatchObject({
      limit: 25,
      direction: "asc",
      cursor: null,
      query: null,
    });
    expect(pageSchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(pageSchema.safeParse({ direction: "newest" }).success).toBe(false);
  });

  it("uses an explicit version envelope for empty results", () => {
    expect(statisticsApiEnvelope([], { limit: 25, nextCursor: null })).toEqual({
      apiVersion: "v1",
      data: [],
      page: { limit: 25, nextCursor: null },
    });
  });
});
