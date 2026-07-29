import { z } from "zod";

const stableId = z.string().trim().min(1).max(128);
const expectedRevision = z.int().nonnegative();
const normalizedLabel = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .transform((value) => value.replace(/\s+/g, " "));
const location = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .transform((value) => value.replace(/\s+/g, " "))
  .nullable();
const dateTime = z.iso.datetime();
const weatherCondition = z
  .enum([
    "CLEAR",
    "PARTLY_CLOUDY",
    "CLOUDY",
    "LIGHT_RAIN",
    "RAIN",
    "WINDY",
    "INDOOR",
  ])
  .nullable();
const temperatureF = z.int().min(-20).max(130).nullable();
const baseballPosition = z.enum([
  "PITCHER",
  "CATCHER",
  "FIRST_BASE",
  "SECOND_BASE",
  "THIRD_BASE",
  "SHORTSTOP",
  "LEFT_FIELD",
  "CENTER_FIELD",
  "RIGHT_FIELD",
  "DESIGNATED_HITTER",
  "EXTRA_HITTER",
]);
const jerseyNumber = z
  .string()
  .trim()
  .regex(/^(?:0|00|[1-9][0-9]?)$/)
  .nullable();
const battingOrder = z.int().min(1).max(30).nullable();

const activeAssignment = z
  .object({
    battingOrder,
    defensivePosition: baseballPosition.nullable(),
    isStartingPitcher: z.boolean().default(false),
  })
  .strict()
  .refine(
    ({ defensivePosition, isStartingPitcher }) =>
      !isStartingPitcher || defensivePosition === "PITCHER",
    { message: "A starting pitcher must be assigned to pitcher." },
  );

const managedLineupSlot = activeAssignment.safeExtend({
  kind: z.literal("MANAGED"),
  playerId: stableId,
  rosterEntryId: stableId,
});

const externalLineupSlot = activeAssignment.safeExtend({
  kind: z.literal("EXTERNAL"),
  displayName: normalizedLabel,
  jerseyNumber,
});

const managedSide = z
  .object({
    kind: z.literal("MANAGED"),
    side: z.enum(["HOME", "AWAY"]),
    teamSeasonId: stableId,
    lineup: z.array(managedLineupSlot).max(30),
  })
  .strict();

const externalSide = z
  .object({
    kind: z.literal("EXTERNAL"),
    side: z.enum(["HOME", "AWAY"]),
    displayName: normalizedLabel,
    lineup: z.array(externalLineupSlot).max(30),
  })
  .strict();

export const gameSetupActorSchema = z
  .object({
    accountId: stableId,
    actorId: stableId,
    actorKind: z.enum(["USER", "SERVICE"]),
    actorUserId: stableId.nullable(),
    membershipId: stableId.nullable(),
    capability: z.enum(["game.create", "game.setup", "game.view"]),
    scope: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("ACCOUNT") }).strict(),
      z.object({ kind: z.literal("TEAM"), teamId: stableId }).strict(),
      z.object({ kind: z.literal("SEASON"), seasonId: stableId }).strict(),
      z.object({ kind: z.literal("GAME"), gameId: stableId }).strict(),
    ]),
    authorizedAt: dateTime,
  })
  .strict()
  .superRefine((actor, context) => {
    if (
      (actor.actorKind === "USER" &&
        (actor.actorUserId === null || actor.membershipId === null)) ||
      (actor.actorKind === "SERVICE" &&
        (actor.actorUserId !== null || actor.membershipId !== null))
    ) {
      context.addIssue({
        code: "custom",
        message: "Actor identity is inconsistent.",
      });
    }
  });

export const createDraftGameCommandSchema = z
  .object({
    accountId: stableId,
    seasonId: stableId,
    managedTeamSeasonId: stableId,
    scheduledAt: dateTime,
    location: location.default(null),
    weatherCondition: weatherCondition.default(null),
    temperatureF: temperatureF.default(null),
  })
  .strict();

export const saveSetupRevisionCommandSchema = z
  .object({
    accountId: stableId,
    gameId: stableId,
    expectedSetupRevision: expectedRevision,
    clientSubmissionId: stableId,
    rulesetVersionId: stableId,
    scheduledAt: dateTime,
    location: location.default(null),
    weatherCondition: weatherCondition.default(null),
    temperatureF: temperatureF.default(null),
    sides: z.array(z.discriminatedUnion("kind", [managedSide, externalSide])),
  })
  .strict()
  .superRefine(({ sides }, context) => {
    if (new Set(sides.map(({ side }) => side)).size !== sides.length) {
      context.addIssue({
        code: "custom",
        message: "A setup revision cannot repeat a game side.",
        path: ["sides"],
      });
    }
    const managedTeamSeasons = sides
      .filter((side) => side.kind === "MANAGED")
      .map(({ teamSeasonId }) => teamSeasonId);
    if (new Set(managedTeamSeasons).size !== managedTeamSeasons.length) {
      context.addIssue({
        code: "custom",
        message: "A managed team-season cannot occupy both sides.",
        path: ["sides"],
      });
    }

    const managedPlayers = new Set<string>();
    const managedRosters = new Set<string>();
    for (const [sideIndex, side] of sides.entries()) {
      const battingOrders = side.lineup
        .map(({ battingOrder: order }) => order)
        .filter((order) => order !== null);
      if (new Set(battingOrders).size !== battingOrders.length) {
        context.addIssue({
          code: "custom",
          message: "Batting order must be unique on a side.",
          path: ["sides", sideIndex, "lineup"],
        });
      }
      const positions = side.lineup
        .map(({ defensivePosition }) => defensivePosition)
        .filter(
          (position) =>
            position !== null &&
            position !== "DESIGNATED_HITTER" &&
            position !== "EXTRA_HITTER",
        );
      if (new Set(positions).size !== positions.length) {
        context.addIssue({
          code: "custom",
          message: "Conventional defensive positions must be unique.",
          path: ["sides", sideIndex, "lineup"],
        });
      }
      if (side.kind === "MANAGED") {
        for (const [slotIndex, slot] of side.lineup.entries()) {
          if (managedPlayers.has(slot.playerId)) {
            context.addIssue({
              code: "custom",
              message: "A managed player cannot appear more than once.",
              path: ["sides", sideIndex, "lineup", slotIndex, "playerId"],
            });
          }
          if (managedRosters.has(slot.rosterEntryId)) {
            context.addIssue({
              code: "custom",
              message: "A roster entry cannot appear more than once.",
              path: ["sides", sideIndex, "lineup", slotIndex, "rosterEntryId"],
            });
          }
          managedPlayers.add(slot.playerId);
          managedRosters.add(slot.rosterEntryId);
        }
      } else {
        const names = side.lineup.map(({ displayName }) =>
          displayName.toLocaleLowerCase("en-US"),
        );
        if (new Set(names).size !== names.length) {
          context.addIssue({
            code: "custom",
            message: "An external lineup cannot repeat a player label.",
            path: ["sides", sideIndex, "lineup"],
          });
        }
      }
    }
  });

