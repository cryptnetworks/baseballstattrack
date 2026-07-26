import { z } from "zod";

export const gameEventEnvelopeSchema = z.object({
  id: z.uuid(),
  gameId: z.uuid(),
  sequence: z.int().nonnegative(),
  type: z.string().min(1),
  occurredAt: z.iso.datetime(),
  payload: z.record(z.string(), z.unknown()),
});

export type GameEventEnvelope = z.infer<typeof gameEventEnvelopeSchema>;

export type EventLogSummary = {
  gameId: string;
  eventCount: number;
  firstSequence: number | null;
  lastSequence: number | null;
  eventTypes: readonly string[];
};

export function summarizeEventLog(
  events: readonly GameEventEnvelope[],
): EventLogSummary {
  if (events.length === 0) {
    return {
      gameId: "unassigned",
      eventCount: 0,
      firstSequence: null,
      lastSequence: null,
      eventTypes: [],
    };
  }

  const orderedEvents = [...events].sort((left, right) => {
    return left.sequence - right.sequence;
  });
  const firstEvent = orderedEvents[0];
  const lastEvent = orderedEvents.at(-1);

  if (!firstEvent || !lastEvent) {
    throw new Error("Unable to summarize event log.");
  }

  const gameIds = new Set(orderedEvents.map((event) => event.gameId));
  if (gameIds.size > 1) {
    throw new Error("Cannot summarize events from multiple games.");
  }

  return {
    gameId: firstEvent.gameId,
    eventCount: orderedEvents.length,
    firstSequence: firstEvent.sequence,
    lastSequence: lastEvent.sequence,
    eventTypes: [...new Set(orderedEvents.map((event) => event.type))],
  };
}
