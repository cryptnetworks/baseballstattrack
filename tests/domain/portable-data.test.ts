import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { canonicalJson } from "@/domain/events/event-log";

import {
  MAX_PORTABLE_BYTES,
  PORTABLE_DATA_FORMAT,
  PORTABLE_DATA_VERSION,
  PortableDataError,
  createPortableDataDocument,
  encodePortableDocument,
  neutralizeSpreadsheetCell,
  normalizePortableHistory,
  portableGameSummary,
  validatePortableImport,
  type PortableData,
} from "@/domain/portable-data";
import { deriveGameStatistics } from "@/domain/statistics";
import { ScoringFixtureBuilder } from "../fixtures/scoring-fixture-builder";

function fixtureData(): PortableData {
  const builder = new ScoringFixtureBuilder();
  builder.start();
  const history = normalizePortableHistory(builder.setup, builder.events());
  const projection = deriveGameStatistics({
    setup: history.acceptedSetup,
    events: history.acceptedEvents,
    privacyOverlayRevision: 3,
  });
  return {
    teams: [
      {
        id: "team-1",
        displayName: "Privacy-safe Stars",
        status: "ACTIVE",
        archived: false,
      },
    ],
    seasons: [
      {
        id: "season-1",
        displayName: "Summer 2026",
        startsOn: "2026-04-01",
        endsOn: "2026-08-31",
        status: "ACTIVE",
        archived: false,
      },
    ],
    teamSeasons: [
      {
        id: "team-season-1",
        teamId: "team-1",
        seasonId: "season-1",
        archived: false,
      },
    ],
    players: [
      {
        id: "portable-player-1",
        displayName: "Privacy-safe Player",
        battingSide: "RIGHT",
        throwingHand: "RIGHT",
        archived: false,
      },
    ],
    rosters: [
      {
        id: "roster-1",
        playerId: "portable-player-1",
        teamSeasonId: "team-season-1",
        jerseyNumber: "7",
        primaryPosition: "SHORTSTOP",
        status: "ACTIVE",
        startsAt: "2026-04-01T00:00:00.000Z",
        endsAt: null,
        archived: false,
      },
    ],
    rulesets: [
      {
        id: builder.setup.rulesetVersionId,
        name: "Standard",
        version: 1,
        configuration: {
          scheduledInnings: 9,
          maximumLineupSize: 30,
          allowDefensiveOnly: true,
        },
        status: "ACTIVE",
      },
    ],
    games: [
      {
        id: builder.setup.gameId,
        seasonId: "season-1",
        teamSeasonId: "team-season-1",
        scheduledAt: "2026-07-01T12:00:00.000Z",
        status: projection.metadata.lifecycleStatus,
        sourceRevision: projection.metadata.sourceRevision,
        history: {
          setup: history.setup,
          events: history.events,
          presentation: {
            teams: { AWAY: "Visitors", HOME: "Hosts" },
            players: { "portable-player-1": "Privacy-safe Player" },
            privacyOverlayRevision: 3,
          },
          summary: portableGameSummary(projection),
        },
      },
    ],
  };
}

function document(data = fixtureData()) {
  return createPortableDataDocument({
    exportedAt: "2026-07-30T20:00:00.000Z",
    data,
  });
}

function validate(data = fixtureData(), existingLogicalIds?: Set<string>) {
  return validatePortableImport({
    bytes: encodePortableDocument(document(data)),
    targetAccountId: "target-account",
    ...(existingLogicalIds === undefined ? {} : { existingLogicalIds }),
  });
}

