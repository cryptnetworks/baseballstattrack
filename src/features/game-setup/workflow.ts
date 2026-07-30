import { z } from "zod";

import type { SaveSetupRevisionCommand } from "@/domain/setup/game-setup";

export const SETUP_STEPS = [
  "GAME_DETAILS",
  "PARTICIPANTS",
  "LINEUP",
  "REVIEW",
] as const;

export type SetupStep = (typeof SETUP_STEPS)[number];

export const BASEBALL_POSITIONS = [
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
] as const;

export const WEATHER_CONDITIONS = [
  "CLEAR",
  "PARTLY_CLOUDY",
  "CLOUDY",
  "LIGHT_RAIN",
  "RAIN",
  "WINDY",
  "INDOOR",
] as const;

const id = z.string().trim().min(1).max(128);
const nullablePosition = z.enum(BASEBALL_POSITIONS).nullable();

export const managedLineupRowSchema = z
  .object({
    kind: z.literal("MANAGED"),
    selected: z.boolean(),
    eligible: z.boolean(),
    playerId: id,
    rosterEntryId: id,
    displayName: z.string().trim().min(1).max(100),
    jerseyNumber: z.string().trim().max(2).nullable(),
    battingOrder: z.int().min(1).max(30).nullable(),
    defensivePosition: nullablePosition,
    isStartingPitcher: z.boolean(),
  })
  .strict();

export const externalLineupRowSchema = z
  .object({
    kind: z.literal("EXTERNAL"),
    clientId: id,
    displayName: z.string().trim().max(100),
    jerseyNumber: z.string().trim().max(2).nullable(),
    battingOrder: z.int().min(1).max(30).nullable(),
    defensivePosition: nullablePosition,
    isStartingPitcher: z.boolean(),
  })
  .strict();

export type ManagedLineupRow = z.infer<typeof managedLineupRowSchema>;
export type ExternalLineupRow = z.infer<typeof externalLineupRowSchema>;

export const setupWorkflowDraftSchema = z
  .object({
    accountId: id,
    gameId: id,
    expectedSetupRevision: z.int().nonnegative(),
    clientSubmissionId: id,
    rulesetVersionId: id,
    managedTeamSeasonId: id,
    managedSide: z.enum(["HOME", "AWAY"]),
    scheduledAt: z.string().trim().min(1).max(40),
    location: z.string().trim().max(120),
    weatherCondition: z.enum(WEATHER_CONDITIONS).nullable(),
    temperatureF: z.int().min(-20).max(130).nullable(),
    opponentKind: z.enum(["MANAGED", "EXTERNAL"]),
    opponentTeamSeasonId: z.string().trim().max(128).nullable(),
    externalOpponentName: z.string().trim().max(100),
    managedLineup: z.array(managedLineupRowSchema).max(100),
    opponentManagedLineup: z.array(managedLineupRowSchema).max(100),
    externalLineup: z.array(externalLineupRowSchema).max(30),
  })
  .strict();

export type SetupWorkflowDraft = z.infer<typeof setupWorkflowDraftSchema>;

export type SetupFieldError = Readonly<{
  field: string;
  message: string;
}>;

export type SetupMutationResult =
  | Readonly<{
      status: "IDLE";
      intent: null;
      fieldErrors: readonly [];
    }>
  | Readonly<{
      status: "ERROR";
      intent: "SAVE" | "READY" | "START";
      code: string;
      message: string;
      fieldErrors: readonly SetupFieldError[];
    }>
  | Readonly<{
      status: "SUCCESS";
      intent: "SAVE" | "READY" | "START";
      message: string;
      setupRevision: number;
      setupSnapshotId: string;
      gameStatus: "DRAFT" | "READY" | "IN_PROGRESS";
      acceptedClientSubmissionId: string;
      nextClientSubmissionId: string;
      fieldErrors: readonly [];
    }>;

