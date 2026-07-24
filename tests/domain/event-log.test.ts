import { describe, expect, it } from "vitest";

import {
  gameEventEnvelopeSchema,
  summarizeEventLog,
  type GameEventEnvelope,
} from "@/domain/events/event-log";

const gameId = "2cd38e33-dfd3-41ba-8fd2-6acfc7323942";

function event(sequence: number, type: string): GameEventEnvelope {
  return {
    id: `2cd38e33-dfd3-41ba-8fd2-6acfc73239${sequence
      .toString()
      .padStart(2, "0")}`,
    gameId,
    sequence,
    type,
    occurredAt: "2026-07-24T12:00:00.000Z",
    payload: {},
  };
}

describe("gameEventEnvelopeSchema", () => {
  it("accepts a minimal source event envelope", () => {
    expect(gameEventEnvelopeSchema.parse(event(1, "plate-appearance"))).toEqual(
      event(1, "plate-appearance"),
    );
  });
});

describe("summarizeEventLog", () => {
  it("summarizes events by sequence without mutating input order", () => {
    const events = [
      event(2, "runner-advance"),
      event(0, "game-started"),
      event(1, "plate-appearance"),
    ] as const;

    expect(summarizeEventLog(events)).toEqual({
      gameId,
      eventCount: 3,
      firstSequence: 0,
      lastSequence: 2,
      eventTypes: ["game-started", "plate-appearance", "runner-advance"],
    });
    expect(events[0]?.sequence).toBe(2);
  });

  it("rejects mixed-game summaries", () => {
    expect(() =>
      summarizeEventLog([
        event(0, "game-started"),
        {
          ...event(1, "plate-appearance"),
          gameId: "63a5782f-0325-41a5-a5cb-4a7815a14dbb",
        },
      ]),
    ).toThrow("Cannot summarize events from multiple games.");
  });
});
