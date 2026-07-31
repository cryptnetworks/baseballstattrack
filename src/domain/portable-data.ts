import { createHash } from "node:crypto";

import { z } from "zod";

import {
  canonicalJson,
  deriveEventStates,
  parseEvent,
  replayGame,
  stateHash,
  type AcceptedEvent,
  type AcceptedSetup,
} from "@/domain/events/event-log";
import {
  deriveGameStatistics,
  type GameStatisticsProjection,
} from "@/domain/statistics";

export const PORTABLE_DATA_FORMAT = "baseballstattrack.account-export";
export const PORTABLE_DATA_VERSION = 2;
const SUPPORTED_PORTABLE_DATA_VERSIONS = [1, PORTABLE_DATA_VERSION] as const;
export const MAX_PORTABLE_BYTES = 5 * 1024 * 1024;
export const MAX_PORTABLE_RECORDS = 10_000;
const PORTABLE_LOGICAL_ACCOUNT = "portable-logical-account";
const INCLUDED_ENTITY_TYPES = [
  "teams",
  "seasons",
  "teamSeasons",
  "players",
  "rosters",
  "rulesets",
  "games",
  "setupSnapshots",
  "events",
  "corrections",
  "derivedGameSummaries",
] as const;

const portableId = z.string().trim().min(1).max(128);
const displayName = z.string().trim().min(1).max(200);
const nullableDateTime = z.iso.datetime({ offset: true }).nullable();

const teamSchema = z
  .object({
    id: portableId,
    displayName,
    status: z.string().min(1).max(40),
    archived: z.boolean(),
  })
  .strict();
const seasonSchema = z
  .object({
    id: portableId,
    displayName,
    startsOn: z.string().nullable(),
    endsOn: z.string().nullable(),
    status: z.string().min(1).max(40),
    archived: z.boolean(),
  })
  .strict();
const teamSeasonSchema = z
  .object({
    id: portableId,
    teamId: portableId,
    seasonId: portableId,
    archived: z.boolean(),
  })
  .strict();
const playerSchema = z
  .object({
    id: portableId,
    displayName,
    battingSide: z.string().nullable(),
    throwingHand: z.string().nullable(),
    archived: z.boolean(),
  })
  .strict();
const rosterSchema = z
  .object({
    id: portableId,
    playerId: portableId,
    teamSeasonId: portableId,
    jerseyNumber: z.string().max(20).nullable(),
    primaryPosition: z.string().nullable(),
    status: z.string().min(1).max(40),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: nullableDateTime,
    archived: z.boolean(),
  })
  .strict();
const rulesetSchema = z
  .object({
    id: portableId,
    name: displayName,
    version: z.number().int().positive(),
    configuration: z
      .object({
        scheduledInnings: z.number().int().min(1).max(20),
        maximumLineupSize: z.number().int().min(1).max(30),
        allowDefensiveOnly: z.boolean(),
      })
      .strict(),
    status: z.string().min(1).max(40),
  })
  .strict();
const lineupSchema = z
  .object({
    playerId: portableId,
    battingOrder: z.number().int().positive().nullable(),
    position: z.string().nullable(),
    active: z.boolean(),
  })
  .strict();
const setupSchema = z
  .object({
    id: portableId,
    gameId: portableId,
    setupRevision: z.number().int().positive(),
    rulesetVersionId: portableId,
    scheduledInnings: z.number().int().min(1).max(30),
    status: z.literal("READY"),
    sides: z
      .object({
        AWAY: z
          .object({
            lineup: z.array(lineupSchema).min(1).max(40),
            startingPitcherId: portableId,
          })
          .strict(),
        HOME: z
          .object({
            lineup: z.array(lineupSchema).min(1).max(40),
            startingPitcherId: portableId,
          })
          .strict(),
      })
      .strict(),
  })
  .strict();
const presentationSchema = z
  .object({
    teams: z
      .object({
        AWAY: displayName,
        HOME: displayName,
      })
      .strict(),
    players: z.record(portableId, displayName),
    privacyOverlayRevision: z.number().int().nonnegative(),
  })
  .strict();
