import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { performance } from "node:perf_hooks";

import { z } from "zod";

import {
  createWebhookSecretDeriver,
  generateWebhookChallenge,
  parseWebhookEndpointUrl,
  serializeWebhookEnvelope,
  webhookEventNames,
  webhookPublicEventNames,
  webhookSignature,
  type WebhookSecretDeriver,
} from "@/domain/webhooks";
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
  PrismaWebhookRepository,
  type ClaimedWebhookDelivery,
} from "@/server/data/webhook-repository";
import { runtimeSecretConfiguration } from "@/server/config/runtime-environment";
import { getPrismaClient } from "@/server/data/prisma";
import {
  emitOperationalEvent,
  getOperationalEventSink,
  type OperationalEventSink,
} from "@/server/observability/operational-events";

const id = z.string().trim().min(1).max(128);
const externalId = z.uuid();
const reasonCode = z
  .string()
  .trim()
  .regex(/^[A-Z][A-Z0-9_]{2,63}$/u);

export class WebhookError extends Error {
  constructor(
    readonly code:
      | "INVALID_REQUEST"
      | "RESOURCE_UNAVAILABLE"
      | "VERIFICATION_FAILED"
      | "CONFIGURATION_ERROR",
    readonly status: 400 | 404 | 409 | 500,
    message: string,
  ) {
    super(message);
    this.name = "WebhookError";
  }
}

export type WebhookTransportResponse = Readonly<{
  status: number;
  headers: Readonly<Record<string, string>>;
}>;

export interface WebhookTransport {
  post(input: {
    url: string;
    body: string;
    headers: Readonly<Record<string, string>>;
    timeoutMs: number;
  }): Promise<WebhookTransportResponse>;
}

function publicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a = 0, b = 0] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  const normalized = address.toLowerCase();
  return !(
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/u.test(normalized) ||
    normalized.startsWith("::ffff:")
  );
}

export class HttpsWebhookTransport implements WebhookTransport {
  async post(input: {
    url: string;
    body: string;
    headers: Readonly<Record<string, string>>;
    timeoutMs: number;
  }): Promise<WebhookTransportResponse> {
    const url = new URL(parseWebhookEndpointUrl(input.url));
    const addresses = await lookup(url.hostname, { all: true, verbatim: true });
    if (
      !addresses.length ||
      addresses.some(({ address }) => !publicAddress(address))
    ) {
      throw new Error("ENDPOINT_ADDRESS_UNAVAILABLE");
    }
    const selected = addresses[0]!;
    return new Promise((resolve, reject) => {
      const request = httpsRequest(
        url,
        {
          method: "POST",
          headers: {
            ...input.headers,
            "Content-Length": Buffer.byteLength(input.body),
          },
          lookup: (_hostname, _options, callback) => {
            callback(null, selected.address, selected.family);
          },
          servername: url.hostname,
          timeout: input.timeoutMs,
        },
        (response) => {
          response.resume();
          response.on("end", () => {
            clearTimeout(timer);
            resolve({
              status: response.statusCode ?? 0,
              headers: Object.fromEntries(
                Object.entries(response.headers)
                  .filter(
                    (entry): entry is [string, string | string[]] =>
                      Array.isArray(entry[1]) || typeof entry[1] === "string",
                  )
                  .map(([key, value]) => [
                    key.toLowerCase(),
                    Array.isArray(value) ? value.join(",") : value,
                  ]),
              ),
            });
          });
          response.once("error", (error) => {
            clearTimeout(timer);
            reject(error);
          });
        },
      );
      const timer = setTimeout(
        () => request.destroy(new Error("ENDPOINT_TIMEOUT")),
        input.timeoutMs,
      );
      request.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      request.end(input.body);
    });
  }
}

type WebhookRepository = Pick<
  PrismaWebhookRepository,
  | "createEndpoint"
  | "listEndpoints"
  | "listDeliveries"
  | "resolveEndpoint"
  | "activateEndpoint"
  | "rotateSecret"
  | "revokeEndpoint"
  | "replayDelivery"
  | "claimDue"
  | "endpointIsActive"
  | "completeAttempt"
>;

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

