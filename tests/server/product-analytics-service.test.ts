import { ProductAnalyticsConsentStatus } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  PRODUCT_ANALYTICS_POLICY_VERSION,
  PRODUCT_ANALYTICS_SCHEMA_VERSION,
} from "@/domain/product-analytics";
import {
  ProductAnalyticsService,
  type ProductAnalyticsSink,
} from "@/server/app/product-analytics-service";
import { trustedActorForTest } from "../fixtures/trusted-actor";

const current = new Date("2026-07-31T17:30:00.000Z");
const future = new Date("2027-01-01T00:00:00.000Z");
const event = {
  schemaVersion: PRODUCT_ANALYTICS_SCHEMA_VERSION,
  name: "scoring.submission_succeeded",
  workflow: "LIVE_SCORING",
  result: "SUCCEEDED",
  eventFamily: "RUNNER_MOVEMENT",
  durationBucket: "UNDER_1_S",
  failureCategory: null,
} as const;

const actor = () =>
  trustedActorForTest({
    accountId: "account-a",
    actorId: "user-a",
    actorKind: "USER",
    actorUserId: "user-a",
    capability: "account.view",
    scope: { kind: "ACCOUNT" },
    authorizedAt: current.toISOString(),
  });

describe("consent-aware product analytics service", () => {
  it("fails closed for absent, opted-out, expired, or old-policy consent", async () => {
    const emit = vi.fn();
    for (const preference of [
      null,
      {
        status: ProductAnalyticsConsentStatus.OPTED_OUT,
        policyVersion: PRODUCT_ANALYTICS_POLICY_VERSION,
        expiresAt: null,
      },
      {
        status: ProductAnalyticsConsentStatus.OPTED_IN,
        policyVersion: PRODUCT_ANALYTICS_POLICY_VERSION,
        expiresAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      {
        status: ProductAnalyticsConsentStatus.OPTED_IN,
        policyVersion: "old-policy",
        expiresAt: future,
      },
    ]) {
      const service = new ProductAnalyticsService(
        {
          preference: vi.fn().mockResolvedValue(preference),
        } as never,
        { emit } as ProductAnalyticsSink,
      );
      await expect(service.emitForUser("user-a", event, current)).resolves.toBe(
        false,
      );
    }
    expect(emit).not.toHaveBeenCalled();
  });

  it("emits the validated anonymous observation only with current opt-in", async () => {
    const emit = vi.fn();
    const service = new ProductAnalyticsService(
      {
        preference: vi.fn().mockResolvedValue({
          status: ProductAnalyticsConsentStatus.OPTED_IN,
          policyVersion: PRODUCT_ANALYTICS_POLICY_VERSION,
          expiresAt: future,
        }),
      } as never,
      { emit } as ProductAnalyticsSink,
    );
    await expect(service.emitForUser("user-a", event, current)).resolves.toBe(
      true,
    );
    expect(emit).toHaveBeenCalledWith({
      ...event,
      occurredAt: current.toISOString(),
    });
    expect(JSON.stringify(emit.mock.calls)).not.toContain("user-a");
  });

  it("records expiring opt-in, permanent opt-out, and explicit deletion", async () => {
    const recordPreference = vi.fn((input) => ({
      ...input,
      updatedAt: current,
    }));
    const deletePreference = vi.fn();
    const service = new ProductAnalyticsService({
      preference: vi.fn(),
      recordPreference,
      deletePreference,
    } as never);
    await service.setPreference(
      { accountId: "account-a", status: "OPTED_IN" },
      actor(),
      current,
    );
    expect(recordPreference).toHaveBeenLastCalledWith(
      expect.objectContaining({
        appUserId: "user-a",
        status: ProductAnalyticsConsentStatus.OPTED_IN,
        policyVersion: PRODUCT_ANALYTICS_POLICY_VERSION,
        expiresAt: new Date("2027-07-31T17:30:00.000Z"),
      }),
    );
    await service.setPreference(
      { accountId: "account-a", status: "OPTED_OUT" },
      actor(),
      current,
    );
    expect(recordPreference).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: ProductAnalyticsConsentStatus.OPTED_OUT,
        expiresAt: null,
      }),
    );
    await service.deletePreference("account-a", actor());
    expect(deletePreference).toHaveBeenCalledWith("user-a");
  });
});
