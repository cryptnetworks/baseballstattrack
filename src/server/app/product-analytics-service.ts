import { ProductAnalyticsConsentStatus } from "@prisma/client";
import { z } from "zod";

import {
  PRODUCT_ANALYTICS_CONSENT_DAYS,
  PRODUCT_ANALYTICS_POLICY_VERSION,
  parseProductAnalyticsEvent,
  type ProductAnalyticsEvent,
  type ProductAnalyticsObservation,
} from "@/domain/product-analytics";
import {
  requireTrustedActor,
  type TrustedActorContext,
} from "@/server/auth/types";
import { getPrismaClient } from "@/server/data/prisma";
import { PrismaProductAnalyticsRepository } from "@/server/data/product-analytics-repository";

type ProductAnalyticsRepository = Pick<
  PrismaProductAnalyticsRepository,
  "preference" | "recordPreference" | "deletePreference"
>;

export interface ProductAnalyticsSink {
  emit(event: ProductAnalyticsObservation): void;
}

class StandardOutputProductAnalyticsSink implements ProductAnalyticsSink {
  emit(event: ProductAnalyticsObservation): void {
    process.stdout.write(
      `${JSON.stringify({ category: "product_analytics", ...event })}\n`,
    );
  }
}

let defaultSink: ProductAnalyticsSink | undefined;

export function getProductAnalyticsSink() {
  defaultSink ??= new StandardOutputProductAnalyticsSink();
  return defaultSink;
}

const statusSchema = z.enum(["OPTED_IN", "OPTED_OUT"]);

function userActor(actor: TrustedActorContext, accountId: string) {
  const trusted = requireTrustedActor(actor, accountId, "account.view");
  if (
    trusted.actorKind !== "USER" ||
    trusted.actorUserId !== trusted.appUserId
  ) {
    throw new Error("Product analytics preferences require a current user.");
  }
  return trusted;
}

export class ProductAnalyticsService {
  constructor(
    private readonly repository: ProductAnalyticsRepository,
    private readonly sink: ProductAnalyticsSink = getProductAnalyticsSink(),
  ) {}

  async preference(accountId: string, actorInput: TrustedActorContext) {
    const actor = userActor(actorInput, accountId);
    const preference = await this.repository.preference(actor.appUserId);
    const effectiveOptIn = Boolean(
      preference?.status === ProductAnalyticsConsentStatus.OPTED_IN &&
      preference.policyVersion === PRODUCT_ANALYTICS_POLICY_VERSION &&
      preference.expiresAt &&
      preference.expiresAt > new Date(),
    );
    return {
      status: preference?.status ?? "NOT_SET",
      policyVersion: PRODUCT_ANALYTICS_POLICY_VERSION,
      effectiveOptIn,
      expiresAt: preference?.expiresAt ?? null,
      updatedAt: preference?.updatedAt ?? null,
    };
  }

  async setPreference(
    input: { accountId: string; status: "OPTED_IN" | "OPTED_OUT" },
    actorInput: TrustedActorContext,
    changedAt = new Date(),
  ) {
    const actor = userActor(actorInput, input.accountId);
    const status = statusSchema.parse(input.status);
    const expiresAt =
      status === "OPTED_IN"
        ? new Date(
            changedAt.getTime() +
              PRODUCT_ANALYTICS_CONSENT_DAYS * 24 * 60 * 60 * 1_000,
          )
        : null;
    return this.repository.recordPreference({
      appUserId: actor.appUserId,
      status: ProductAnalyticsConsentStatus[status],
      policyVersion: PRODUCT_ANALYTICS_POLICY_VERSION,
      changedAt,
      expiresAt,
    });
  }

  async deletePreference(accountId: string, actorInput: TrustedActorContext) {
    const actor = userActor(actorInput, accountId);
    await this.repository.deletePreference(actor.appUserId);
  }

  async emitForUser(
    appUserId: string,
    eventInput: ProductAnalyticsEvent,
    occurredAt = new Date(),
  ): Promise<boolean> {
    try {
      const preference = await this.repository.preference(appUserId);
      if (
        preference?.status !== ProductAnalyticsConsentStatus.OPTED_IN ||
        preference.policyVersion !== PRODUCT_ANALYTICS_POLICY_VERSION ||
        !preference.expiresAt ||
        preference.expiresAt <= occurredAt
      ) {
        return false;
      }
      const event = parseProductAnalyticsEvent(eventInput);
      this.sink.emit({ ...event, occurredAt: occurredAt.toISOString() });
      return true;
    } catch {
      return false;
    }
  }
}

export function getProductAnalyticsService() {
  return new ProductAnalyticsService(
    new PrismaProductAnalyticsRepository(getPrismaClient()),
  );
}
