import { describe, expect, it, vi } from "vitest";

import { DiscordUpdateProviderError } from "@/domain/discord-update-worker";
import {
  DiscordUpdatePublicationService,
  DiscordUpdateWorkerService,
} from "@/server/app/discord-update-worker-service";

const WORKER = "worker-119-a";
const NOW = new Date("2026-08-01T07:00:00.000Z");

function evaluation(sourceRevision = 7) {
  return {
    id: `evaluation-${sourceRevision}`,
    externalId: "00000000-0000-4000-8000-000000000119",
    accountId: "account-a",
    settingsId: "settings-a",
    gameId: "game-a",
    settingsRevision: 3,
    sourceRevision,
    trigger: "SCORE_CHANGED",
    status: "PROCESSING",
    attemptCount: 0,
    account: { externalId: "00000000-0000-4000-8000-000000000001" },
    game: {
      externalId: "00000000-0000-4000-8000-000000000002",
      teamSeasonId: "team-season-a",
    },
    settings: {},
  };
}

function delivery(sourceRevision = 7) {
  return {
    id: `delivery-${sourceRevision}`,
    externalId: "00000000-0000-4000-8000-000000000120",
    accountId: "account-a",
    settingsId: "settings-a",
    evaluationId: "evaluation-a",
    gameId: "game-a",
    destinationId: "destination-a",
    settingsRevision: 3,
    sourceRevision,
    operation: "EDIT",
    messageFormat: "COMPACT",
    content: "Away 2, Home 1 — top 7",
    targetProviderMessageId: "123456789012345678",
    attemptCount: 0,
    destination: {
      channelId: "223456789012345678",
      enabled: true,
      canView: true,
      canSend: true,
    },
    settings: {
      revision: 3,
      enabled: true,
      installation: { status: "ACTIVE" },
    },
  };
}

function snapshot(sourceRevision = 7) {
  return {
    awayTeam: "Away",
    homeTeam: "Home",
    awayScore: 2,
    homeScore: 1,
    inning: 7,
    half: "TOP",
    latestEvent: "Away scored.",
    correctionSummary: null,
    reportReady: false,
    verified: false,
    sourceRevision,
    freshness: "CURRENT",
  };
}

function service(repository: Record<string, unknown>, overrides = {}) {
  return new DiscordUpdateWorkerService(
    {
      enqueueDueSchedules: vi
        .fn()
        .mockResolvedValue({ settings: 0, created: 0 }),
      ...repository,
    } as never,
    {
      loadGame: vi.fn().mockResolvedValue(snapshot()),
      ...("statistics" in overrides
        ? (overrides as { statistics: object }).statistics
        : {}),
    } as never,
    {
      send: vi
        .fn()
        .mockResolvedValue({ status: 200, messageId: "323456789012345678" }),
      ...("transport" in overrides
        ? (overrides as { transport: object }).transport
        : {}),
    } as never,
    "events" in overrides
      ? (overrides as { events: { emit: (event: unknown) => void } }).events
      : { emit: vi.fn() },
    "clock" in overrides
      ? (overrides as { clock: () => Date }).clock
      : () => NOW,
  );
}

describe("Discord update publication", () => {
  it("passes one exact versioned signal to the durable repository", async () => {
    const repository = {
      enqueueSignal: vi
        .fn()
        .mockResolvedValue({ outcome: "accepted", created: 1 }),
    };
    const publication = new DiscordUpdatePublicationService(
      repository as never,
    );
    await expect(
      publication.publish({
        accountId: "account-a",
        gameId: "00000000-0000-4000-8000-000000000002",
        trigger: "SCORE_CHANGED",
        sourceRevision: 7,
        occurredAt: NOW.toISOString(),
      }),
    ).resolves.toEqual({ outcome: "accepted", created: 1 });
    expect(repository.enqueueSignal).toHaveBeenCalledWith(
      expect.objectContaining({ sourceRevision: 7, occurredAt: NOW }),
    );
  });
});

describe("Discord update evaluation", () => {
  it("loads source revisions in claimed order and queues only current data", async () => {
    const repository = {
      claimEvaluations: vi
        .fn()
        .mockResolvedValue([evaluation(7), evaluation(8)]),
      completeEvaluation: vi.fn().mockResolvedValue({ status: "SUCCEEDED" }),
      failEvaluation: vi.fn(),
      releaseEvaluationClaims: vi.fn(),
    };
    const statistics = {
      loadGame: vi
        .fn()
        .mockResolvedValueOnce(snapshot(7))
        .mockResolvedValueOnce(snapshot(8)),
    };
    await expect(
      service(repository, { statistics }).evaluateBatch(WORKER, { now: NOW }),
    ).resolves.toEqual([
      { evaluationId: "evaluation-7", outcome: "succeeded" },
      { evaluationId: "evaluation-8", outcome: "succeeded" },
    ]);
    expect(
      repository.completeEvaluation.mock.calls.map(
        ([value]) => value.evaluationId,
      ),
    ).toEqual(["evaluation-7", "evaluation-8"]);
    expect(repository.completeEvaluation).toHaveBeenCalledWith(
      expect.objectContaining({ completedAt: NOW }),
    );
    expect(repository.failEvaluation).not.toHaveBeenCalled();
  });

  it("retries stale projections instead of publishing misleading content", async () => {
    const repository = {
      claimEvaluations: vi.fn().mockResolvedValue([evaluation(8)]),
      completeEvaluation: vi.fn(),
      failEvaluation: vi.fn().mockResolvedValue({ status: "PENDING" }),
      releaseEvaluationClaims: vi.fn(),
    };
    await expect(
      service(repository, {
        statistics: { loadGame: vi.fn().mockResolvedValue(snapshot(7)) },
      }).evaluateBatch(WORKER),
    ).resolves.toEqual([{ evaluationId: "evaluation-8", outcome: "retry" }]);
    expect(repository.completeEvaluation).not.toHaveBeenCalled();
    expect(repository.failEvaluation).toHaveBeenCalledWith(
      expect.objectContaining({
        failureCode: "STATISTICS_STALE",
        terminal: false,
      }),
    );
  });

  it("releases every unstarted evaluation when shutdown is requested", async () => {
    const abort = new AbortController();
    abort.abort();
    const repository = {
      claimEvaluations: vi
        .fn()
        .mockResolvedValue([evaluation(7), evaluation(8)]),
      completeEvaluation: vi.fn(),
      failEvaluation: vi.fn(),
      releaseEvaluationClaims: vi.fn().mockResolvedValue(2),
    };
    await expect(
      service(repository).evaluateBatch(WORKER, { signal: abort.signal }),
    ).resolves.toEqual([]);
    expect(repository.releaseEvaluationClaims).toHaveBeenCalledWith(WORKER, [
      "evaluation-7",
      "evaluation-8",
    ]);
  });
});