export type PortableGameSummary = ReturnType<typeof portableGameSummary>;
const summarySchema = z.custom<PortableGameSummary>(
  (value) => typeof value === "object" && value !== null,
);
const gameSchema = z
  .object({
    id: portableId,
    seasonId: portableId,
    teamSeasonId: portableId,
    scheduledAt: nullableDateTime,
    status: z.string().min(1).max(40),
    sourceRevision: z.number().int().nonnegative(),
    history: z
      .object({
        setup: setupSchema,
        events: z.array(z.unknown()).max(MAX_PORTABLE_RECORDS),
        presentation: presentationSchema,
        summary: summarySchema,
      })
      .strict()
      .nullable(),
  })
  .strict();

const dataSchema = z
  .object({
    teams: z.array(teamSchema),
    seasons: z.array(seasonSchema),
    teamSeasons: z.array(teamSeasonSchema),
    players: z.array(playerSchema),
    rosters: z.array(rosterSchema),
    rulesets: z.array(rulesetSchema),
    games: z.array(gameSchema),
  })
  .strict();

const manifestSchema = z
  .object({
    format: z.literal(PORTABLE_DATA_FORMAT),
    version: z.union([z.literal(1), z.literal(PORTABLE_DATA_VERSION)]),
    encoding: z.literal("utf-8"),
    exportedAt: z.iso.datetime({ offset: true }),
    logicalAccount: z.literal("current-authorized-account"),
    includedEntityTypes: z.array(z.string()).min(1),
    counts: z.record(z.string(), z.number().int().nonnegative()),
    checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    checksumPurpose: z.literal("accidental-corruption-detection"),
  })
  .strict();

const documentSchema = z
  .object({
    manifest: manifestSchema,
    data: dataSchema,
  })
  .strict();

export type PortableData = z.infer<typeof dataSchema>;
export type PortableDataDocument = z.infer<typeof documentSchema>;
export type PortableSetup = z.infer<typeof setupSchema>;

export type PortableValidationErrorCode =
  | "INVALID_ENCODING"
  | "OVERSIZED_FILE"
  | "MALFORMED_DOCUMENT"
  | "UNSUPPORTED_VERSION"
  | "CHECKSUM_MISMATCH"
  | "RECORD_LIMIT"
  | "DUPLICATE_ID"
  | "ROSTER_CONFLICT"
  | "OWNERSHIP_VIOLATION"
  | "REFERENCE_MISSING"
  | "EXISTING_RECORD_CONFLICT"
  | "EVENT_INTEGRITY"
  | "SUMMARY_MISMATCH";

export class PortableDataError extends Error {
  constructor(
    readonly code: PortableValidationErrorCode,
    message: string,
    readonly location: Readonly<{
      section?: string;
      recordId?: string;
      field?: string;
    }> = {},
  ) {
    super(message);
    this.name = "PortableDataError";
  }
}

function checksum(data: PortableData): string {
  return `sha256:${createHash("sha256").update(canonicalJson(data)).digest("hex")}`;
}

function sorted<T extends { id: string }>(values: readonly T[]): T[] {
  return [...values].sort((left, right) => left.id.localeCompare(right.id));
}

function normalizedData(data: PortableData): PortableData {
  return {
    teams: sorted(data.teams),
    seasons: sorted(data.seasons),
    teamSeasons: sorted(data.teamSeasons),
    players: sorted(data.players),
    rosters: sorted(data.rosters),
    rulesets: sorted(data.rulesets),
    games: sorted(data.games).map((game) => ({
      ...game,
      history: game.history
        ? {
            ...game.history,
            events: [...game.history.events].sort((left, right) => {
              const leftSequence =
                typeof left === "object" &&
                left !== null &&
                "sequence" in left &&
                typeof left.sequence === "number"
                  ? left.sequence
                  : Number.MAX_SAFE_INTEGER;
              const rightSequence =
                typeof right === "object" &&
                right !== null &&
                "sequence" in right &&
                typeof right.sequence === "number"
                  ? right.sequence
                  : Number.MAX_SAFE_INTEGER;
              return leftSequence - rightSequence;
            }),
          }
        : null,
    })),
  };
}