describe("portable data export and import validation", () => {
  it("creates a deterministic versioned manifest and proves the round trip", () => {
    const first = document();
    const reordered = fixtureData();
    reordered.teams.reverse();
    reordered.games.reverse();
    const second = document(reordered);
    expect(first.manifest).toMatchObject({
      format: PORTABLE_DATA_FORMAT,
      version: PORTABLE_DATA_VERSION,
      encoding: "utf-8",
      checksumPurpose: "accidental-corruption-detection",
    });
    expect(first.manifest.checksum).toBe(second.manifest.checksum);
    expect(first.manifest.counts).toMatchObject({
      teams: 1,
      seasons: 1,
      players: 1,
      games: 1,
      setupSnapshots: 1,
      events: 1,
      corrections: 0,
    });

    const plan = validate();
    expect(plan).toMatchObject({
      mode: "DRY_RUN_ONLY",
      targetAccountId: "target-account",
      gamesReplayed: 1,
      summariesMatched: 1,
      mutationCount: 0,
      confirmationRequiredBeforeFutureCommit: true,
    });
    expect(plan.documentChecksum).toBe(first.manifest.checksum);
    expect(validate().documentChecksum).toBe(plan.documentChecksum);

    const legacy = structuredClone(first) as unknown as {
      manifest: { version: number; checksum: string };
      data: ReturnType<typeof fixtureData>;
    };
    legacy.manifest.version = 1;
    for (const game of legacy.data.games) {
      if (game.history) {
        delete (game.history.summary as { confidence?: string }).confidence;
      }
    }
    legacy.manifest.checksum = `sha256:${createHash("sha256")
      .update(canonicalJson(legacy.data))
      .digest("hex")}`;
    expect(
      validatePortableImport({
        bytes: new TextEncoder().encode(JSON.stringify(legacy)),
        targetAccountId: "legacy-target",
      }),
    ).toMatchObject({ gamesReplayed: 1, summariesMatched: 1 });
  });

  it("rejects unsupported, malformed, corrupt, oversized, and invalid UTF-8 input", () => {
    const unsupported = document() as unknown as {
      manifest: { version: number };
    };
    unsupported.manifest.version = 99;
    expect(() =>
      validatePortableImport({
        bytes: new TextEncoder().encode(JSON.stringify(unsupported)),
        targetAccountId: "target",
      }),
    ).toThrowError(
      expect.objectContaining<Partial<PortableDataError>>({
        code: "UNSUPPORTED_VERSION",
      }),
    );
    expect(() =>
      validatePortableImport({
        bytes: new TextEncoder().encode("{"),
        targetAccountId: "target",
      }),
    ).toThrowError(
      expect.objectContaining<Partial<PortableDataError>>({
        code: "MALFORMED_DOCUMENT",
      }),
    );
    const corrupt = document();
    corrupt.data.teams[0]!.displayName = "Changed after checksum";
    expect(() =>
      validatePortableImport({
        bytes: new TextEncoder().encode(JSON.stringify(corrupt)),
        targetAccountId: "target",
      }),
    ).toThrowError(
      expect.objectContaining<Partial<PortableDataError>>({
        code: "CHECKSUM_MISMATCH",
      }),
    );
    const declarations = document();
    declarations.manifest.counts.games = 99;
    expect(() =>
      validatePortableImport({
        bytes: new TextEncoder().encode(JSON.stringify(declarations)),
        targetAccountId: "target",
      }),
    ).toThrowError(
      expect.objectContaining<Partial<PortableDataError>>({
        code: "MALFORMED_DOCUMENT",
      }),
    );
    expect(() =>
      validatePortableImport({
        bytes: new Uint8Array(MAX_PORTABLE_BYTES + 1),
        targetAccountId: "target",
      }),
    ).toThrowError(
      expect.objectContaining<Partial<PortableDataError>>({
        code: "OVERSIZED_FILE",
      }),
    );
    expect(() =>
      validatePortableImport({
        bytes: new Uint8Array([0xc3, 0x28]),
        targetAccountId: "target",
      }),
    ).toThrowError(
      expect.objectContaining<Partial<PortableDataError>>({
        code: "INVALID_ENCODING",
      }),
    );
  });

  it("rejects ownership fields, duplicates, conflicts, broken references, replay, and summary drift", () => {
    const ownership = document() as unknown as Record<string, unknown>;
    ownership.accountId = "foreign";
    expect(() =>
      validatePortableImport({
        bytes: new TextEncoder().encode(JSON.stringify(ownership)),
        targetAccountId: "target",
      }),
    ).toThrowError(
      expect.objectContaining<Partial<PortableDataError>>({
        code: "OWNERSHIP_VIOLATION",
      }),
    );

    const duplicate = fixtureData();
    duplicate.teams.push({ ...duplicate.teams[0]! });
    expect(() => validate(duplicate)).toThrowError(
      expect.objectContaining<Partial<PortableDataError>>({
        code: "DUPLICATE_ID",
      }),
    );
    expect(() => validate(fixtureData(), new Set(["team-1"]))).toThrowError(
      expect.objectContaining<Partial<PortableDataError>>({
        code: "EXISTING_RECORD_CONFLICT",
      }),
    );
    const reference = fixtureData();
    reference.rosters[0]!.playerId = "missing";
    expect(() => validate(reference)).toThrowError(
      expect.objectContaining<Partial<PortableDataError>>({
        code: "REFERENCE_MISSING",
      }),
    );
    const rosterConflict = fixtureData();
    rosterConflict.rosters.push({
      ...rosterConflict.rosters[0]!,
      id: "roster-overlap",
      startsAt: "2026-05-01T00:00:00.000Z",
    });
    expect(() => validate(rosterConflict)).toThrowError(
      expect.objectContaining<Partial<PortableDataError>>({
        code: "ROSTER_CONFLICT",
      }),
    );
    const replay = fixtureData();
    const firstEvent = replay.games[0]!.history!.events[0] as {
      sequence: number;
    };
    firstEvent.sequence = 4;
    expect(() => validate(replay)).toThrowError(
      expect.objectContaining<Partial<PortableDataError>>({
        code: "EVENT_INTEGRITY",
      }),
    );
    const summary = fixtureData();
    (
      summary.games[0]!.history!.summary as {
        finalScore: { AWAY: number };
      }
    ).finalScore.AWAY = 99;
    expect(() => validate(summary)).toThrowError(
      expect.objectContaining<Partial<PortableDataError>>({
        code: "SUMMARY_MISMATCH",
      }),
    );
  });

  it("neutralizes spreadsheet-compatible dangerous prefixes", () => {
    for (const value of [
      "=1+1",
      "+SUM(A1:A2)",
      "-2+3",
      "@command",
      "\t=hidden",
      "\u0001+hidden",
    ]) {
      expect(neutralizeSpreadsheetCell(value)).toBe(`'${value}`);
    }
    expect(neutralizeSpreadsheetCell("ordinary")).toBe("ordinary");
    expect(neutralizeSpreadsheetCell("  =not-leading")).toBe("  =not-leading");
  });

  it("contains no forbidden secret or Account ownership fields", () => {
    const serialized = new TextDecoder().decode(
      encodePortableDocument(document()),
    );
    expect(serialized).not.toMatch(
      /accountId|actorId|membershipId|clientSubmissionId|playTransactionId|"actor"|email|token|session|password|databaseUrl|audit/iu,
    );
  });
});
