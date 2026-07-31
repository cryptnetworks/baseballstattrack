import { createHash } from "node:crypto";

import { z } from "zod";

export const EXTERNAL_DATA_PAYLOAD_VERSION = 1;
export const externalRecordTypes = [
  "TEAM",
  "PLAYER",
  "SEASON",
  "GAME",
  "ROSTER_ENTRY",
  "PLAY",
  "BOX_SCORE",
  "STAT_LINE",
] as const;

const providerId = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
const nonnegative = z.number().finite().nonnegative();

const payloads = {
  TEAM: z
    .object({
      name: z.string().trim().min(1).max(160),
      abbreviation: z.string().trim().min(1).max(12).nullable(),
    })
    .strict(),
  PLAYER: z
    .object({
      displayName: z.string().trim().min(1).max(160),
      battingSide: z.enum(["LEFT", "RIGHT", "SWITCH", "UNKNOWN"]),
      throwingHand: z.enum(["LEFT", "RIGHT", "UNKNOWN"]),
    })
    .strict(),
  SEASON: z
    .object({
      name: z.string().trim().min(1).max(160),
      year: z.number().int().min(1800).max(2200),
      status: z.enum(["PLANNED", "ACTIVE", "COMPLETED"]),
    })
    .strict(),
  GAME: z
    .object({
      seasonId: providerId,
      homeTeamId: providerId,
      awayTeamId: providerId,
      scheduledAt: z.iso.datetime(),
      status: z.enum([
        "SCHEDULED",
        "IN_PROGRESS",
        "FINAL",
        "POSTPONED",
        "CANCELLED",
      ]),
      rulesetCode: providerId,
    })
    .strict(),
  ROSTER_ENTRY: z
    .object({
      seasonId: providerId,
      teamId: providerId,
      playerId: providerId,
      status: z.enum(["ACTIVE", "INACTIVE"]),
    })
    .strict(),
  PLAY: z
    .object({
      gameId: providerId,
      sequence: z.number().int().positive(),
      playCode: providerId,
      inning: z.number().int().positive(),
      half: z.enum(["TOP", "BOTTOM"]),
    })
    .strict(),
  BOX_SCORE: z
    .object({
      gameId: providerId,
      homeRuns: z.number().int().nonnegative(),
      awayRuns: z.number().int().nonnegative(),
      final: z.boolean(),
    })
    .strict(),
  STAT_LINE: z
    .object({
      scope: z.enum(["GAME", "SEASON"]),
      targetId: providerId,
      statisticCode: providerId,
      value: nonnegative,
    })
    .strict(),
} as const;

const common = z.object({
  providerRecordId: providerId,
  providerVersion: providerId,
  effectiveAt: z.iso.datetime().nullable(),
  correctionOfVersion: providerId.nullable(),
});

export const externalProviderRecordSchema = z.discriminatedUnion("recordType", [
  common
    .extend({ recordType: z.literal("TEAM"), payload: payloads.TEAM })
    .strict(),
  common
    .extend({ recordType: z.literal("PLAYER"), payload: payloads.PLAYER })
    .strict(),
  common
    .extend({ recordType: z.literal("SEASON"), payload: payloads.SEASON })
    .strict(),
  common
    .extend({ recordType: z.literal("GAME"), payload: payloads.GAME })
    .strict(),
  common
    .extend({
      recordType: z.literal("ROSTER_ENTRY"),
      payload: payloads.ROSTER_ENTRY,
    })
    .strict(),
  common
    .extend({ recordType: z.literal("PLAY"), payload: payloads.PLAY })
    .strict(),
  common
    .extend({ recordType: z.literal("BOX_SCORE"), payload: payloads.BOX_SCORE })
    .strict(),
  common
    .extend({ recordType: z.literal("STAT_LINE"), payload: payloads.STAT_LINE })
    .strict(),
]);

export type ExternalProviderRecord = z.infer<
  typeof externalProviderRecordSchema
>;

export const externalProviderPageSchema = z
  .object({
    providerVersion: providerId,
    checkpoint: z.record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean(), z.null()]),
    ),
    nextCursor: z.string().trim().min(1).max(512).nullable(),
    quotaRemaining: z.number().int().nonnegative().nullable(),
    quotaResetAt: z.iso.datetime().nullable(),
    records: z.array(z.unknown()).max(1_000),
  })
  .strict();

export type ExternalProviderPage = z.infer<typeof externalProviderPageSchema>;

export type ExternalProviderContract = Readonly<{
  key: string;
  displayName: string;
  capabilities: readonly (typeof externalRecordTypes)[number][];
  authentication:
    "API_KEY" | "OAUTH_CLIENT_CREDENTIALS" | "SIGNED_REQUEST" | "FIXTURE_ONLY";
  pagination: "CURSOR";
  maximumPageSize: number;
  minimumCadenceSeconds: number;
  freshnessSeconds: number;
  retryableStatusCodes: readonly number[];
  attributionRequired: boolean;
}>;

export interface ExternalProviderAdapter {
  readonly contract: ExternalProviderContract;
  fetchPage(input: {
    cursor: string | null;
    from: Date;
    to: Date;
    checkpoint: unknown;
  }): Promise<ExternalProviderPage>;
  normalize(record: unknown): ExternalProviderRecord;
}

export function canonicalExternalJson(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(canonicalExternalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([key, child]) =>
          `${JSON.stringify(key)}:${canonicalExternalJson(child)}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function externalRecordDigest(record: ExternalProviderRecord) {
  return createHash("sha256")
    .update(canonicalExternalJson(record))
    .digest("hex");
}

export function normalizeExternalRecord(
  input: unknown,
): ExternalProviderRecord {
  return externalProviderRecordSchema.parse(input);
}

export class SyntheticFixtureProvider implements ExternalProviderAdapter {
  readonly contract: ExternalProviderContract = {
    key: "SYNTHETIC_FIXTURE_V1",
    displayName: "Synthetic contract fixture",
    capabilities: externalRecordTypes,
    authentication: "FIXTURE_ONLY",
    pagination: "CURSOR",
    maximumPageSize: 1_000,
    minimumCadenceSeconds: 60,
    freshnessSeconds: 300,
    retryableStatusCodes: [408, 429, 500, 502, 503, 504],
    attributionRequired: false,
  };

  constructor(private readonly pages: readonly ExternalProviderPage[]) {}

  async fetchPage(input: {
    cursor: string | null;
    from: Date;
    to: Date;
    checkpoint: unknown;
  }): Promise<ExternalProviderPage> {
    const index = input.cursor === null ? 0 : Number(input.cursor);
    const page = this.pages[index];
    if (!page) throw new Error("FIXTURE_PAGE_UNAVAILABLE");
    return externalProviderPageSchema.parse(page);
  }

  normalize(record: unknown) {
    return normalizeExternalRecord(record);
  }
}
