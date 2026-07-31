import { z } from "zod";

import {
  parseAnalyticsObservation,
  type AnalyticsObservation,
} from "@/domain/analytics";
import {
  requireTrustedActor,
  type TrustedActorContext,
} from "@/server/auth/types";
import { getPrismaClient } from "@/server/data/prisma";
import {
  PrismaAnalyticsObservationRepository,
  type AnalyticsObservationError,
} from "@/server/data/analytics-observation-repository";

const id = z.string().trim().min(1).max(128);
const inputSchema = z
  .object({
    accountId: id,
    gameId: id,
    setupSnapshotId: id,
    sourceEventId: id,
    type: z.enum(["BATTED_BALL_LOCATION", "PITCH_LOCATION"]),
    version: z.literal(1),
    ordinal: z.int().nonnegative().max(10_000),
    captureSource: z.literal("MANUAL"),
    confidence: z.enum(["OBSERVED", "ESTIMATED"]),
    payload: z.record(z.string(), z.unknown()),
    supersedesObservationId: id.nullable().optional(),
    recordedAt: z.iso.datetime().optional(),
  })
  .strict();

type Repository = Pick<
  PrismaAnalyticsObservationRepository,
  "create" | "listCurrent"
>;

function gameActor(
  actorInput: TrustedActorContext,
  accountId: string,
  gameId: string,
  capability: "game.score" | "report.view",
) {
  const actor = requireTrustedActor(actorInput, accountId, capability);
  if (actor.target.kind !== "GAME" || actor.target.gameId !== gameId) {
    throw new Error("Exact game authorization is required.");
  }
  return actor;
}

export class AnalyticsObservationService {
  constructor(private readonly repository: Repository) {}

  async create(input: unknown, actorInput: TrustedActorContext) {
    const value = inputSchema.parse(input);
    const actor = gameActor(
      actorInput,
      value.accountId,
      value.gameId,
      "game.score",
    );
    const parsed = parseAnalyticsObservation({
      ...value,
      id: "pending-observation",
      supersedesObservationId: value.supersedesObservationId ?? null,
      recordedAt: value.recordedAt ?? new Date().toISOString(),
    });
    return this.repository.create({
      ...parsed,
      accountId: value.accountId,
      actorId: actor.actorId,
      actorUserId: actor.actorUserId,
    });
  }

  async list(
    input: { accountId: string; gameId: string },
    actorInput: TrustedActorContext,
  ): Promise<AnalyticsObservation[]> {
    const actor = gameActor(
      actorInput,
      input.accountId,
      input.gameId,
      "report.view",
    );
    return this.repository.listCurrent(actor.accountId, input.gameId);
  }
}

export function getAnalyticsObservationService() {
  return new AnalyticsObservationService(
    new PrismaAnalyticsObservationRepository(getPrismaClient()),
  );
}

export type { AnalyticsObservationError };
