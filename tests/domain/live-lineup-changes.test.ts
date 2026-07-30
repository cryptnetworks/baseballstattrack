import { describe, expect, it } from "vitest";

import { replayGame } from "@/domain/events/event-log";
import {
  previewAlignmentSwap,
  previewPitchingChange,
  previewSubstitution,
} from "@/features/scoring/live-lineup-changes";
import {
  ScoringFixtureBuilder,
  currentFixtureBatter,
  fixturePlayer,
  plateAppearance,
  runnerMovement,
} from "../fixtures/scoring-fixture-builder";

describe("live substitutions and pitching changes", () => {
  it("replaces the current batter without mutating the accepted setup", () => {
    const builder = new ScoringFixtureBuilder();
    builder.start();
    const beforeSetup = structuredClone(builder.setup);
    const state = builder.state();
    const outgoing = currentFixtureBatter(state);
    const incoming = fixturePlayer(builder.setup, "AWAY", "bench");
    const position = state.lineups.AWAY.find(
      ({ playerId }) => playerId === outgoing,
    )!.position!;
    const preview = previewSubstitution(state, {
      side: "AWAY",
      outgoingPlayerId: outgoing,
      incomingPlayerId: incoming,
      position,
    });
    expect(preview.errors).toEqual([]);
    expect(preview.label).toBe("Pinch hitter");
    builder.append(preview.body!);
    expect(currentFixtureBatter(builder.state())).toBe(incoming);
    expect(
      builder
        .state()
        .lineups.AWAY.find(({ playerId }) => playerId === outgoing),
    ).toMatchObject({ active: false });
    expect(builder.setup).toEqual(beforeSetup);
  });

  it("moves a substituted runner and preserves inherited pitcher responsibility", () => {
    const builder = new ScoringFixtureBuilder();
    builder.start();
    const state = builder.state();
    const runner = currentFixtureBatter(state);
    const pitcher = state.activePitcher.HOME;
    builder.append(
      plateAppearance(runner, pitcher, "WALK", [
        runnerMovement(runner, "BATTER", "FIRST", pitcher, {
          cause: "AWARD",
          forced: true,
        }),
      ]),
    );
    const before = builder.state();
    const incoming = fixturePlayer(builder.setup, "AWAY", "bench");
    const position = before.lineups.AWAY.find(
      ({ playerId }) => playerId === runner,
    )!.position!;
    const preview = previewSubstitution(before, {
      side: "AWAY",
      outgoingPlayerId: runner,
      incomingPlayerId: incoming,
      position,
    });
    expect(preview.label).toBe("Pinch runner");
    builder.append(preview.body!);
    expect(builder.state().bases.FIRST).toBe(incoming);
    expect(builder.state().runnerPitcherResponsibility).toEqual({
      [incoming]: pitcher,
    });
  });

  it("accepts a defensive replacement and rejects prohibited reentry", () => {
    const builder = new ScoringFixtureBuilder();
    builder.start();
    const state = builder.state();
    const outgoing = fixturePlayer(builder.setup, "HOME", 1);
    const incoming = fixturePlayer(builder.setup, "HOME", "bench");
    const position = state.lineups.HOME.find(
      ({ playerId }) => playerId === outgoing,
    )!.position!;
    const replacement = previewSubstitution(state, {
      side: "HOME",
      outgoingPlayerId: outgoing,
      incomingPlayerId: incoming,
      position,
    });
    expect(replacement.label).toBe("Defensive replacement");
    builder.append(replacement.body!);
    const reentry = previewSubstitution(builder.state(), {
      side: "HOME",
      outgoingPlayerId: incoming,
      incomingPlayerId: outgoing,
      position,
    });
    expect(reentry.body).toBeNull();
    expect(reentry.errors).toContain("Invalid substitution.");
  });

  it("previews and atomically applies a defensive position swap", () => {
    const builder = new ScoringFixtureBuilder();
    builder.start();
    const state = builder.state();
    const first = fixturePlayer(builder.setup, "HOME", 1);
    const second = fixturePlayer(builder.setup, "HOME", 2);
    const firstPosition = state.lineups.HOME.find(
      ({ playerId }) => playerId === first,
    )!.position!;
    const secondPosition = state.lineups.HOME.find(
      ({ playerId }) => playerId === second,
    )!.position!;
    const preview = previewAlignmentSwap(state, {
      side: "HOME",
      firstPlayerId: first,
      secondPlayerId: second,
    });
    expect(preview.errors).toEqual([]);
    builder.append(preview.body!);
    expect(builder.state().defense.HOME).toMatchObject({
      [firstPosition]: second,
      [secondPosition]: first,
    });
  });

  it("rejects a partial alignment that would displace an unselected defender", () => {
    const builder = new ScoringFixtureBuilder();
    builder.start();
    const before = builder.state();
    const catcher = fixturePlayer(builder.setup, "HOME", 1);
    expect(() =>
      builder.append({
        eventType: "DefensiveAlignmentChanged",
        payload: {
          side: "HOME",
          assignments: [{ playerId: catcher, position: "FIRST_BASE" }],
          reasonCode: "PARTIAL_COLLISION",
        },
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_LINEUP" }));
    expect(builder.state()).toEqual(before);
  });

  it("starts a zero-out pitching appearance and preserves inherited-runner ownership", () => {
    const builder = new ScoringFixtureBuilder();
    builder.start();
    const state = builder.state();
    const runner = currentFixtureBatter(state);
    const starter = state.activePitcher.HOME;
    builder.append(
      plateAppearance(runner, starter, "WALK", [
        runnerMovement(runner, "BATTER", "FIRST", starter, {
          cause: "AWARD",
          forced: true,
        }),
      ]),
    );
    const reliever = fixturePlayer(builder.setup, "HOME", "bench");
    const preview = previewPitchingChange(builder.state(), reliever);
    expect(preview.errors).toEqual([]);
    expect(preview.body).toMatchObject({
      eventType: "PitchingChangeMade",
      payload: { inheritedRunnerIds: [runner] },
    });
    builder.append(preview.body!);
    const changed = builder.state();
    expect(changed.outs).toBe(0);
    expect(changed.activePitcher.HOME).toBe(reliever);
    expect(changed.defense.HOME.PITCHER).toBe(reliever);
    expect(
      Object.values(changed.defense.HOME).filter(
        (playerId) => playerId === reliever,
      ),
    ).toHaveLength(1);
    expect(changed.runnerPitcherResponsibility[runner]).toBe(starter);
    expect(
      builder
        .statistics()
        .pitching.find(({ playerId }) => playerId === reliever)?.counters,
    ).toMatchObject({ appearances: 1, inheritedRunners: 1, outsRecorded: 0 });
  });

  it("removes an active incoming pitcher from the prior defensive position", () => {
    const builder = new ScoringFixtureBuilder();
    builder.start();
    const starter = builder.state().activePitcher.HOME;
    const reliever = fixturePlayer(builder.setup, "HOME", "reliever");
    const priorPosition = builder
      .state()
      .lineups.HOME.find(({ playerId }) => playerId === reliever)!.position!;
    const preview = previewPitchingChange(builder.state(), reliever);
    expect(preview.errors).toEqual([]);
    builder.append(preview.body!);
    expect(
      Object.values(builder.state().defense.HOME).filter(
        (playerId) => playerId === reliever,
      ),
    ).toEqual([reliever]);
    expect(builder.state().defense.HOME.PITCHER).toBe(reliever);
    expect(builder.state().defense.HOME[priorPosition]).toBe(starter);
  });

  it("rejects duplicate active players and wrong-side pitching changes", () => {
    const builder = new ScoringFixtureBuilder();
    builder.start();
    const state = builder.state();
    const outgoing = fixturePlayer(builder.setup, "HOME", 1);
    const alreadyActive = fixturePlayer(builder.setup, "HOME", 2);
    const position = state.lineups.HOME.find(
      ({ playerId }) => playerId === outgoing,
    )!.position!;
    expect(
      previewSubstitution(state, {
        side: "HOME",
        outgoingPlayerId: outgoing,
        incomingPlayerId: alreadyActive,
        position,
      }).body,
    ).toBeNull();
    expect(
      previewPitchingChange(
        { ...state, half: "BOTTOM" },
        fixturePlayer(builder.setup, "HOME", "bench"),
      ).body,
    ).toBeNull();
  });

  it("continues scoring with the substituted batter after acceptance", () => {
    const builder = new ScoringFixtureBuilder();
    builder.start();
    const state = builder.state();
    const outgoing = currentFixtureBatter(state);
    const incoming = fixturePlayer(builder.setup, "AWAY", "bench");
    const position = state.lineups.AWAY.find(
      ({ playerId }) => playerId === outgoing,
    )!.position!;
    builder.append(
      previewSubstitution(state, {
        side: "AWAY",
        outgoingPlayerId: outgoing,
        incomingPlayerId: incoming,
        position,
      }).body!,
    );
    const pitcher = builder.state().activePitcher.HOME;
    builder.append(
      plateAppearance(incoming, pitcher, "SINGLE", [
        runnerMovement(incoming, "BATTER", "FIRST", pitcher, {
          cause: "HIT",
        }),
      ]),
    );
    expect(builder.state().bases.FIRST).toBe(incoming);
    expect(builder.statistics().metadata.sourceRevision).toBe(3);
  });

  it("rejects stale and cross-Account substitution envelopes", () => {
    const builder = new ScoringFixtureBuilder();
    builder.start();
    const state = builder.state();
    const outgoing = currentFixtureBatter(state);
    const incoming = fixturePlayer(builder.setup, "AWAY", "bench");
    const position = state.lineups.AWAY.find(
      ({ playerId }) => playerId === outgoing,
    )!.position!;
    builder.append(
      previewSubstitution(state, {
        side: "AWAY",
        outgoingPlayerId: outgoing,
        incomingPlayerId: incoming,
        position,
      }).body!,
    );
    const [start, substitution] = builder.events();
    expect(() =>
      replayGame(builder.setup, [
        start!,
        {
          ...substitution!,
          expectedRevision: 0,
          acceptedRevision: 1,
        },
      ]),
    ).toThrowError(expect.objectContaining({ code: "STALE_SOURCE_REVISION" }));
    expect(() =>
      replayGame(builder.setup, [
        start!,
        { ...substitution!, accountId: "another-account" },
      ]),
    ).toThrowError(expect.objectContaining({ code: "ACCOUNT_MISMATCH" }));
  });
});
