import { performance } from "node:perf_hooks";

import { z } from "zod";

import {
  NotificationProviderError,
  notificationPreferenceInputSchema,
  renderNotificationMessage,
  type NotificationDestinationResolver,
  type NotificationTransport,
} from "@/domain/notifications";
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
  PrismaNotificationRepository,
  type ClaimedNotificationDelivery,
} from "@/server/data/notification-repository";
import { getPrismaClient } from "@/server/data/prisma";
import { featureEnabled } from "@/server/config/feature-flags";
import {
  emitOperationalEvent,
  getOperationalEventSink,
  type OperationalEventSink,
} from "@/server/observability/operational-events";
import {
  ConfiguredNotificationDestinationResolver,
  ConfiguredNotificationTransport,
  type SmtpConfiguration,
} from "@/server/providers/outbound-notifications";

const id = z.string().trim().min(1).max(128);
const externalId = z.uuid();
const reasonCode = z
  .string()
  .trim()
  .regex(/^[A-Z][A-Z0-9_]{2,63}$/u);
const workerId = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u);

type NotificationRepository = Pick<
  PrismaNotificationRepository,
  | "configurePreference"
  | "listPreferences"
  | "listOwnPreferences"
  | "listDeliveries"
  | "disablePreference"
  | "optOut"
  | "claimDue"
  | "preferenceIsActive"
  | "cancelClaim"
  | "completeAttempt"
  | "publishOperationalFailure"
>;

