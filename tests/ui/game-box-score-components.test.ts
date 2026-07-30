import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import {
  BattingTable,
  FieldingTable,
  LineupTable,
  PitchingTable,
} from "@/app/games/[gameId]/box-score/page";
import { BoxScoreVerificationPanel } from "@/components/reports/box-score-verification-panel";
import { buildGameBoxScore } from "@/domain/reports";
import {
  ScoringFixtureBuilder,
  currentFixtureBatter,
  plateAppearance,
  runnerMovement,
} from "../fixtures/scoring-fixture-builder";

function fixtureReport() {
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
      season: { id: "season-1", displayName: "2026 season" },
      teams: {
        AWAY: { id: "away", displayName: "Visitors" },
        HOME: { id: "home", displayName: "Hosts" },
      },
      players: (["AWAY", "HOME"] as const).flatMap((side) =>
        builder.setup.sides[side].lineup.map((player, index) => ({
          playerId: player.playerId,
          lineupSlotId: `${side}-${index}`,
          side,
          displayName: player.playerId.replaceAll("-", " "),
          jerseyNumber: null,
          battingOrder: player.battingOrder,
          defensivePosition: player.position,
          startingPitcher:
            player.playerId === builder.setup.sides[side].startingPitcherId,
        })),
      ),
    },
    privacyOverlayRevision: 0,
    generatedAt: "2026-07-30T20:00:00.000Z",
  });
}

describe("game box score presentation", () => {
  it("uses semantic, horizontally readable report tables", () => {
    const report = fixtureReport();
    const html = [LineupTable, BattingTable, PitchingTable, FieldingTable]
      .map((Component) =>
        renderToStaticMarkup(
          createElement(Component, { report, side: "AWAY" }),
        ),
      )
      .join("");
    expect(html.match(/<table/g)).toHaveLength(4);
    expect(html).toContain("<caption");
    expect(html).toContain('scope="col"');
    expect(html).toContain('scope="row"');
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("Visitors batting");
    expect(html).toContain("Team totals");
  });

  it("requires explicit accessible verification confirmation", () => {
    const html = renderToStaticMarkup(
      createElement(BoxScoreVerificationPanel, {
        accountId: "account-a",
        gameId: "game-a",
        mode: "REVERIFY",
        setupSnapshotId: "setup-a",
        sourceRevision: 12,
        submission: {
          eventId: "verify-a",
          playTransactionId: "verify-transaction",
          clientSubmissionId: "verify-submission",
          recordedAt: "2026-07-30T20:00:00.000Z",
        },
      }),
    );
    expect(html).toContain('aria-labelledby="verification-action-heading"');
    expect(html).toContain("Reverification required");
    expect(html).toContain('name="confirmed"');
    expect(html).toContain("required");
    expect(html).toContain("Reverify corrected game");
  });

  it("keeps responsive and print semantics in the report route", () => {
    const source = readFileSync(
      "src/app/games/[gameId]/box-score/page.tsx",
      "utf8",
    );
    expect(source).toContain("print:max-w-none");
    expect(source).toContain("print:hidden");
    expect(source).toContain("break-inside-avoid");
    expect(source).toContain("overflow-x-auto");
    expect(source).toContain('scope="col"');
    expect(source).toContain('scope="row"');
  });
});