function countRecords(data: PortableData): number {
  return (
    data.teams.length +
    data.seasons.length +
    data.teamSeasons.length +
    data.players.length +
    data.rosters.length +
    data.rulesets.length +
    data.games.length +
    data.games.reduce(
      (total, game) => total + (game.history?.events.length ?? 0),
      0,
    )
  );
}

function counts(data: PortableData): Record<string, number> {
  return {
    teams: data.teams.length,
    seasons: data.seasons.length,
    teamSeasons: data.teamSeasons.length,
    players: data.players.length,
    rosters: data.rosters.length,
    rulesets: data.rulesets.length,
    games: data.games.length,
    setupSnapshots: data.games.filter(({ history }) => history !== null).length,
    events: data.games.reduce(
      (total, game) => total + (game.history?.events.length ?? 0),
      0,
    ),
    corrections: data.games.reduce(
      (total, game) =>
        total +
        (game.history?.events.filter(
          (event) =>
            typeof event === "object" &&
            event !== null &&
            "eventType" in event &&
            event.eventType === "CorrectionApplied",
        ).length ?? 0),
      0,
    ),
  };
}

export function portableGameSummary(projection: GameStatisticsProjection) {
  const confidence =
    projection.metadata.verificationStatus === "VERIFIED"
      ? "VERIFIED"
      : ["READY", "IN_PROGRESS", "SUSPENDED"].includes(
            projection.metadata.lifecycleStatus,
          )
        ? "INCOMPLETE"
        : projection.metadata.lifecycleStatus === "CORRECTED"
          ? "CORRECTED"
          : "CURRENT";
  return {
    confidence,
    sourceRevision: projection.metadata.sourceRevision,
    derivationVersion: projection.metadata.derivationVersion,
    statisticRulesVersion: projection.metadata.statisticRulesVersion,
    lifecycleStatus: projection.metadata.lifecycleStatus,
    verificationStatus: projection.metadata.verificationStatus,
    outcome: projection.outcome,
    finalScore: projection.finalScore,
    batting: projection.batting,
    pitching: projection.pitching,
    fielding: projection.fielding,
    teams: projection.teams,
  };
}

export function normalizePortableHistory(
  sourceSetup: AcceptedSetup,
  sourceEvents: readonly AcceptedEvent[],
): {
  setup: PortableSetup;
  events: unknown[];
  acceptedSetup: AcceptedSetup;
  acceptedEvents: AcceptedEvent[];
} {
  const acceptedSetup: AcceptedSetup = {
    ...sourceSetup,
    accountId: PORTABLE_LOGICAL_ACCOUNT,
    sides: {
      AWAY: {
        ...sourceSetup.sides.AWAY,
        lineup: [...sourceSetup.sides.AWAY.lineup],
      },
      HOME: {
        ...sourceSetup.sides.HOME,
        lineup: [...sourceSetup.sides.HOME.lineup],
      },
    },
  };
  const acceptedEvents: AcceptedEvent[] = [];
  for (const sourceEvent of [...sourceEvents].sort(
    (left, right) => left.sequence - right.sequence,
  )) {
    const proposed = {
      ...sourceEvent,
      accountId: PORTABLE_LOGICAL_ACCOUNT,
    };
    const states = deriveEventStates(acceptedSetup, acceptedEvents, proposed);
    acceptedEvents.push({
      ...proposed,
      preStateHash: stateHash(states.before),
      postStateHash: stateHash(states.after),
    });
  }
  const setup: PortableSetup = {
    id: acceptedSetup.id,
    gameId: acceptedSetup.gameId,
    setupRevision: acceptedSetup.setupRevision,
    rulesetVersionId: acceptedSetup.rulesetVersionId,
    scheduledInnings: acceptedSetup.scheduledInnings,
    status: acceptedSetup.status,
    sides: {
      AWAY: {
        ...acceptedSetup.sides.AWAY,
        lineup: [...acceptedSetup.sides.AWAY.lineup],
      },
      HOME: {
        ...acceptedSetup.sides.HOME,
        lineup: [...acceptedSetup.sides.HOME.lineup],
      },
    },
  };
  return {
    setup: {
      ...setup,
      sides: {
        AWAY: {
          ...setup.sides.AWAY,
          lineup: [...setup.sides.AWAY.lineup],
        },
        HOME: {
          ...setup.sides.HOME,
          lineup: [...setup.sides.HOME.lineup],
        },
      },
    },
    events: acceptedEvents.map((event) => {
      const excluded = new Set([
        "accountId",
        "actor",
        "playTransactionId",
        "componentOrder",
        "clientSubmissionId",
      ]);
      return Object.fromEntries(
        Object.entries(event).filter(([key]) => !excluded.has(key)),
      );
    }),
    acceptedSetup,
    acceptedEvents,
  };
}

