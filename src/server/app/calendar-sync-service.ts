import { Prisma } from "@prisma/client";
import { z } from "zod";

import {
  CalendarProviderError,
  calendarConnectionInputSchema,
  calendarGameIsCancelled,
  calendarProviderEvent,
  calendarProviderEventId,
  calendarSourceFingerprint,
} from "@/domain/calendar-sync";
import {
  getRateLimitService,
  noRateLimit,
  type RateLimitEnforcer,
} from "@/server/app/rate-limit-service";
import { AuthorizationError } from "@/server/auth/errors";
import {
  requireTrustedActor,
  type TrustedActorContext,
} from "@/server/auth/types";
import {
  CalendarConnectionExistsError,
  PrismaCalendarSyncRepository,
} from "@/server/data/calendar-sync-repository";
import { getPrismaClient } from "@/server/data/prisma";
import {
  emitOperationalEvent,
  getOperationalEventSink,
  type OperationalEventSink,
} from "@/server/observability/operational-events";
import {
  configuredCalendarCredentialResolver,
  type CalendarCredentialResolver,
} from "@/server/providers/google-calendar";

const externalId = z.uuid();
const workerId = z.string().trim().min(8).max(128);

type CalendarRepository = Pick<
  PrismaCalendarSyncRepository,
  | "createConnection"
  | "listConnections"
  | "beginDisconnect"
  | "retryFailures"
  | "claimConnection"
  | "loadGamesAndLinks"
  | "renewLease"
  | "ensureLink"
  | "reactivateCancelledLink"
  | "recordSynced"
  | "recordCancelled"
  | "recordFailure"
  | "finishConnection"
  | "releaseFailedClaim"
>;

export class CalendarSyncError extends Error {
  constructor(
    readonly code:
      | "INVALID_REQUEST"
      | "RESOURCE_UNAVAILABLE"
      | "ALREADY_CONNECTED"
      | "CONFIGURATION_ERROR",
    readonly status: 400 | 404 | 409 | 500,
    message: string,
  ) {
    super(message);
    this.name = "CalendarSyncError";
  }
}

function administrator(
  actorInput: TrustedActorContext,
  accountId: string,
): TrustedActorContext {
  const actor = requireTrustedActor(actorInput, accountId, "account.manage");
  if (actor.target.kind !== "ACCOUNT") {
    throw new AuthorizationError("AUTHORIZATION_REQUIRED");
  }
  return actor;
}

export class CalendarAdministrationService {
  constructor(
    private readonly repository: CalendarRepository,
    private readonly rateLimits: RateLimitEnforcer = noRateLimit,
  ) {}

