import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  PrintableGameReport,
  PrintablePlayerReport,
  PrintableSeasonReport,
} from "@/components/reports/printable-reports";
import { buildGameBoxScore, type SeasonDashboard } from "@/domain/reports";
import {
  ScoringFixtureBuilder,
  currentFixtureBatter,
  plateAppearance,
  runnerMovement,
} from "../fixtures/scoring-fixture-builder";

function gameReport() {
  const builder = new ScoringFixtureBuilder();
  builder.start();
  const state = builder.state();
  const batter = currentFixtureBatter(state);
  builder.append(
    plateAppearance(batter, state.activePitcher.HOME, "SINGLE", [
      runnerMovement(batter, "BATTER", "FIRST", state.activePitcher.HOME, {
        cause: "HIT",
      }),
    ]),
  );
  return buildGameBoxScore({
    setup: builder.setup,
    events: builder.events(),
    presentation: {
      season: { id: "season-1", displayName: "Summer 2026" },
      teams: {
        AWAY: {
          id: "away",
          displayName: "Visitors with a deliberately long name",
        },
        HOME: { id: "home", displayName: "Hosts" },
      },
      players: (["AWAY", "HOME"] as const).flatMap((side) =>
        builder.setup.sides[side].lineup.map((player, index) => ({
          playerId: player.playerId,
          lineupSlotId: `${side}-${index}`,
          side,
          displayName: `Privacy name ${side} ${index + 1}`,
          jerseyNumber: null,
          battingOrder: player.battingOrder,
          defensivePosition: player.position,
          startingPitcher:
            player.playerId === builder.setup.sides[side].startingPitcherId,
        })),
      ),
    },
    privacyOverlayRevision: 4,
    generatedAt: "2026-07-30T20:00:00.000Z",
  });
}

function seasonDashboard() {
  const player = {
    playerId: "player-1",
    displayName: "Privacy-resolved player",
    batting: {
      playerId: "player-1",
      side: "AWAY",
      counters: {
        plateAppearances: 12,
        hits: 5,
        runsBattedIn: 3,
      },
      rates: { battingAverage: { numerator: 1, denominator: 2 } },
    },
    pitching: {
      playerId: "player-1",
      side: "AWAY",
      counters: { outsRecorded: 12, strikeouts: 6 },
      rates: { earnedRunAverage: { numerator: 9, denominator: 4 } },
    },
    fielding: {
      playerId: "player-1",
      side: "AWAY",
      counters: { errors: 0 },
      rates: {
        chances: 6,
        fieldingPercentage: { numerator: 1, denominator: 1 },
      },
    },
    sourceGames: [
      {
        gameId: "game-1",
        setupSnapshotId: "setup-1",
        scheduledAt: "2026-07-01T12:00:00.000Z",
        verificationState: "VERIFIED",
      },
    ],
  };
  return {
    version: {
      seasonId: "season-1",
      teamId: "team-1",
      derivationVersion: 2,
      privacyOverlayRevision: 4,
      sourceRevisions: [{ gameId: "game-1", sourceRevision: 12 }],
    },
    selection: {
      teamDisplayName: "Stars",
      seasonDisplayName: "Summer 2026",
    },
    record: {
      wins: 8,
      losses: 3,
      ties: 1,
      incomplete: 2,
      abandoned: 1,
      cancelled: 0,
      correctedAwaitingReverification: 1,
    },
    statistics: {
      team: { batting: { runs: 72, hits: 110 } },
    },
    inclusionPolicy: {
      minimums: {
        battingPlateAppearances: 10,
        pitchingOutsRecorded: 9,
        fieldingChances: 5,
      },
    },
    leaders: {
      batting: [
        {
          playerId: "player-1",
          displayName: player.displayName,
          sampleSize: 12,
          rate: { numerator: 1, denominator: 2 },
        },
      ],
      pitching: [
        {
          playerId: "player-1",
          displayName: player.displayName,
          sampleSize: 12,
          rate: { numerator: 9, denominator: 4 },
        },
      ],
      fielding: [
        {
          playerId: "player-1",
          displayName: player.displayName,
          sampleSize: 6,
          rate: { numerator: 1, denominator: 1 },
        },
      ],
    },
    recentGames: [
      {
        gameId: "game-1",
        scheduledAt: "2026-07-01T12:00:00.000Z",
        opponentDisplayName: "Rivals",
        scoreFor: 6,
        scoreAgainst: 4,
        result: "WIN",
        status: "VERIFIED",
      },
      {
        gameId: "game-2",
        scheduledAt: "2026-07-02T12:00:00.000Z",
        opponentDisplayName: "Long opponent display label",
        scoreFor: 3,
        scoreAgainst: 2,
        result: "INCOMPLETE",
        status: "CORRECTED_AWAITING_REVERIFICATION",
      },
    ],
    players: [player],
  } as unknown as SeasonDashboard;
}