export function createPortableDataDocument(input: {
  exportedAt: string;
  data: PortableData;
}): PortableDataDocument {
  if (Number.isNaN(Date.parse(input.exportedAt))) {
    throw new PortableDataError(
      "MALFORMED_DOCUMENT",
      "Export timestamp is invalid.",
      { field: "exportedAt" },
    );
  }
  const data = dataSchema.parse(normalizedData(input.data));
  if (countRecords(data) > MAX_PORTABLE_RECORDS) {
    throw new PortableDataError(
      "RECORD_LIMIT",
      "Export record limit exceeded.",
    );
  }
  return {
    manifest: {
      format: PORTABLE_DATA_FORMAT,
      version: PORTABLE_DATA_VERSION,
      encoding: "utf-8",
      exportedAt: input.exportedAt,
      logicalAccount: "current-authorized-account",
      includedEntityTypes: [...INCLUDED_ENTITY_TYPES],
      counts: counts(data),
      checksum: checksum(data),
      checksumPurpose: "accidental-corruption-detection",
    },
    data,
  };
}

function decode(input: Uint8Array): string {
  if (input.byteLength > MAX_PORTABLE_BYTES) {
    throw new PortableDataError("OVERSIZED_FILE", "Import file is too large.");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(input);
  } catch {
    throw new PortableDataError(
      "INVALID_ENCODING",
      "Import file must be valid UTF-8.",
    );
  }
}

function unsafeKey(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = unsafeKey(child);
      if (found) return found;
    }
    return null;
  }
  if (value === null || typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value)) {
    if (
      /^(accountId|actorId|actorUserId|membershipId|email|token|session|password|databaseUrl|audit)$/iu.test(
        key,
      )
    ) {
      return key;
    }
    const found = unsafeKey(child);
    if (found) return found;
  }
  return null;
}

function unique(section: string, ids: readonly string[]): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      throw new PortableDataError("DUPLICATE_ID", "Duplicate logical ID.", {
        section,
        recordId: id,
      });
    }
    seen.add(id);
  }
}

function requireReference(
  section: string,
  recordId: string,
  field: string,
  id: string,
  available: ReadonlySet<string>,
): void {
  if (!available.has(id)) {
    throw new PortableDataError(
      "REFERENCE_MISSING",
      "A required logical reference is unavailable.",
      { section, recordId, field },
    );
  }
}

export type PortableImportPlan = {
  mode: "DRY_RUN_ONLY";
  targetAccountId: string;
  documentChecksum: string;
  counts: Record<string, number>;
  gamesReplayed: number;
  summariesMatched: number;
  conflicts: [];
  mutationCount: 0;
  confirmationRequiredBeforeFutureCommit: true;
};