export type CreateGameResult =
  | Readonly<{ status: "IDLE"; fieldErrors: readonly [] }>
  | Readonly<{
      status: "ERROR";
      message: string;
      fieldErrors: readonly SetupFieldError[];
    }>;

export const initialCreateGameResult: CreateGameResult = {
  status: "IDLE",
  fieldErrors: [],
};

export const initialSetupMutationResult: SetupMutationResult = {
  status: "IDLE",
  intent: null,
  fieldErrors: [],
};

function oppositeSide(side: "HOME" | "AWAY") {
  return side === "HOME" ? ("AWAY" as const) : ("HOME" as const);
}

function selectedManagedRows(rows: readonly ManagedLineupRow[]) {
  return rows
    .filter(({ selected }) => selected)
    .map(
      ({
        playerId,
        rosterEntryId,
        battingOrder,
        defensivePosition,
        isStartingPitcher,
      }) => ({
        kind: "MANAGED" as const,
        playerId,
        rosterEntryId,
        battingOrder,
        defensivePosition,
        isStartingPitcher,
      }),
    );
}

function externalRows(rows: readonly ExternalLineupRow[]) {
  return rows
    .filter(({ displayName }) => displayName.trim().length > 0)
    .map(
      ({
        displayName,
        jerseyNumber,
        battingOrder,
        defensivePosition,
        isStartingPitcher,
      }) => ({
        kind: "EXTERNAL" as const,
        displayName,
        jerseyNumber:
          jerseyNumber && jerseyNumber.trim().length > 0 ? jerseyNumber : null,
        battingOrder,
        defensivePosition,
        isStartingPitcher,
      }),
    );
}

function scheduledAtIso(value: string): string | null {
  const parsed = new Date(
    /(?:Z|[+-]\d{2}:\d{2})$/u.test(value) ? value : `${value}Z`,
  );
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}

function lineupsForValidation(draft: SetupWorkflowDraft) {
  return {
    managed: draft.managedLineup.filter(({ selected }) => selected),
    opponent:
      draft.opponentKind === "MANAGED"
        ? draft.opponentManagedLineup.filter(({ selected }) => selected)
        : draft.externalLineup.filter(
            ({ displayName }) => displayName.trim().length > 0,
          ),
  };
}

function validateLineup(
  rows: readonly (ManagedLineupRow | ExternalLineupRow)[],
  prefix: string,
): SetupFieldError[] {
  const errors: SetupFieldError[] = [];
  if (
    rows.some((row) => row.kind === "MANAGED" && row.selected && !row.eligible)
  ) {
    errors.push({
      field: prefix,
      message: "A selected player is no longer eligible.",
    });
  }
  const batting = rows.filter(({ battingOrder }) => battingOrder !== null);
  if (batting.length === 0) {
    errors.push({
      field: prefix,
      message: "Add at least one active batter.",
    });
  }
  const orders = batting.map(({ battingOrder }) => battingOrder);
  if (new Set(orders).size !== orders.length) {
    errors.push({
      field: prefix,
      message: "Batting-order numbers must be unique.",
    });
  }
  const ordered = orders
    .filter((order): order is number => order !== null)
    .sort((left, right) => left - right);
  if (ordered.some((order, index) => order !== index + 1)) {
    errors.push({
      field: prefix,
      message: "Batting order must be contiguous starting at 1.",
    });
  }
  const pitchers = rows.filter(({ isStartingPitcher }) => isStartingPitcher);
  if (pitchers.length !== 1) {
    errors.push({
      field: prefix,
      message: "Choose exactly one starting pitcher.",
    });
  }
  if (
    pitchers.some(({ defensivePosition }) => defensivePosition !== "PITCHER")
  ) {
    errors.push({
      field: prefix,
      message: "The starting pitcher must be assigned to pitcher.",
    });
  }
  const conventionalPositions = rows
    .map(({ defensivePosition }) => defensivePosition)
    .filter(
      (position) =>
        position !== null &&
        position !== "DESIGNATED_HITTER" &&
        position !== "EXTRA_HITTER",
    );
  if (new Set(conventionalPositions).size !== conventionalPositions.length) {
    errors.push({
      field: prefix,
      message: "Conventional defensive positions must be unique.",
    });
  }
  return errors;
}