export class NotificationError extends Error {
  constructor(
    readonly code:
      | "INVALID_REQUEST"
      | "RESOURCE_UNAVAILABLE"
      | "RECIPIENT_OPTED_OUT"
      | "CONFIGURATION_ERROR",
    readonly status: 400 | 404 | 409 | 500,
    message: string,
  ) {
    super(message);
    this.name = "NotificationError";
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

function recipient(
  actorInput: TrustedActorContext,
  accountId: string,
): TrustedActorContext & { membershipId: string } {
  const actor = requireTrustedActor(actorInput, accountId, "account.view");
  if (
    actor.target.kind !== "ACCOUNT" ||
    actor.actorKind !== "USER" ||
    !actor.membershipId
  ) {
    throw new AuthorizationError("AUTHORIZATION_REQUIRED");
  }
  return actor as TrustedActorContext & { membershipId: string };
}

export class NotificationAdministrationService {
  constructor(
    private readonly repository: NotificationRepository,
    private readonly destinations: NotificationDestinationResolver,
    private readonly rateLimits: RateLimitEnforcer = noRateLimit,
  ) {}

  async configure(input: unknown, actorInput: TrustedActorContext) {
    const parsed = notificationPreferenceInputSchema.parse(input);
    const actor = administrator(actorInput, parsed.accountId);
    await this.rateLimits.enforce(
      { accountId: parsed.accountId, endpointClass: "ADMINISTRATION" },
      actor,
    );
    try {
      this.destinations.resolve(parsed.destinationReference, parsed.channel);
    } catch {
      throw new NotificationError(
        "RESOURCE_UNAVAILABLE",
        404,
        "The managed notification destination is unavailable.",
      );
    }
    const result = await this.repository.configurePreference({
      ...parsed,
      sensitiveContent: false,
      actor,
    });
    if (!result) {
      throw new NotificationError(
        "RESOURCE_UNAVAILABLE",
        404,
        "The notification recipient or team is unavailable.",
      );
    }
    if (result.outcome === "opted_out") {
      throw new NotificationError(
        "RECIPIENT_OPTED_OUT",
        409,
        "The recipient has opted out of notifications.",
      );
    }
    return {
      preferenceId: result.preference.externalId,
      status: result.preference.status,
    };
  }

  async list(accountId: string, actorInput: TrustedActorContext) {
    administrator(actorInput, accountId);
    return this.repository.listPreferences(accountId);
  }

  async history(
    accountId: string,
    preferenceId: string | undefined,
    actorInput: TrustedActorContext,
  ) {
    administrator(actorInput, accountId);
    return this.repository.listDeliveries(accountId, preferenceId);
  }

  async disable(input: unknown, actorInput: TrustedActorContext) {
    const parsed = z
      .object({
        accountId: id,
        preferenceId: externalId,
        reasonCode,
      })
      .strict()
      .parse(input);
    const actor = administrator(actorInput, parsed.accountId);
    await this.rateLimits.enforce(
      { accountId: parsed.accountId, endpointClass: "ADMINISTRATION" },
      actor,
    );
    if (
      !(await this.repository.disablePreference({
        accountId: parsed.accountId,
        preferenceExternalId: parsed.preferenceId,
        reasonCode: parsed.reasonCode,
        actor,
        disabledAt: new Date(),
      }))
    ) {
      throw new NotificationError(
        "RESOURCE_UNAVAILABLE",
        404,
        "The notification preference is unavailable.",
      );
    }
  }
}

export class NotificationPreferenceService {
  constructor(private readonly repository: NotificationRepository) {}

  async list(accountId: string, actorInput: TrustedActorContext) {
    const actor = recipient(actorInput, accountId);
    return this.repository.listOwnPreferences(accountId, actor.membershipId);
  }

  async optOut(accountId: string, actorInput: TrustedActorContext) {
    const actor = recipient(actorInput, accountId);
    return {
      optedOut: await this.repository.optOut({
        accountId,
        membershipId: actor.membershipId,
        actor,
        optedOutAt: new Date(),
      }),
    };
  }
}

export class NotificationDeliveryService {
  constructor(
    private readonly repository: NotificationRepository,
    private readonly destinations: NotificationDestinationResolver,
    private readonly transport: NotificationTransport,
    private readonly events: OperationalEventSink = getOperationalEventSink(),
  ) {}

  async deliverBatch(workerInput: string, now = new Date(), limit = 25) {
    const parsedWorkerId = workerId.parse(workerInput);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new NotificationError(
        "INVALID_REQUEST",
        400,
        "The notification delivery limit is invalid.",
      );
    }
    const deliveries = await this.repository.claimDue(
      parsedWorkerId,
      now,
      limit,
    );
    const results = [];
    for (const delivery of deliveries) {
      results.push(await this.deliverOne(delivery, parsedWorkerId));
    }
    return results;
  }

  private async deliverOne(
    delivery: ClaimedNotificationDelivery,
    currentWorkerId: string,
  ) {
    if (
      !(await this.repository.preferenceIsActive(
        delivery.accountId,
        delivery.preferenceId,
      ))
    ) {
      await this.repository.cancelClaim({
        accountId: delivery.accountId,
        deliveryId: delivery.id,
        workerId: currentWorkerId,
        cancelledAt: new Date(),
        failureCode: "PREFERENCE_INACTIVE",
      });
      return {
        deliveryId: delivery.externalId,
        outcome: "cancelled" as const,
      };
    }

    const startedAt = new Date();
    const started = performance.now();
    let responseStatus: number | null = null;
    let failureCode: string | null = null;
    let succeeded = false;
    let terminal = false;
    try {
      const destination = this.destinations.resolve(
        delivery.destinationReference,
        delivery.channel,
      );
      const message = renderNotificationMessage(
        delivery.event.eventName,
        delivery.event.payload,
      );
      const response = await this.transport.send({
        channel: delivery.channel,
        destination: destination.destination,
        idempotencyKey: delivery.externalId,
        message,
        timeoutMs: 10_000,
      });
      responseStatus = response.status;
      succeeded = true;
    } catch (error) {
      if (error instanceof NotificationProviderError) {
        failureCode = error.code;
        responseStatus = error.responseStatus;
        terminal = !error.retryable;
      } else {
        failureCode = "PROVIDER_UNAVAILABLE";
      }
    }
    const completedAt = new Date();
    const durationMs = Math.max(0, Math.round(performance.now() - started));
    const result = await this.repository.completeAttempt({
      accountId: delivery.accountId,
      deliveryId: delivery.id,
      workerId: currentWorkerId,
      startedAt,
      completedAt,
      durationMs,
      responseStatus,
      failureCode,
      succeeded,
      terminal,
    });
    emitOperationalEvent(this.events, {
      severity: succeeded
        ? "info"
        : result?.status === "DEAD_LETTER"
          ? "warning"
          : "info",
      category: "background_job",
      name: "notification_delivery",
      outcome: succeeded
        ? "succeeded"
        : result?.status === "DEAD_LETTER"
          ? "failed"
          : "degraded",
      accountId: delivery.accountId,
      ...(failureCode ? { code: failureCode } : {}),
      durationMs,
      metadata: {
        channel: delivery.channel,
        eventType: delivery.event.eventName,
        attemptNumber: delivery.attemptCount + 1,
      },
    });
    return {
      deliveryId: delivery.externalId,
      outcome: succeeded
        ? ("succeeded" as const)
        : result?.status === "DEAD_LETTER"
          ? ("dead_letter" as const)
          : ("retry" as const),
    };
  }
}

export class NotificationEventPublicationService {
  constructor(private readonly repository: NotificationRepository) {}

