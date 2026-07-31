import { z } from "zod";

export const STATISTICS_API_VERSION = "v1" as const;
export const STATISTICS_API_MEDIA_TYPE =
  "application/vnd.baseballstattrack.stats.v1+json" as const;
export const STATISTICS_API_DEFAULT_LIMIT = 25;
export const STATISTICS_API_MAX_LIMIT = 100;

const cursorPayload = z
  .object({ externalId: z.uuid(), direction: z.enum(["asc", "desc"]) })
  .strict();

export const pageSchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(STATISTICS_API_MAX_LIMIT)
      .default(STATISTICS_API_DEFAULT_LIMIT),
    cursor: z.string().trim().min(1).max(512).nullable().default(null),
    direction: z.enum(["asc", "desc"]).default("asc"),
    query: z.string().trim().min(1).max(100).nullable().default(null),
  })
  .strict();

export type StatisticsApiPage = z.infer<typeof pageSchema>;

export function encodeStatisticsCursor(input: {
  externalId: string;
  direction: "asc" | "desc";
}): string {
  return Buffer.from(JSON.stringify(cursorPayload.parse(input))).toString(
    "base64url",
  );
}

export function decodeStatisticsCursor(
  value: string | null,
  direction: "asc" | "desc",
): string | null {
  if (!value) return null;
  try {
    const parsed = cursorPayload.parse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
    );
    if (parsed.direction !== direction) throw new Error("direction mismatch");
    return parsed.externalId;
  } catch {
    throw new StatisticsApiError(
      "INVALID_QUERY",
      "The pagination cursor is invalid.",
    );
  }
}

export type StatisticsApiErrorCode =
  "INVALID_PATH" | "INVALID_QUERY" | "RESOURCE_UNAVAILABLE" | "SOURCE_CHANGED";

export class StatisticsApiError extends Error {
  constructor(
    readonly code: StatisticsApiErrorCode,
    message = "The requested API resource is unavailable.",
  ) {
    super(message);
    this.name = "StatisticsApiError";
  }
}

export function statisticsApiEnvelope<T>(
  data: T,
  page?: { limit: number; nextCursor: string | null },
) {
  return {
    apiVersion: STATISTICS_API_VERSION,
    data,
    ...(page ? { page } : {}),
  } as const;
}