export function validateSetupDraft(
  draft: SetupWorkflowDraft,
  options: { requireReady: boolean },
): SetupFieldError[] {
  const errors: SetupFieldError[] = [];
  if (scheduledAtIso(draft.scheduledAt) === null) {
    errors.push({ field: "scheduledAt", message: "Enter a valid game date." });
  }
  if (draft.location.length > 120) {
    errors.push({
      field: "location",
      message: "Location must be 120 characters or fewer.",
    });
  }
  if (!options.requireReady) return errors;
  if (
    draft.opponentKind === "MANAGED" &&
    (!draft.opponentTeamSeasonId ||
      draft.opponentTeamSeasonId === draft.managedTeamSeasonId)
  ) {
    errors.push({
      field: "opponentTeamSeasonId",
      message: "Choose a different managed opponent.",
    });
  }
  if (
    draft.opponentKind === "EXTERNAL" &&
    draft.externalOpponentName.trim().length === 0
  ) {
    errors.push({
      field: "externalOpponentName",
      message: "Enter an opponent name.",
    });
  }
  const lineups = lineupsForValidation(draft);
  errors.push(...validateLineup(lineups.managed, "managedLineup"));
  errors.push(...validateLineup(lineups.opponent, "opponentLineup"));
  return errors;
}

export function parseSetupWorkflowDraft(value: unknown): SetupWorkflowDraft {
  return setupWorkflowDraftSchema.parse(value);
}

export function buildSaveSetupCommand(
  draft: SetupWorkflowDraft,
): SaveSetupRevisionCommand {
  const timestamp = scheduledAtIso(draft.scheduledAt);
  if (!timestamp) throw new Error("INVALID_SCHEDULED_AT");
  const sides: SaveSetupRevisionCommand["sides"] = [
    {
      kind: "MANAGED",
      side: draft.managedSide,
      teamSeasonId: draft.managedTeamSeasonId,
      lineup: selectedManagedRows(draft.managedLineup),
    },
  ];
  const opponentSide = oppositeSide(draft.managedSide);
  if (
    draft.opponentKind === "MANAGED" &&
    draft.opponentTeamSeasonId &&
    draft.opponentTeamSeasonId !== draft.managedTeamSeasonId
  ) {
    sides.push({
      kind: "MANAGED",
      side: opponentSide,
      teamSeasonId: draft.opponentTeamSeasonId,
      lineup: selectedManagedRows(draft.opponentManagedLineup),
    });
  } else if (
    draft.opponentKind === "EXTERNAL" &&
    draft.externalOpponentName.trim().length > 0
  ) {
    sides.push({
      kind: "EXTERNAL",
      side: opponentSide,
      displayName: draft.externalOpponentName,
      lineup: externalRows(draft.externalLineup),
    });
  }
  return {
    accountId: draft.accountId,
    gameId: draft.gameId,
    expectedSetupRevision: draft.expectedSetupRevision,
    clientSubmissionId: draft.clientSubmissionId,
    rulesetVersionId: draft.rulesetVersionId,
    scheduledAt: timestamp,
    location: draft.location.trim().length > 0 ? draft.location : null,
    weatherCondition: draft.weatherCondition,
    temperatureF: draft.temperatureF,
    sides,
  };
}

export function firstStepForErrors(
  errors: readonly SetupFieldError[],
): SetupStep {
  const fields = new Set(errors.map(({ field }) => field));
  if (fields.has("scheduledAt") || fields.has("location")) {
    return "GAME_DETAILS";
  }
  if (
    fields.has("opponentTeamSeasonId") ||
    fields.has("externalOpponentName")
  ) {
    return "PARTICIPANTS";
  }
  return errors.length > 0 ? "LINEUP" : "REVIEW";
}
