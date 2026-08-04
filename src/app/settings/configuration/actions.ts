"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  ApplicationConfigurationError,
  getApplicationConfigurationService,
} from "@/server/app/application-configuration-service";
import { getAuthorizationService } from "@/server/auth/application";
import { AuthorizationError } from "@/server/auth/errors";
import { authenticatePageSession } from "@/server/auth/next-session";
import { authorizeProtectedAction } from "@/server/auth/protected-boundary";
import { selectedAccountCookie } from "@/server/auth/request-security";

const id = z.string().trim().min(1).max(128);

export type ConfigurationPreviewState = Readonly<{
  outcome: "idle" | "valid" | "invalid";
  message: string;
  digest: string | null;
  changedCategories: readonly string[];
}>;

async function authorize(accountId: string) {
  const requestHeaders = await headers();
  if ((await cookies()).get(selectedAccountCookie.name)?.value !== accountId) {
    throw new AuthorizationError("ACCOUNT_UNAVAILABLE");
  }
  return authorizeProtectedAction({
    origin: requestHeaders.get("origin"),
    host: requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"),
    authenticate: authenticatePageSession,
    authorization: getAuthorizationService(),
    target: { kind: "ACCOUNT", accountId },
    capability: "configuration.manage",
  });
}

function values(formData: FormData) {
  const service = getApplicationConfigurationService();
  return service.parseValues({
    features: JSON.parse(z.string().parse(formData.get("FEATURES"))),
    calendar: JSON.parse(z.string().parse(formData.get("CALENDAR"))),
    notifications: JSON.parse(z.string().parse(formData.get("NOTIFICATIONS"))),
    integrations: JSON.parse(z.string().parse(formData.get("INTEGRATIONS"))),
    rateLimits: JSON.parse(z.string().parse(formData.get("RATE_LIMITS"))),
  });
}

function safeError(error: unknown) {
  if (error instanceof z.ZodError || error instanceof SyntaxError) {
    return "Configuration is invalid. Review every category and try again.";
  }
  if (error instanceof AuthorizationError) {
    return "Administrator permission is required.";
  }
  if (error instanceof ApplicationConfigurationError) return error.message;
  return "The configuration request could not be completed safely.";
}

export async function previewApplicationConfiguration(
  _previous: ConfigurationPreviewState,
  formData: FormData,
): Promise<ConfigurationPreviewState> {
  try {
    const accountId = id.parse(formData.get("accountId"));
    const actor = await authorize(accountId);
    const preview = await getApplicationConfigurationService().preview(
      {
        accountId,
        expectedRevision: z.coerce
          .number()
          .int()
          .nonnegative()
          .parse(formData.get("expectedRevision")),
        reason: z.string().parse(formData.get("reason")),
        values: values(formData),
      },
      actor,
    );
    return {
      outcome: "valid",
      message: preview.changedCategories.length
        ? `Valid preview for revision ${preview.nextRevision}.`
        : "Valid, but no category values changed.",
      digest: preview.digest,
      changedCategories: preview.changedCategories,
    };
  } catch (error) {
    return {
      outcome: "invalid",
      message: safeError(error),
      digest: null,
      changedCategories: [],
    };
  }
}

export async function saveApplicationConfiguration(
  formData: FormData,
): Promise<never> {
  try {
    const accountId = id.parse(formData.get("accountId"));
    const actor = await authorize(accountId);
    await getApplicationConfigurationService().save(
      {
        accountId,
        expectedRevision: z.coerce
          .number()
          .int()
          .nonnegative()
          .parse(formData.get("expectedRevision")),
        reason: z.string().parse(formData.get("reason")),
        values: values(formData),
      },
      actor,
    );
    redirect("/settings/configuration?notice=Configuration%20saved.");
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(
      `/settings/configuration?error=${encodeURIComponent(safeError(error))}`,
    );
  }
}

export async function seedApplicationConfiguration(
  formData: FormData,
): Promise<never> {
  try {
    const accountId = id.parse(formData.get("accountId"));
    const actor = await authorize(accountId);
    const result =
      await getApplicationConfigurationService().seedFromEnvironment(
        {
          accountId,
          reason: z.string().parse(formData.get("reason")),
        },
        actor,
      );
    redirect(
      result.created
        ? "/settings/configuration?notice=Initial%20configuration%20created."
        : "/settings/configuration?notice=Configuration%20was%20already%20seeded.",
    );
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(
      `/settings/configuration?error=${encodeURIComponent(safeError(error))}`,
    );
  }
}

export async function rollbackApplicationConfiguration(
  formData: FormData,
): Promise<never> {
  try {
    const accountId = id.parse(formData.get("accountId"));
    const actor = await authorize(accountId);
    await getApplicationConfigurationService().rollback(
      {
        accountId,
        expectedRevision: z.coerce
          .number()
          .int()
          .positive()
          .parse(formData.get("expectedRevision")),
        targetRevision: z.coerce
          .number()
          .int()
          .positive()
          .parse(formData.get("targetRevision")),
        reason: z.string().parse(formData.get("reason")),
      },
      actor,
    );
    redirect("/settings/configuration?notice=Rollback%20revision%20created.");
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(
      `/settings/configuration?error=${encodeURIComponent(safeError(error))}`,
    );
  }
}

export async function refreshApplicationConfiguration(
  formData: FormData,
): Promise<never> {
  try {
    const accountId = id.parse(formData.get("accountId"));
    await authorize(accountId);
    await getApplicationConfigurationService().refresh(accountId);
    redirect("/settings/configuration?notice=Runtime%20cache%20refreshed.");
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(
      `/settings/configuration?error=${encodeURIComponent(safeError(error))}`,
    );
  }
}