  async connect(input: unknown, actorInput: TrustedActorContext) {
    const parsed = calendarConnectionInputSchema.parse(input);
    const actor = administrator(actorInput, parsed.accountId);
    await this.rateLimits.enforce(
      { accountId: parsed.accountId, endpointClass: "ADMINISTRATION" },
      actor,
    );
    try {
      const connection = await this.repository.createConnection({
        ...parsed,
        actor,
      });
      return {
        connectionId: connection.externalId,
        status: connection.status,
      };
    } catch (error) {
      if (
        error instanceof CalendarConnectionExistsError ||
        (error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002")
      ) {
        throw new CalendarSyncError(
          "ALREADY_CONNECTED",
          409,
          "That calendar is already connected to this Account.",
        );
      }
      throw error;
    }
  }

  async list(accountId: string, actorInput: TrustedActorContext) {
    administrator(actorInput, accountId);
    return this.repository.listConnections(accountId);
  }

  async disconnect(input: unknown, actorInput: TrustedActorContext) {
    const parsed = z
      .object({
        accountId: z.string().trim().min(1).max(128),
        connectionId: externalId,
      })
      .strict()
      .parse(input);
    const actor = administrator(actorInput, parsed.accountId);
    await this.rateLimits.enforce(
      { accountId: parsed.accountId, endpointClass: "ADMINISTRATION" },
      actor,
    );
    if (
      !(await this.repository.beginDisconnect({
        accountId: parsed.accountId,
        connectionExternalId: parsed.connectionId,
        actor,
      }))
    ) {
      throw new CalendarSyncError(
        "RESOURCE_UNAVAILABLE",
        404,
        "The calendar connection is unavailable.",
      );
    }
  }

  async retry(input: unknown, actorInput: TrustedActorContext) {
    const parsed = z
      .object({
        accountId: z.string().trim().min(1).max(128),
        connectionId: externalId,
        force: z.boolean().default(false),
      })
      .strict()
      .parse(input);
    const actor = administrator(actorInput, parsed.accountId);
    await this.rateLimits.enforce(
      { accountId: parsed.accountId, endpointClass: "ADMINISTRATION" },
      actor,
    );
    const retried = await this.repository.retryFailures({
      accountId: parsed.accountId,
      connectionExternalId: parsed.connectionId,
      force: parsed.force,
      actor,
    });
    if (retried === null) {
      throw new CalendarSyncError(
        "RESOURCE_UNAVAILABLE",
        404,
        "The calendar connection is unavailable.",
      );
    }
    return { retried };
  }
}

function opponent(
  game: Awaited<
    ReturnType<CalendarRepository["loadGamesAndLinks"]>
  >["games"][number],
) {
  const teams = game.readySetupSnapshot?.teamSnapshots ?? [];
  return (
    teams.find(
      (team) =>
        team.teamSeasonId === null || team.teamSeasonId !== game.teamSeasonId,
    )?.displayName ?? null
  );
}

function safeFailure(error: unknown): {
  code: string;
  conflict: boolean;
} {
  if (error instanceof CalendarProviderError) {
    return { code: error.code, conflict: error.code === "CONFLICT" };
  }
  return { code: "PROVIDER_UNAVAILABLE", conflict: false };
}

export class CalendarSynchronizationService {
  constructor(
    private readonly repository: CalendarRepository,
    private readonly credentials: CalendarCredentialResolver,
    private readonly events: OperationalEventSink = getOperationalEventSink(),
  ) {}