export function validatePortableImport(input: {
  bytes: Uint8Array;
  targetAccountId: string;
  existingLogicalIds?: ReadonlySet<string>;
}): PortableImportPlan {
  let raw: unknown;
  try {
    raw = JSON.parse(decode(input.bytes));
  } catch (error) {
    if (error instanceof PortableDataError) throw error;
    throw new PortableDataError(
      "MALFORMED_DOCUMENT",
      "Import document is not valid JSON.",
    );
  }
  if (
    typeof raw === "object" &&
    raw !== null &&
    "manifest" in raw &&
    typeof raw.manifest === "object" &&
    raw.manifest !== null &&
    "version" in raw.manifest &&
    !SUPPORTED_PORTABLE_DATA_VERSIONS.includes(
      raw.manifest.version as (typeof SUPPORTED_PORTABLE_DATA_VERSIONS)[number],
    )
  ) {
    throw new PortableDataError(
      "UNSUPPORTED_VERSION",
      "Import format version is unsupported.",
      { field: "manifest.version" },
    );
  }
  const unsafe = unsafeKey(raw);
  if (unsafe) {
    throw new PortableDataError(
      "OWNERSHIP_VIOLATION",
      "Import contains a prohibited ownership or sensitive field.",
      { field: unsafe },
    );
  }
  const parsed = documentSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PortableDataError(
      "MALFORMED_DOCUMENT",
      "Import document schema is invalid.",
    );
  }
  const document = parsed.data;
  if (checksum(document.data) !== document.manifest.checksum) {
    throw new PortableDataError(
      "CHECKSUM_MISMATCH",
      "Import checksum does not match the document.",
    );
  }
  if (
    canonicalJson(document.manifest.counts) !==
      canonicalJson(counts(document.data)) ||
    canonicalJson(document.manifest.includedEntityTypes) !==
      canonicalJson(INCLUDED_ENTITY_TYPES)
  ) {
    throw new PortableDataError(
      "MALFORMED_DOCUMENT",
      "Import manifest declarations do not match the data.",
      { section: "manifest" },
    );
  }
  if (countRecords(document.data) > MAX_PORTABLE_RECORDS) {
    throw new PortableDataError(
      "RECORD_LIMIT",
      "Import record limit exceeded.",
    );
  }

  const sections = [
    ["teams", document.data.teams],
    ["seasons", document.data.seasons],
    ["teamSeasons", document.data.teamSeasons],
    ["players", document.data.players],
    ["rosters", document.data.rosters],
    ["rulesets", document.data.rulesets],
    ["games", document.data.games],
  ] as const;
  for (const [section, records] of sections) {
    unique(
      section,
      records.map(({ id }) => id),
    );
  }
  const allIds = sections.flatMap(([, records]) => records.map(({ id }) => id));
  unique("document", allIds);
  for (const id of allIds) {
    if (input.existingLogicalIds?.has(id)) {
      throw new PortableDataError(
        "EXISTING_RECORD_CONFLICT",
        "A target record already uses this logical ID.",
        { recordId: id },
      );
    }
  }

  const teamIds = new Set(document.data.teams.map(({ id }) => id));
  const seasonIds = new Set(document.data.seasons.map(({ id }) => id));
  const teamSeasonIds = new Set(document.data.teamSeasons.map(({ id }) => id));
  const playerIds = new Set(document.data.players.map(({ id }) => id));
  const rulesetIds = new Set(document.data.rulesets.map(({ id }) => id));
  for (const teamSeason of document.data.teamSeasons) {
    requireReference(
      "teamSeasons",
      teamSeason.id,
      "teamId",
      teamSeason.teamId,
      teamIds,
    );
    requireReference(
      "teamSeasons",
      teamSeason.id,
      "seasonId",
      teamSeason.seasonId,
      seasonIds,
    );
  }
  for (const roster of document.data.rosters) {
    requireReference(
      "rosters",
      roster.id,
      "playerId",
      roster.playerId,
      playerIds,
    );
    requireReference(
      "rosters",
      roster.id,
      "teamSeasonId",
      roster.teamSeasonId,
      teamSeasonIds,
    );
  }
  const rosterGroups = new Map<string, typeof document.data.rosters>();
  for (const roster of document.data.rosters) {
    const key = `${roster.playerId}:${roster.teamSeasonId}`;
    rosterGroups.set(key, [...(rosterGroups.get(key) ?? []), roster]);
  }
  for (const rosters of rosterGroups.values()) {
    const ordered = [...rosters].sort(
      (left, right) =>
        Date.parse(left.startsAt) - Date.parse(right.startsAt) ||
        left.id.localeCompare(right.id),
    );
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1]!;
      const current = ordered[index]!;
      if (
        previous.endsAt === null ||
        Date.parse(previous.endsAt) > Date.parse(current.startsAt)
      ) {
        throw new PortableDataError(
          "ROSTER_CONFLICT",
          "Roster effective periods overlap.",
          { section: "rosters", recordId: current.id },
        );
      }
    }
  }

  let gamesReplayed = 0;
  let summariesMatched = 0;
  const eventIds: string[] = [];
  for (const game of document.data.games) {
    requireReference("games", game.id, "seasonId", game.seasonId, seasonIds);
    requireReference(
      "games",
      game.id,
      "teamSeasonId",
      game.teamSeasonId,
      teamSeasonIds,
    );
    const teamSeason = document.data.teamSeasons.find(
      ({ id }) => id === game.teamSeasonId,
    )!;
    if (teamSeason.seasonId !== game.seasonId) {
      throw new PortableDataError(
        "REFERENCE_MISSING",
        "Game team-season does not belong to the game season.",
        { section: "games", recordId: game.id, field: "teamSeasonId" },
      );
    }
    if (!game.history) continue;
    const setup = {
      ...game.history.setup,
      accountId: PORTABLE_LOGICAL_ACCOUNT,
    } as AcceptedSetup;
    if (setup.gameId !== game.id || !rulesetIds.has(setup.rulesetVersionId)) {
      throw new PortableDataError(
        "REFERENCE_MISSING",
        "Game setup references are invalid.",
        { section: "games", recordId: game.id, field: "history.setup" },
      );
    }
    let events: AcceptedEvent[];
    try {
      events = game.history.events.map((event) => {
        const accepted = parseEvent({
          ...(event as object),
          accountId: PORTABLE_LOGICAL_ACCOUNT,
          playTransactionId: null,
          componentOrder: null,
          clientSubmissionId: `portable-event-${String(
            (event as { sequence?: unknown }).sequence,
          )}`,
          actor: {
            kind: "SYSTEM",
            id: "portable-history",
            userId: null,
          },
        });
        if (accepted.gameId !== game.id) {
          throw new Error("event game mismatch");
        }
        eventIds.push(accepted.id);
        return accepted;
      });
      replayGame(setup, events, { verifyEvidence: true });
    } catch {
      throw new PortableDataError(
        "EVENT_INTEGRITY",
        "Game event history failed deterministic validation.",
        { section: "games", recordId: game.id, field: "history.events" },
      );
    }
    const derived = portableGameSummary(
      deriveGameStatistics({
        setup,
        events,
        privacyOverlayRevision:
          game.history.presentation.privacyOverlayRevision,
      }),
    );
    if (
      game.status !== derived.lifecycleStatus ||
      game.sourceRevision !== derived.sourceRevision
    ) {
      throw new PortableDataError(
        "SUMMARY_MISMATCH",
        "Game lifecycle or source revision does not match replay.",
        { section: "games", recordId: game.id, field: "status" },
      );
    }
    const comparableDerived =
      document.manifest.version === 1
        ? (({ confidence: _confidence, ...legacy }) => {
            void _confidence;
            return legacy;
          })(derived)
        : derived;
    if (
      canonicalJson(comparableDerived) !== canonicalJson(game.history.summary)
    ) {
      throw new PortableDataError(
        "SUMMARY_MISMATCH",
        "Derived game summary does not match replay.",
        { section: "games", recordId: game.id, field: "history.summary" },
      );
    }
    gamesReplayed += 1;
    summariesMatched += 1;
  }
  unique("events", eventIds);

  return {
    mode: "DRY_RUN_ONLY",
    targetAccountId: input.targetAccountId,
    documentChecksum: document.manifest.checksum,
    counts: document.manifest.counts,
    gamesReplayed,
    summariesMatched,
    conflicts: [],
    mutationCount: 0,
    confirmationRequiredBeforeFutureCommit: true,
  };
}

export function encodePortableDocument(
  document: PortableDataDocument,
): Uint8Array {
  return new TextEncoder().encode(`${canonicalJson(document)}\n`);
}

export function neutralizeSpreadsheetCell(value: string): string {
  const normalized = value.replace(/^[\u0000-\u001f]+/u, "");
  return /^[=+\-@]/u.test(normalized) ? `'${value}` : value;
}