export class WebhookAdministrationService {
  constructor(
    private readonly repository: WebhookRepository,
    private readonly secrets: WebhookSecretDeriver,
    private readonly transport: WebhookTransport,
    private readonly rateLimits: RateLimitEnforcer = noRateLimit,
  ) {}

  async create(input: unknown, actorInput: TrustedActorContext) {
    const parsed = z
      .object({
        accountId: id,
        url: z.string().trim().min(1).max(2_048),
        subscribedEvents: z
          .array(z.enum(webhookEventNames))
          .min(1)
          .max(webhookEventNames.length),
      })
      .strict()
      .parse(input);
    const actor = administrator(actorInput, parsed.accountId);
    await this.rateLimits.enforce(
      { accountId: parsed.accountId, endpointClass: "WEBHOOK_ADMINISTRATION" },
      actor,
    );
    let url: string;
    try {
      url = parseWebhookEndpointUrl(parsed.url);
    } catch {
      throw new WebhookError(
        "INVALID_REQUEST",
        400,
        "The webhook endpoint is invalid.",
      );
    }
    const endpoint = await this.repository.createEndpoint({
      accountId: parsed.accountId,
      url,
      subscribedEvents: [...new Set(parsed.subscribedEvents)],
      actor,
    });
    return {
      endpointId: endpoint.externalId,
      status: endpoint.status,
      secretVersion: endpoint.secretVersion,
      signingSecret: this.secrets.derive(endpoint.id, endpoint.secretVersion),
    };
  }

  async list(accountId: string, actorInput: TrustedActorContext) {
    administrator(actorInput, accountId);
    return this.repository.listEndpoints(accountId);
  }

  async history(
    accountId: string,
    endpointExternalId: string,
    actorInput: TrustedActorContext,
  ) {
    administrator(actorInput, accountId);
    const endpoint = await this.repository.resolveEndpoint(
      accountId,
      externalId.parse(endpointExternalId),
    );
    if (!endpoint) {
      throw new WebhookError(
        "RESOURCE_UNAVAILABLE",
        404,
        "The webhook endpoint is unavailable.",
      );
    }
    return this.repository.listDeliveries(accountId, endpoint.id);
  }