  async operationalFailure(input: unknown) {
    const parsed = z
      .object({
        accountId: id,
        service: z
          .string()
          .trim()
          .regex(/^[a-z][a-z0-9._-]{2,63}$/u),
        failureCode: reasonCode,
        correlationId: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u),
        severity: z.enum(["WARNING", "CRITICAL"]),
        teamId: externalId.optional(),
        occurredAt: z.iso.datetime().optional(),
      })
      .strict()
      .parse(input);
    const event = await this.repository.publishOperationalFailure({
      accountId: parsed.accountId,
      service: parsed.service,
      failureCode: parsed.failureCode,
      correlationId: parsed.correlationId,
      severity: parsed.severity,
      ...(parsed.teamId ? { teamId: parsed.teamId } : {}),
      occurredAt: parsed.occurredAt ? new Date(parsed.occurredAt) : new Date(),
    });
    return { eventId: event.externalId };
  }
}

function configuredProviders() {
  try {
    const emailEnabled = featureEnabled("FEATURE_EMAIL_NOTIFICATIONS_ENABLED");
    const discordEnabled = featureEnabled(
      "FEATURE_DISCORD_NOTIFICATIONS_ENABLED",
    );
    const enabledChannels = [
      ...(emailEnabled ? (["EMAIL"] as const) : []),
      ...(discordEnabled ? (["DISCORD"] as const) : []),
    ];
    const destinations = process.env.NOTIFICATION_DESTINATIONS_JSON ?? "{}";
    let smtp: SmtpConfiguration | null = null;
    if (emailEnabled) {
      smtp = z
        .object({
          host: z.string().trim().min(1),
          port: z.coerce.number().int().min(1).max(65_535),
          secure: z
            .string()
            .trim()
            .toLowerCase()
            .transform((value) => value === "true"),
          username: z.string().min(1),
          password: z.string().min(1),
          from: z.email(),
        })
        .parse({
          host: process.env.SMTP_HOST,
          port: process.env.SMTP_PORT ?? "587",
          secure: process.env.SMTP_SECURE ?? "false",
          username: process.env.SMTP_USERNAME,
          password: process.env.SMTP_PASSWORD,
          from: process.env.SMTP_FROM,
        });
    }
    const discordToken = process.env.NOTIFICATION_DISCORD_BOT_TOKEN;
    if (discordEnabled && !discordToken)
      throw new Error("Discord is unconfigured.");
    return {
      destinations: new ConfiguredNotificationDestinationResolver(
        destinations,
        enabledChannels,
      ),
      transport: new ConfiguredNotificationTransport({
        smtp,
        discord: discordEnabled
          ? {
              apiBase:
                process.env.NOTIFICATION_DISCORD_API_BASE_URL ??
                "https://discord.com/api/v10/",
              token: discordToken!,
            }
          : null,
      }),
    };
  } catch {
    throw new NotificationError(
      "CONFIGURATION_ERROR",
      500,
      "Notification delivery is unavailable.",
    );
  }
}

export function getNotificationAdministrationService() {
  const providers = configuredProviders();
  return new NotificationAdministrationService(
    new PrismaNotificationRepository(getPrismaClient()),
    providers.destinations,
    getRateLimitService(),
  );
}

export function getNotificationPreferenceService() {
  return new NotificationPreferenceService(
    new PrismaNotificationRepository(getPrismaClient()),
  );
}

export function getNotificationDeliveryService() {
  const providers = configuredProviders();
  return new NotificationDeliveryService(
    new PrismaNotificationRepository(getPrismaClient()),
    providers.destinations,
    providers.transport,
  );
}

export function getNotificationEventPublicationService() {
  return new NotificationEventPublicationService(
    new PrismaNotificationRepository(getPrismaClient()),
  );
}
