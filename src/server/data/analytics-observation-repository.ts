import { Prisma, type PrismaClient } from "@prisma/client";

import {
  parseAnalyticsObservation,
  type AnalyticsObservation,
  type AnalyticsObservationInput,
} from "@/domain/analytics";
import { parseEventBody } from "@/domain/events/event-log";

export class AnalyticsObservationError extends Error {
  constructor(
    readonly code:
      "SOURCE_UNAVAILABLE" | "INVALID_SOURCE" | "SUPERSESSION_MISMATCH",
    message: string,
  ) {
    super(message);
    this.name = "AnalyticsObservationError";
  }
}

function mapObservation(row: {
  id: string;
  accountId: string;
  gameId: string;
  setupSnapshotId: string;
  sourceEventId: string;
  type: "BATTED_BALL_LOCATION" | "PITCH_LOCATION";
  version: number;
  ordinal: number;
  captureSource: "MANUAL";
  confidence: "OBSERVED" | "ESTIMATED";
  payload: Prisma.JsonValue;
  supersedesObservationId: string | null;
  recordedAt: Date;
}): AnalyticsObservation {
  return parseAnalyticsObservation({
    id: row.id,
    accountId: row.accountId,
    gameId: row.gameId,
    setupSnapshotId: row.setupSnapshotId,
    sourceEventId: row.sourceEventId,
    type: row.type,
    version: row.version,
    ordinal: row.ordinal,
    captureSource: row.captureSource,
    confidence: row.confidence,
    payload: row.payload,
    supersedesObservationId: row.supersedesObservationId,
    recordedAt: row.recordedAt.toISOString(),
  });
}

export class PrismaAnalyticsObservationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(
    input: AnalyticsObservationInput & {
      accountId: string;
      actorId: string;
      actorUserId: string | null;
    },
  ): Promise<AnalyticsObservation> {
    return this.prisma.$transaction(async (tx) => {
      const source = await tx.sourceEvent.findFirst({
        where: {
          accountId: input.accountId,
          gameId: input.gameId,
          setupSnapshotId: input.setupSnapshotId,
          id: input.sourceEventId,
        },
        select: { eventType: true, schemaVersion: true, payload: true },
      });
      if (!source) {
        throw new AnalyticsObservationError(
          "SOURCE_UNAVAILABLE",
          "The source plate appearance is unavailable.",
        );
      }
      try {
        const body = parseEventBody(
          { eventType: source.eventType, payload: source.payload },
          source.schemaVersion as 1 | 2 | 3,
        );
        if (body.eventType !== "PlateAppearanceRecorded") {
          throw new Error("not a plate appearance");
        }
      } catch {
        throw new AnalyticsObservationError(
          "INVALID_SOURCE",
          "Observations must attach to an accepted plate appearance.",
        );
      }
      if (input.supersedesObservationId) {
        const prior = await tx.analyticsObservation.findFirst({
          where: {
            accountId: input.accountId,
            id: input.supersedesObservationId,
            gameId: input.gameId,
            sourceEventId: input.sourceEventId,
            type: input.type,
            ordinal: input.ordinal,
            supersededBy: { none: {} },
          },
        });
        if (!prior) {
          throw new AnalyticsObservationError(
            "SUPERSESSION_MISMATCH",
            "Only the current matching observation can be superseded.",
          );
        }
      }
      const row = await tx.analyticsObservation.create({
        data: {
          accountId: input.accountId,
          gameId: input.gameId,
          setupSnapshotId: input.setupSnapshotId,
          sourceEventId: input.sourceEventId,
          type: input.type,
          version: input.version,
          ordinal: input.ordinal,
          captureSource: input.captureSource,
          confidence: input.confidence,
          payload: input.payload as Prisma.InputJsonValue,
          actorId: input.actorId,
          actorUserId: input.actorUserId,
          supersedesObservationId: input.supersedesObservationId ?? null,
          ...(input.recordedAt
            ? { recordedAt: new Date(input.recordedAt) }
            : {}),
        },
      });
      return mapObservation(row);
    });
  }

  async listCurrent(
    accountId: string,
    gameId: string,
  ): Promise<AnalyticsObservation[]> {
    const rows = await this.prisma.analyticsObservation.findMany({
      where: { accountId, gameId, supersededBy: { none: {} } },
      orderBy: [{ sourceEventId: "asc" }, { type: "asc" }, { ordinal: "asc" }],
    });
    return rows.map(mapObservation);
  }
}