  async verify(input: unknown, actorInput: TrustedActorContext) {
    const parsed = z
      .object({ accountId: id, endpointId: externalId })
      .strict()
      .parse(input);
    const actor = administrator(actorInput, parsed.accountId);
    await this.rateLimits.enforce(
      { accountId: parsed.accountId, endpointClass: "WEBHOOK_ADMINISTRATION" },
      actor,
    );
    const endpoint = await this.repository.resolveEndpoint(
      parsed.accountId,
      parsed.endpointId,
    );
    if (!endpoint || endpoint.status !== "PENDING_VERIFICATION") {
      throw new WebhookError(
        "RESOURCE_UNAVAILABLE",
        404,
        "The webhook endpoint is unavailable.",
      );
    }
    const challenge = generateWebhookChallenge();
    const timestamp = Math.floor(Date.now() / 1_000);
    const body = JSON.stringify({
      type: "endpoint.verification",
      version: 1,
      endpointId: endpoint.externalId,
      challenge,
    });
    let response: WebhookTransportResponse;
    try {
      response = await this.transport.post({
        url: endpoint.url,
        body,
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "BaseballStatTrack-Webhooks/1",
          "Webhook-Timestamp": String(timestamp),
          "Webhook-Signature": webhookSignature(
            this.secrets.derive(endpoint.id, endpoint.secretVersion),
            timestamp,
            body,
          ),
          "Webhook-Verification": "v1",
        },
        timeoutMs: 5_000,
      });
    } catch {
      throw new WebhookError(
        "VERIFICATION_FAILED",
        409,
        "Webhook endpoint verification failed.",
      );
    }
    if (
      response.status < 200 ||
      response.status >= 300 ||
      response.headers["x-webhook-challenge"] !== challenge
    ) {
      throw new WebhookError(
        "VERIFICATION_FAILED",
        409,
        "Webhook endpoint verification failed.",
      );
    }
    const activated = await this.repository.activateEndpoint({
      accountId: parsed.accountId,
      endpointId: endpoint.id,
      actor,
      verifiedAt: new Date(),
    });
    if (!activated) {
      throw new WebhookError(
        "RESOURCE_UNAVAILABLE",
        404,
        "The webhook endpoint is unavailable.",
      );
    }
    return { endpointId: activated.externalId, status: activated.status };
  }

  async rotate(input: unknown, actorInput: TrustedActorContext) {
    const parsed = z
      .object({ accountId: id, endpointId: externalId })
      .strict()
      .parse(input);
    const actor = administrator(actorInput, parsed.accountId);
    await this.rateLimits.enforce(
      { accountId: parsed.accountId, endpointClass: "WEBHOOK_ADMINISTRATION" },
      actor,
    );
    const endpoint = await this.repository.resolveEndpoint(
      parsed.accountId,
      parsed.endpointId,
    );
    if (!endpoint)
      throw new WebhookError(
        "RESOURCE_UNAVAILABLE",
        404,
        "The webhook endpoint is unavailable.",
      );
    const rotated = await this.repository.rotateSecret({
      accountId: parsed.accountId,
      endpointId: endpoint.id,
      actor,
    });
    if (!rotated)
      throw new WebhookError(
        "RESOURCE_UNAVAILABLE",
        404,
        "The webhook endpoint is unavailable.",
      );
    return {
      endpointId: rotated.externalId,
      secretVersion: rotated.secretVersion,
      signingSecret: this.secrets.derive(rotated.id, rotated.secretVersion),
    };
  }

  async revoke(input: unknown, actorInput: TrustedActorContext) {
    const parsed = z
      .object({ accountId: id, endpointId: externalId, reasonCode })
      .strict()
      .parse(input);
    const actor = administrator(actorInput, parsed.accountId);
    await this.rateLimits.enforce(
      { accountId: parsed.accountId, endpointClass: "WEBHOOK_ADMINISTRATION" },
      actor,
    );
    const endpoint = await this.repository.resolveEndpoint(
      parsed.accountId,
      parsed.endpointId,
    );
    if (!endpoint)
      throw new WebhookError(
        "RESOURCE_UNAVAILABLE",
        404,
        "The webhook endpoint is unavailable.",
      );
    const revoked = await this.repository.revokeEndpoint({
      accountId: parsed.accountId,
      endpointId: endpoint.id,
      actor,
      reasonCode: parsed.reasonCode,
      revokedAt: new Date(),
    });
    if (!revoked)
      throw new WebhookError(
        "RESOURCE_UNAVAILABLE",
        404,
        "The webhook endpoint is unavailable.",
      );
  }

  async replay(input: unknown, actorInput: TrustedActorContext) {
    const parsed = z
      .object({ accountId: id, endpointId: externalId, eventId: externalId })
      .strict()
      .parse(input);
    const actor = administrator(actorInput, parsed.accountId);
    await this.rateLimits.enforce(
      { accountId: parsed.accountId, endpointClass: "WEBHOOK_ADMINISTRATION" },
      actor,
    );
    const endpoint = await this.repository.resolveEndpoint(
      parsed.accountId,
      parsed.endpointId,
    );
    if (!endpoint)
      throw new WebhookError(
        "RESOURCE_UNAVAILABLE",
        404,
        "The webhook endpoint is unavailable.",
      );
    const delivery = await this.repository.replayDelivery({
      accountId: parsed.accountId,
      endpointId: endpoint.id,
      eventExternalId: parsed.eventId,
      actor,
      requestedAt: new Date(),
    });
    if (!delivery)
      throw new WebhookError(
        "RESOURCE_UNAVAILABLE",
        404,
        "The webhook event is unavailable.",
      );
    return {
      deliveryId: delivery.externalId,
      replayNumber: delivery.replayNumber,
    };
  }
}

function safeFailureCode(error: unknown): string {
  if (error instanceof Error && /^[A-Z][A-Z0-9_]{2,63}$/u.test(error.message)) {
    return error.message;
  }
  return "ENDPOINT_FAILURE";
}

