import { z } from "zod";

export const ANALYTICS_OBSERVATION_VERSION = 1 as const;

export const battedBallSectors = [
  "LEFT_FIELD",
  "LEFT_CENTER",
  "CENTER_FIELD",
  "RIGHT_CENTER",
  "RIGHT_FIELD",
  "INFIELD",
  "FOUL_UNKNOWN",
  "UNKNOWN",
] as const;
export const pitchZoneCells = [
  "UP_LEFT",
  "UP_MIDDLE",
  "UP_RIGHT",
  "MID_LEFT",
  "MID_MIDDLE",
  "MID_RIGHT",
  "LOW_LEFT",
  "LOW_MIDDLE",
  "LOW_RIGHT",
  "OUT_OF_ZONE",
  "UNKNOWN",
] as const;
export const pitchResults = [
  "BALL",
  "CALLED_STRIKE",
  "SWINGING_STRIKE",
  "FOUL",
  "IN_PLAY",
  "UNKNOWN",
] as const;

const id = z.string().trim().min(1).max(128);
const coordinate = z.number().finite().min(-1).max(1).nullable();

const battedBallPayload = z
  .object({
    sector: z.enum(battedBallSectors),
    x: coordinate,
    y: coordinate,
  })
  .strict();

const pitchLocationPayload = z
  .object({
    zoneCell: z.enum(pitchZoneCells),
    result: z.enum(pitchResults),
    pitchType: z.string().trim().min(1).max(32).nullable(),
  })
  .strict();

export const analyticsObservationSchema = z
  .object({
    id,
    accountId: id,
    gameId: id,
    setupSnapshotId: id,
    sourceEventId: id,
    type: z.enum(["BATTED_BALL_LOCATION", "PITCH_LOCATION"]),
    version: z.literal(ANALYTICS_OBSERVATION_VERSION),
    ordinal: z.int().nonnegative().max(10_000),
    captureSource: z.literal("MANUAL"),
    confidence: z.enum(["OBSERVED", "ESTIMATED"]),
    payload: z.union([battedBallPayload, pitchLocationPayload]),
    supersedesObservationId: id.nullable(),
    recordedAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.type === "BATTED_BALL_LOCATION" && !("sector" in value.payload)) ||
      (value.type === "PITCH_LOCATION" && !("zoneCell" in value.payload))
    ) {
      context.addIssue({
        code: "custom",
        path: ["payload"],
        message: "Observation payload does not match its observation type.",
      });
    }
  });

export type AnalyticsObservation = z.infer<typeof analyticsObservationSchema>;
export type AnalyticsObservationInput = Omit<
  AnalyticsObservation,
  "id" | "recordedAt"
> & { id?: string; recordedAt?: string };

export function parseAnalyticsObservation(
  input: unknown,
): AnalyticsObservation {
  return analyticsObservationSchema.parse(input);
}

export function isBattedBallPayload(
  observation: AnalyticsObservation,
): observation is AnalyticsObservation & {
  type: "BATTED_BALL_LOCATION";
  payload: z.infer<typeof battedBallPayload>;
} {
  return observation.type === "BATTED_BALL_LOCATION";
}

export function isPitchLocationPayload(
  observation: AnalyticsObservation,
): observation is AnalyticsObservation & {
  type: "PITCH_LOCATION";
  payload: z.infer<typeof pitchLocationPayload>;
} {
  return observation.type === "PITCH_LOCATION";
}