describe("Discord update delivery", () => {
  it("uses the durable delivery ID and deterministic edit target", async () => {
    const repository = {
      claimDeliveries: vi.fn().mockResolvedValue([delivery()]),
      deliveryIsCurrent: vi.fn().mockResolvedValue(true),
      completeDeliveryAttempt: vi
        .fn()
        .mockResolvedValue({ status: "SUCCEEDED" }),
      cancelDelivery: vi.fn(),
      releaseDeliveryClaims: vi.fn(),
    };
    const transport = {
      send: vi
        .fn()
        .mockResolvedValue({ status: 200, messageId: "323456789012345678" }),
    };
    const events = { emit: vi.fn() };
    await expect(
      service(repository, { transport, events }).deliverBatch(WORKER),
    ).resolves.toEqual([{ deliveryId: "delivery-7", outcome: "succeeded" }]);
    expect(transport.send).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "EDIT",
        idempotencyKey: "00000000-0000-4000-8000-000000000120",
        targetMessageId: "123456789012345678",
      }),
    );
    expect(repository.claimDeliveries).toHaveBeenCalledWith(WORKER, NOW, 25);
    expect(repository.completeDeliveryAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ startedAt: NOW, completedAt: NOW }),
    );
    expect(events.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "discord_update_delivery",
        correlationId: "00000000-0000-4000-8000-000000000120",
      }),
    );
  });

  it("recovers from rate limits and dead-letters revoked channels", async () => {
    const repository = {
      claimDeliveries: vi.fn().mockResolvedValue([delivery()]),
      deliveryIsCurrent: vi.fn().mockResolvedValue(true),
      completeDeliveryAttempt: vi
        .fn()
        .mockResolvedValueOnce({ status: "PENDING" })
        .mockResolvedValueOnce({ status: "DEAD_LETTER" }),
      cancelDelivery: vi.fn(),
      releaseDeliveryClaims: vi.fn(),
    };
    const transport = {
      send: vi
        .fn()
        .mockRejectedValueOnce(
          new DiscordUpdateProviderError("RATE_LIMITED", true, 429, 90),
        )
        .mockRejectedValueOnce(
          new DiscordUpdateProviderError("DESTINATION_UNAVAILABLE", false, 404),
        ),
    };
    const worker = service(repository, { transport });
    await expect(worker.deliverBatch(WORKER)).resolves.toEqual([
      { deliveryId: "delivery-7", outcome: "retry" },
    ]);
    await expect(worker.deliverBatch(WORKER)).resolves.toEqual([
      { deliveryId: "delivery-7", outcome: "dead_letter" },
    ]);
    expect(repository.completeDeliveryAttempt.mock.calls[0]![0]).toMatchObject({
      failureCode: "RATE_LIMITED",
      responseStatus: 429,
      retryAfterSeconds: 90,
      terminal: false,
    });
    expect(repository.completeDeliveryAttempt.mock.calls[1]![0]).toMatchObject({
      failureCode: "DESTINATION_UNAVAILABLE",
      terminal: true,
    });
  });

  it("cancels changed destinations before transport access", async () => {
    const repository = {
      claimDeliveries: vi.fn().mockResolvedValue([delivery()]),
      deliveryIsCurrent: vi.fn().mockResolvedValue(false),
      completeDeliveryAttempt: vi.fn(),
      cancelDelivery: vi.fn().mockResolvedValue({ status: "CANCELLED" }),
      releaseDeliveryClaims: vi.fn(),
    };
    const transport = { send: vi.fn() };
    await expect(
      service(repository, { transport }).deliverBatch(WORKER),
    ).resolves.toEqual([{ deliveryId: "delivery-7", outcome: "cancelled" }]);
    expect(transport.send).not.toHaveBeenCalled();
  });

  it("releases every unstarted delivery during graceful shutdown", async () => {
    const abort = new AbortController();
    abort.abort();
    const repository = {
      claimDeliveries: vi.fn().mockResolvedValue([delivery(7), delivery(8)]),
      deliveryIsCurrent: vi.fn(),
      completeDeliveryAttempt: vi.fn(),
      cancelDelivery: vi.fn(),
      releaseDeliveryClaims: vi.fn().mockResolvedValue(2),
    };
    await expect(
      service(repository).deliverBatch(WORKER, { signal: abort.signal }),
    ).resolves.toEqual([]);
    expect(repository.releaseDeliveryClaims).toHaveBeenCalledWith(WORKER, [
      "delivery-7",
      "delivery-8",
    ]);
  });
});
