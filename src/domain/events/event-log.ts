export * from "./game-engine";
export * from "./game-events";

import type { AcceptedEvent } from "./game-events";

export function summarizeEventLog(events: readonly AcceptedEvent[]) {
  if (events.length === 0) {
    return {
      accountId: "unassigned",
      gameId: "unassigned",
      eventCount: 0,
      firstSequence: null,
      lastSequence: null,
      eventTypes: [] as string[],
    };
  }
  const ordered = [...events].sort(
    (left, right) => left.sequence - right.sequence,
  );
  const first = ordered[0]!;
  if (
    ordered.some(
      (event) =>
        event.gameId !== first.gameId || event.accountId !== first.accountId,
    )
  ) {
    throw new Error("Cannot summarize events from multiple games or Accounts.");
  }
  return {
    accountId: first.accountId,
    gameId: first.gameId,
    eventCount: ordered.length,
    firstSequence: first.sequence,
    lastSequence: ordered.at(-1)!.sequence,
    eventTypes: [...new Set(ordered.map((event) => event.eventType))],
  };
}