export const markSetupReadyCommandSchema = z
  .object({
    accountId: stableId,
    gameId: stableId,
    setupSnapshotId: stableId,
    expectedSetupRevision: z.int().min(1),
  })
  .strict();

export const loadCurrentSetupQuerySchema = z
  .object({ accountId: stableId, gameId: stableId })
  .strict();

export const rosterCandidatePageSchema = z
  .object({
    accountId: stableId,
    gameId: stableId,
    teamSeasonId: stableId,
    limit: z.int().min(1).max(100).default(25),
    after: z
      .object({ displayName: z.string(), id: stableId })
      .strict()
      .nullable()
      .default(null),
  })
  .strict();

export type GameSetupErrorCode =
  | "INVALID_INPUT"
  | "AUTHORIZATION_REQUIRED"
  | "ACCOUNT_MISMATCH"
  | "NOT_FOUND_OR_INACCESSIBLE"
  | "LIFECYCLE_CONFLICT"
  | "STALE_SETUP_REVISION"
  | "DUPLICATE_SUBMISSION"
  | "INVALID_PARTICIPANT"
  | "INVALID_LINEUP"
  | "INVALID_PITCHER"
  | "ROSTER_INELIGIBLE"
  | "SETUP_INCOMPLETE"
  | "IMMUTABLE_SETUP"
  | "PERSISTENCE_CONFLICT"
  | "INTERNAL_INVARIANT_FAILURE";

export type GameSetupFieldIssue = {
  field: string;
  code: string;
};

export class GameSetupError extends Error {
  constructor(
    readonly code: GameSetupErrorCode,
    message: string,
    readonly issues: readonly GameSetupFieldIssue[] = [],
  ) {
    super(message);
    this.name = "GameSetupError";
  }
}

export type GameSetupCapability = z.infer<
  typeof gameSetupActorSchema
>["capability"];
export type GameSetupActorContext = z.infer<typeof gameSetupActorSchema>;

export function parseGameSetupInput<T>(
  schema: z.ZodType<T>,
  input: unknown,
): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new GameSetupError(
      "INVALID_INPUT",
      "Game setup input is invalid.",
      result.error.issues.slice(0, 20).map((issue) => ({
        field: issue.path.join("."),
        code: issue.code,
      })),
    );
  }
  return result.data;
}

export function requireGameSetupActor(
  input: unknown,
  accountId: string,
  capability: GameSetupCapability,
): GameSetupActorContext {
  const result = gameSetupActorSchema.safeParse(input);
  if (!result.success) {
    throw new GameSetupError(
      "AUTHORIZATION_REQUIRED",
      "Validated setup actor context is required.",
    );
  }
  if (result.data.accountId !== accountId) {
    throw new GameSetupError(
      "ACCOUNT_MISMATCH",
      "Validated actor Account does not match the request.",
    );
  }
  if (result.data.capability !== capability) {
    throw new GameSetupError(
      "AUTHORIZATION_REQUIRED",
      "Validated actor capability does not permit this operation.",
    );
  }
  return result.data;
}

export function assertGameScope(
  actor: GameSetupActorContext,
  gameId: string,
): void {
  if (actor.scope.kind !== "GAME" || actor.scope.gameId !== gameId) {
    throw new GameSetupError(
      "AUTHORIZATION_REQUIRED",
      "Exact Game scope is required.",
    );
  }
}

export function assertGameCreateScope(
  actor: GameSetupActorContext,
  target: { teamId: string; seasonId: string },
): void {
  if (
    actor.scope.kind === "GAME" ||
    (actor.scope.kind === "TEAM" && actor.scope.teamId !== target.teamId) ||
    (actor.scope.kind === "SEASON" && actor.scope.seasonId !== target.seasonId)
  ) {
    throw new GameSetupError(
      "AUTHORIZATION_REQUIRED",
      "Actor scope does not permit game creation.",
    );
  }
}

export type CreateDraftGameCommand = z.infer<
  typeof createDraftGameCommandSchema
>;
export type SaveSetupRevisionCommand = z.infer<
  typeof saveSetupRevisionCommandSchema
>;
export type MarkSetupReadyCommand = z.infer<typeof markSetupReadyCommandSchema>;
export type LoadCurrentSetupQuery = z.infer<typeof loadCurrentSetupQuerySchema>;
export type RosterCandidatePage = z.infer<typeof rosterCandidatePageSchema>;
