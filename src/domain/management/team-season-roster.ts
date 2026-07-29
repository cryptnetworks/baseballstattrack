import { z } from "zod";

const stableId = z.string().trim().min(1).max(128);
const expectedRevision = z.int().nonnegative();
const normalizedLabel = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .transform((value) => value.replace(/\s+/g, " "));
const color = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .transform((value) => value.toUpperCase());
const dateOnly = z.iso.date();
const dateTime = z.iso.datetime();
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

export const JERSEY_NUMBER_PATTERN = /^(?:0|00|[1-9][0-9]?)$/;
const jerseyNumber = z.string().trim().regex(JERSEY_NUMBER_PATTERN).nullable();

export type ManagementErrorCode =
  | "NOT_FOUND_OR_INACCESSIBLE"
  | "ACCOUNT_MISMATCH"
  | "INVALID_INPUT"
  | "LIFECYCLE_CONFLICT"
  | "DUPLICATE_ACTIVE_RELATIONSHIP"
  | "STALE_REVISION"
  | "IMMUTABLE_HISTORY_CONFLICT"
  | "AUTHORIZATION_REQUIRED"
  | "PERSISTENCE_CONFLICT"
  | "INTERNAL_INVARIANT_FAILURE";

export class ManagementError extends Error {
  constructor(
    readonly code: ManagementErrorCode,
    message: string,
    readonly context: Readonly<Record<string, string | number>> = {},
  ) {
    super(message);
    this.name = "ManagementError";
  }
}

export type ManagementCapability =
  | "team.view"
  | "team.manage"
  | "season.view"
  | "season.manage"
  | "roster.view"
  | "roster.manage";

export type ManagementActorContext = {
  accountId: string;
  actorId: string;
  actorKind: "USER" | "SERVICE";
  actorUserId: string | null;
  membershipId: string | null;
  capability: ManagementCapability;
  scope:
    | { kind: "ACCOUNT" }
    | { kind: "TEAM"; teamId: string }
    | { kind: "SEASON"; seasonId: string };
  authorizedAt: string;
};

export const managementActorSchema = z
  .object({
    accountId: stableId,
    actorId: stableId,
    actorKind: z.enum(["USER", "SERVICE"]),
    actorUserId: stableId.nullable(),
    membershipId: stableId.nullable(),
    capability: z.enum([
      "team.view",
      "team.manage",
      "season.view",
      "season.manage",
      "roster.view",
      "roster.manage",
    ]),
    scope: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("ACCOUNT") }).strict(),
      z.object({ kind: z.literal("TEAM"), teamId: stableId }).strict(),
      z.object({ kind: z.literal("SEASON"), seasonId: stableId }).strict(),
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

export const createTeamCommandSchema = z
  .object({
    accountId: stableId,
    displayName: normalizedLabel,
    color: color.nullable().default(null),
  })
  .strict();

export const updateTeamCommandSchema = z
  .object({
    accountId: stableId,
    teamId: stableId,
    expectedRevision,
    displayName: normalizedLabel.optional(),
    color: color.nullable().optional(),
  })
  .strict()
  .refine(
    ({ displayName, color: teamColor }) =>
      displayName !== undefined || teamColor !== undefined,
    { message: "At least one team field must be updated." },
  );

export const setTeamArchivedCommandSchema = z
  .object({
    accountId: stableId,
    teamId: stableId,
    expectedRevision,
    archived: z.boolean(),
  })
  .strict();

export const createSeasonCommandSchema = z
  .object({
    accountId: stableId,
    displayName: normalizedLabel,
    startsOn: dateOnly.nullable().default(null),
    endsOn: dateOnly.nullable().default(null),
  })
  .strict()
  .superRefine(({ startsOn, endsOn }, context) => {
    if (startsOn !== null && endsOn !== null && endsOn < startsOn) {
      context.addIssue({
        code: "custom",
        message: "Season end cannot precede its start.",
        path: ["endsOn"],
      });
    }
  });

export const updateSeasonCommandSchema = z
  .object({
    accountId: stableId,
    seasonId: stableId,
    expectedRevision,
    displayName: normalizedLabel.optional(),
    startsOn: dateOnly.nullable().optional(),
    endsOn: dateOnly.nullable().optional(),
  })
  .strict()
  .refine(
    ({ displayName, startsOn, endsOn }) =>
      displayName !== undefined ||
      startsOn !== undefined ||
      endsOn !== undefined,
    { message: "At least one season field must be updated." },
  );

export const transitionSeasonCommandSchema = z
  .object({
    accountId: stableId,
    seasonId: stableId,
    expectedRevision,
    status: z.enum(["DRAFT", "ACTIVE", "COMPLETED", "ARCHIVED"]),
  })
  .strict();

export const addTeamSeasonCommandSchema = z
  .object({
    accountId: stableId,
    teamId: stableId,
    seasonId: stableId,
  })
  .strict();

export const setTeamSeasonArchivedCommandSchema = z
  .object({
    accountId: stableId,
    teamSeasonId: stableId,
    expectedRevision,
    archived: z.boolean(),
  })
  .strict();

export const createPlayerCommandSchema = z
  .object({
    accountId: stableId,
    displayName: normalizedLabel,
    battingSide: z.enum(["LEFT", "RIGHT", "SWITCH"]).nullable().default(null),
    throwingHand: z.enum(["LEFT", "RIGHT"]).nullable().default(null),
  })
  .strict();