export class WebhookDeliveryService {
  constructor(
    private readonly repository: WebhookRepository,
    private readonly secrets: WebhookSecretDeriver,
    private readonly transport: WebhookTransport,
    private readonly events: OperationalEventSink = getOperationalEventSink(),
  ) {}

  async deliverBatch(workerId: string, now = new Date(), limit = 25) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u.test(workerId)) {
      throw new WebhookError(
        "INVALID_REQUEST",
        400,
        "The worker identity is invalid.",
      );
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new WebhookError(
        "INVALID_REQUEST",
        400,
        "The delivery limit is invalid.",
      );
    }
    const deliveries = await this.repository.claimDue(workerId, now, limit);
    const results = [];
    for (const delivery of deliveries) {
      results.push(await this.deliverOne(delivery, workerId));
    }
    return results;
  }

  private async deliverOne(delivery: ClaimedWebhookDelivery, workerId: string) {
    if (
      !(await this.repository.endpointIsActive(
        delivery.accountId,
        delivery.endpointId,
      ))
    ) {
      return { deliveryId: delivery.externalId, outcome: "cancelled" as const };
    }
    const timestamp = Math.floor(Date.now() / 1_000);
    const body = serializeWebhookEnvelope({
      id: delivery.event.externalId,
      deliveryId: delivery.externalId,
      accountId: delivery.account.externalId,
      sequence: delivery.event.sequence.toString(),
      type: webhookPublicEventNames[delivery.event.eventName],
      version: 1,
      occurredAt: delivery.event.occurredAt.toISOString(),
      replay: delivery.replayNumber > 0,
      data: delivery.event.payload as Record<string, unknown>,
    });
    const startedAt = new Date();
    const started = performance.now();
    let responseStatus: number | null = null;
    let failureCode: string | null = null;
    let succeeded = false;
    let terminal = false;
    try {
      const response = await this.transport.post({
        url: delivery.endpoint.url,
        body,
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "BaseballStatTrack-Webhooks/1",
          "Webhook-Id": delivery.event.externalId,
          "Webhook-Delivery-Id": delivery.externalId,
          "Webhook-Timestamp": String(timestamp),
          "Webhook-Signature": webhookSignature(
            this.secrets.derive(delivery.endpoint.id, delivery.secretVersion),
            timestamp,
            body,
          ),
        },
        timeoutMs: 10_000,
      });
      responseStatus = response.status;
      succeeded = response.status >= 200 && response.status < 300;
      terminal =
        !succeeded &&
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 408 &&
        response.status !== 429;
      if (!succeeded) failureCode = `HTTP_${response.status}`;
    } catch (error) {
      failureCode = safeFailureCode(error);
    }
    const completedAt = new Date();
    const result = await this.repository.completeAttempt({
      accountId: delivery.accountId,
      deliveryId: delivery.id,
      workerId,
      startedAt,
      completedAt,
      durationMs: Math.max(0, Math.round(performance.now() - started)),
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
      name: "webhook_delivery",
      outcome: succeeded
        ? "succeeded"
        : result?.status === "DEAD_LETTER"
          ? "failed"
          : "degraded",
      accountId: delivery.accountId,
      ...(failureCode ? { code: failureCode } : {}),
      durationMs: Math.max(0, Math.round(performance.now() - started)),
      metadata: {
        eventType: webhookPublicEventNames[delivery.event.eventName],
        attemptNumber: delivery.attemptCount + 1,
        replay: delivery.replayNumber > 0,
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

function signingSecrets(): WebhookSecretDeriver {
  const key = runtimeSecretConfiguration().webhookSigningMasterKey;
  if (!key)
    throw new WebhookError(
      "CONFIGURATION_ERROR",
      500,
      "Webhook signing is unavailable.",
    );
  return createWebhookSecretDeriver(key);
}

export function getWebhookAdministrationService() {
  return new WebhookAdministrationService(
    new PrismaWebhookRepository(getPrismaClient()),
    signingSecrets(),
    new HttpsWebhookTransport(),
    getRateLimitService(),
  );
}

export function getWebhookDeliveryService() {
  return new WebhookDeliveryService(
    new PrismaWebhookRepository(getPrismaClient()),
    signingSecrets(),
    new HttpsWebhookTransport(),
  );
}