  async run(input: unknown) {
    const parsed = z
      .object({
        workerId,
        connectionId: externalId.optional(),
      })
      .strict()
      .parse(input);
    const now = new Date();
    const connection = await this.repository.claimConnection({
      workerId: parsed.workerId,
      now,
      ...(parsed.connectionId
        ? { connectionExternalId: parsed.connectionId }
        : {}),
    });
    if (!connection) return { outcome: "idle" as const };

    let provider;
    try {
      provider = this.credentials(connection.credentialReference);
    } catch {
      await this.repository.releaseFailedClaim({
        connectionId: connection.id,
        workerId: parsed.workerId,
        now: new Date(),
        failureCode: "CREDENTIAL_UNAVAILABLE",
      });
      return {
        outcome: "failed" as const,
        connectionId: connection.externalId,
        failureCode: "CREDENTIAL_UNAVAILABLE",
      };
    }

    const state = await this.repository.loadGamesAndLinks(
      connection.accountId,
      connection.id,
    );
    const links = new Map(state.links.map((link) => [link.gameId, link]));
    const disconnecting = connection.status === "DISCONNECTING";
    const results = {
      createdOrUpdated: 0,
      cancelled: 0,
      skipped: 0,
      failed: 0,
    };
    let firstFailure: string | null = null;

    const games = disconnecting
      ? state.games.filter((game) => links.has(game.id))
      : state.games;
    for (const game of games) {
      if (
        !(await this.repository.renewLease({
          connectionId: connection.id,
          workerId: parsed.workerId,
          now: new Date(),
        }))
      ) {
        firstFailure ??= "LEASE_LOST";
        results.failed += 1;
        break;
      }
      let link = links.get(game.id);
      const cancellation = disconnecting || calendarGameIsCancelled(game);
      if (!link && cancellation) {
        results.skipped += 1;
        continue;
      }
      if (!link) {
        link = await this.repository.ensureLink({
          accountId: connection.accountId,
          connectionId: connection.id,
          gameId: game.id,
          providerEventId: calendarProviderEventId(
            connection.externalId,
            game.externalId,
          ),
        });
        links.set(game.id, link);
      }
      if (link.status === "CONFLICT") {
        firstFailure ??= "CONFLICT";
        results.failed += 1;
        continue;
      }

      try {
        if (cancellation) {
          if (link.status === "CANCELLED") {
            results.skipped += 1;
            continue;
          }
          await provider.cancel({
            calendarId: connection.providerCalendarId,
            eventId: link.providerEventId,
            expectedVersion: link.providerVersion,
          });
          await this.repository.recordCancelled({
            linkId: link.id,
            now: new Date(),
          });
          results.cancelled += 1;
          continue;
        }

        const source = {
          gameId: game.id,
          gameExternalId: game.externalId,
          status: game.status,
          revision: game.revision,
          setupRevision: game.setupRevision,
          scheduledAt: game.scheduledAt,
          location: game.location,
          opponent: opponent(game),
          archivedAt: game.archivedAt,
        };
        if (link.status === "CANCELLED") {
          link = await this.repository.reactivateCancelledLink({
            linkId: link.id,
            providerEventId: calendarProviderEventId(
              connection.externalId,
              game.externalId,
              link.attemptCount + 1,
            ),
          });
          links.set(game.id, link);
        }
        const event = calendarProviderEvent(
          source,
          connection.detailLevel,
          connection.timeZone,
        );
        const fingerprint = calendarSourceFingerprint({
          event,
          status: game.status,
          revision: game.revision,
          setupRevision: game.setupRevision,
        });
        if (
          link.status === "SYNCED" &&
          link.sourceFingerprint === fingerprint
        ) {
          results.skipped += 1;
          continue;
        }
        const synced = await provider.upsert({
          calendarId: connection.providerCalendarId,
          eventId: link.providerEventId,
          event,
          expectedVersion: link.providerVersion,
        });
        await this.repository.recordSynced({
          linkId: link.id,
          workerId: parsed.workerId,
          providerVersion: synced.version,
          sourceFingerprint: fingerprint,
          now: new Date(),
        });
        results.createdOrUpdated += 1;
      } catch (error) {
        const failure = safeFailure(error);
        firstFailure ??= failure.code;
        results.failed += 1;
        await this.repository.recordFailure({
          linkId: link.id,
          code: failure.code,
          conflict: failure.conflict,
          now: new Date(),
        });
      }
    }

    const completedAt = new Date();
    const disconnected = disconnecting && results.failed === 0;
    await this.repository.finishConnection({
      connectionId: connection.id,
      workerId: parsed.workerId,
      now: completedAt,
      failureCode: firstFailure,
      disconnected,
    });
    emitOperationalEvent(this.events, {
      severity: results.failed ? "warning" : "info",
      category: "background_job",
      name: "calendar_sync",
      outcome: results.failed ? "degraded" : "succeeded",
      accountId: connection.accountId,
      ...(firstFailure ? { code: firstFailure } : {}),
      metadata: { ...results, disconnecting, disconnected },
    });
    return {
      outcome: results.failed ? ("degraded" as const) : ("succeeded" as const),
      connectionId: connection.externalId,
      disconnected,
      ...results,
    };
  }
}

export function getCalendarAdministrationService() {
  return new CalendarAdministrationService(
    new PrismaCalendarSyncRepository(getPrismaClient()),
    getRateLimitService(),
  );
}

export function getCalendarSynchronizationService() {
  let credentials: CalendarCredentialResolver;
  try {
    credentials = configuredCalendarCredentialResolver();
  } catch {
    throw new CalendarSyncError(
      "CONFIGURATION_ERROR",
      500,
      "Calendar synchronization is not configured.",
    );
  }
  return new CalendarSynchronizationService(
    new PrismaCalendarSyncRepository(getPrismaClient()),
    credentials,
  );
}