function structuralSnapshot(html: string) {
  return {
    captions: html.match(/<caption/g)?.length ?? 0,
    columnHeaders: html.match(/scope="col"/g)?.length ?? 0,
    rowHeaders: html.match(/scope="row"/g)?.length ?? 0,
    sections: html.match(/<section/g)?.length ?? 0,
    tables: html.match(/<table/g)?.length ?? 0,
  };
}

describe("printable report presentation", () => {
  it("renders stable representative game, season, and player structures", () => {
    const dashboard = seasonDashboard();
    const game = renderToStaticMarkup(
      createElement(PrintableGameReport, { report: gameReport() }),
    );
    const season = renderToStaticMarkup(
      createElement(PrintableSeasonReport, {
        dashboard,
        generatedAt: "2026-07-30T20:00:00.000Z",
      }),
    );
    const player = renderToStaticMarkup(
      createElement(PrintablePlayerReport, {
        dashboard,
        generatedAt: "2026-07-30T20:00:00.000Z",
        player: dashboard.players[0]!,
      }),
    );

    expect(structuralSnapshot(game)).toEqual({
      captions: 5,
      columnHeaders: 45,
      rowHeaders: 5,
      sections: 3,
      tables: 5,
    });
    expect(structuralSnapshot(season)).toEqual({
      captions: 3,
      columnHeaders: 17,
      rowHeaders: 5,
      sections: 3,
      tables: 4,
    });
    expect(structuralSnapshot(player)).toEqual({
      captions: 0,
      columnHeaders: 3,
      rowHeaders: 1,
      sections: 2,
      tables: 1,
    });
    expect(game).toContain("Summer 2026");
    expect(game).toContain("Source revision");
    expect(season).toContain("awaiting reverification");
    expect(player).toContain("Privacy-resolved player");
    expect(`${game}${season}${player}`).not.toMatch(
      /account-1|actor|membership|email|token|raw event|correction explanation/iu,
    );
  });

  it("defines paper, grayscale, page-break, and repeated-header behavior", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    expect(css).toContain("@page report-portrait");
    expect(css).toContain("@page report-landscape");
    expect(css).toContain("size: letter portrait");
    expect(css).toContain("size: letter landscape");
    expect(css).toContain("display: table-header-group");
    expect(css).toContain("break-inside: avoid");
    expect(css).toContain("overflow: visible");
    expect(css).toContain("background: transparent !important");
  });

  it("keeps print access authorized, keyboard-native, and non-public", () => {
    const gameRoute = readFileSync(
      "src/app/games/[gameId]/box-score/print/page.tsx",
      "utf8",
    );
    const seasonRoute = readFileSync(
      "src/app/reports/season/print/page.tsx",
      "utf8",
    );
    const playerRoute = readFileSync(
      "src/app/reports/season/players/[playerId]/print/page.tsx",
      "utf8",
    );
    const action = readFileSync(
      "src/components/reports/print-action.tsx",
      "utf8",
    );
    for (const route of [gameRoute, seasonRoute, playerRoute]) {
      expect(route).toContain("authorizeProtectedRequest");
      expect(route).toContain('"report.view"');
      expect(route).toContain("selectedAccountCookie");
    }
    expect(action).toContain("<button");
    expect(action).toContain('type="button"');
    expect(action).toContain("window.print()");
    expect(action).toContain("min-h-11");
    expect(action).not.toContain("tabIndex");
  });
});