export const updatePlayerCommandSchema = z
  .object({
    accountId: stableId,
    playerId: stableId,
    expectedRevision,
    displayName: normalizedLabel.optional(),
    battingSide: z.enum(["LEFT", "RIGHT", "SWITCH"]).nullable().optional(),
    throwingHand: z.enum(["LEFT", "RIGHT"]).nullable().optional(),
  })
  .strict()
  .refine(
    ({ displayName, battingSide, throwingHand }) =>
      displayName !== undefined ||
      battingSide !== undefined ||
      throwingHand !== undefined,
    { message: "At least one player field must be updated." },
  );

export const setPlayerArchivedCommandSchema = z
  .object({
    accountId: stableId,
    playerId: stableId,
    expectedRevision,
    archived: z.boolean(),
  })
  .strict();

export const addRosterPeriodCommandSchema = z
  .object({
    accountId: stableId,
    teamSeasonId: stableId,
    playerId: stableId,
    startsAt: dateTime,
    jerseyNumber,
    primaryPosition: baseballPosition.nullable().default(null),
  })
  .strict();

export const endRosterPeriodCommandSchema = z
  .object({
    accountId: stableId,
    rosterEntryId: stableId,
    expectedRevision,
    endsAt: dateTime,
    status: z.enum(["INACTIVE", "ARCHIVED"]).default("INACTIVE"),
  })
  .strict();

export const changeJerseyCommandSchema = z
  .object({
    accountId: stableId,
    rosterEntryId: stableId,
    expectedRevision,
    effectiveAt: dateTime,
    jerseyNumber,
    primaryPosition: baseballPosition.nullable().optional(),
  })
  .strict();

const pageLimit = z.int().min(1).max(100).default(25);
export const namePageSchema = z
  .object({
    accountId: stableId,
    limit: pageLimit,
    after: z
      .object({ displayName: z.string(), id: stableId })
      .strict()
      .nullable()
      .default(null),
  })
  .strict();
export const rosterHistoryPageSchema = z
  .object({
    accountId: stableId,
    teamSeasonId: stableId.optional(),
    playerId: stableId.optional(),
    limit: pageLimit,
    after: z
      .object({ startsAt: dateTime, id: stableId })
      .strict()
      .nullable()
      .default(null),
  })
  .strict()
  .refine(
    ({ teamSeasonId, playerId }) =>
      teamSeasonId !== undefined || playerId !== undefined,
    { message: "Roster history requires a team-season or player filter." },
  );

export function parseManagementInput<T>(
  schema: z.ZodType<T>,
  input: unknown,
): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ManagementError("INVALID_INPUT", "Management input is invalid.");
  }
  return result.data;
}

export function requireManagementActor(
  input: unknown,
  accountId: string,
  capability: ManagementCapability,
): ManagementActorContext {
  const result = managementActorSchema.safeParse(input);
  if (!result.success) {
    throw new ManagementError(
      "AUTHORIZATION_REQUIRED",
      "Validated actor context is required.",
    );
  }
  if (result.data.accountId !== accountId) {
    throw new ManagementError(
      "ACCOUNT_MISMATCH",
      "Validated actor Account does not match the command.",
    );
  }
  if (result.data.capability !== capability) {
    throw new ManagementError(
      "AUTHORIZATION_REQUIRED",
      "Validated actor capability does not permit this operation.",
    );
  }
  return result.data;
}

export function assertScope(
  actor: ManagementActorContext,
  target: { teamId?: string; seasonId?: string },
): void {
  if (
    (actor.scope.kind === "TEAM" && actor.scope.teamId !== target.teamId) ||
    (actor.scope.kind === "SEASON" && actor.scope.seasonId !== target.seasonId)
  ) {
    throw new ManagementError(
      "AUTHORIZATION_REQUIRED",
      "Validated actor scope does not permit this operation.",
    );
  }
}

export function toInstant(value: string): Date {
  return new Date(value);
}

export function toDate(value: string | null): Date | null {
  return value === null ? null : new Date(`${value}T00:00:00.000Z`);
}

export type CreateTeamCommand = z.infer<typeof createTeamCommandSchema>;
export type UpdateTeamCommand = z.infer<typeof updateTeamCommandSchema>;
export type SetTeamArchivedCommand = z.infer<
  typeof setTeamArchivedCommandSchema
>;
export type CreateSeasonCommand = z.infer<typeof createSeasonCommandSchema>;
export type UpdateSeasonCommand = z.infer<typeof updateSeasonCommandSchema>;
export type TransitionSeasonCommand = z.infer<
  typeof transitionSeasonCommandSchema
>;
export type AddTeamSeasonCommand = z.infer<typeof addTeamSeasonCommandSchema>;
export type SetTeamSeasonArchivedCommand = z.infer<
  typeof setTeamSeasonArchivedCommandSchema
>;
export type CreatePlayerCommand = z.infer<typeof createPlayerCommandSchema>;
export type UpdatePlayerCommand = z.infer<typeof updatePlayerCommandSchema>;
export type SetPlayerArchivedCommand = z.infer<
  typeof setPlayerArchivedCommandSchema
>;
export type AddRosterPeriodCommand = z.infer<
  typeof addRosterPeriodCommandSchema
>;
export type EndRosterPeriodCommand = z.infer<
  typeof endRosterPeriodCommandSchema
>;
export type ChangeJerseyCommand = z.infer<typeof changeJerseyCommandSchema>;
export type NamePage = z.infer<typeof namePageSchema>;
export type RosterHistoryPage = z.infer<typeof rosterHistoryPageSchema>;
