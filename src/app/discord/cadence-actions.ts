"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { minuteOfDay } from "@/domain/discord-cadence";
import {
  discordCadenceModes,
  discordCatchUpPolicies,
} from "@/domain/discord-update-schedule";
import { RateLimitError } from "@/domain/rate-limits";
import {
  DiscordCadenceError,
  getDiscordCadenceService,
} from "@/server/app/discord-cadence-service";
import { DiscordSettingsError } from "@/server/app/discord-settings-service";
import { getAuthorizationService } from "@/server/auth/application";
import { authenticatePageSession } from "@/server/auth/next-session";
import { authorizeProtectedAction } from "@/server/auth/protected-boundary";
import type { Capability } from "@/server/auth/types";

const accountId = z.string().trim().min(1).max(128);
const installationId = z.uuid();
const expectedRevision = z.coerce.number().int().min(0);

async function authorize(account: string, capability: Capability) {
  const requestHeaders = await headers();
  return authorizeProtectedAction({
    origin: requestHeaders.get("origin"),
    host: requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"),
    authenticate: authenticatePageSession,
    authorization: getAuthorizationService(),
    target: { kind: "ACCOUNT", accountId: account },
    capability,
  });
}

function resultUrl(server: string, result: "notice" | "error", code: string) {
  const search = new URLSearchParams({ server, [result]: code });
  return `/discord/updates?${search.toString()}`;
}

function safeError(error: unknown) {
  if (
    error instanceof z.ZodError ||
    (error instanceof Error && error.message.includes("Time"))
  ) {
    return "validation";
  }
  if (error instanceof RateLimitError) return "rate-limited";
  if (error instanceof DiscordSettingsError) {
    return error.code === "REVISION_CONFLICT" ? "conflict" : "unavailable";
  }
  if (error instanceof DiscordCadenceError) {
    if (error.code === "REVISION_CONFLICT") return "conflict";
    if (error.code === "INSTALLATION_INACTIVE") return "inactive";
    if (error.code === "CONFIGURATION_INCOMPLETE") return "incomplete";
    return "unavailable";
  }
  throw error;
}

function identity(formData: FormData) {
  return {
    accountId: accountId.parse(formData.get("accountId")),
    installationId: installationId.parse(formData.get("installationId")),
    expectedRevision: expectedRevision.parse(formData.get("expectedRevision")),
  };
}

export async function saveDiscordCadence(formData: FormData) {
  const target = identity(formData);
  const actor = await authorize(target.accountId, "discord.settings.configure");
  let errorCode: string | null = null;
  try {
    await getDiscordCadenceService().update(
      {
        ...target,
        cadenceMode: z
          .enum(discordCadenceModes)
          .parse(formData.get("cadenceMode")),
        cadenceSeconds: z.coerce
          .number()
          .int()
          .parse(formData.get("cadenceSeconds")),
        gameDayWindow: {
          enabled: formData.has("gameDayWindowEnabled"),
          startMinute: minuteOfDay(String(formData.get("gameDayStart"))),
          endMinute: minuteOfDay(String(formData.get("gameDayEnd"))),
        },
        digest: {
          enabled: formData.has("digestEnabled"),
          minute: minuteOfDay(String(formData.get("digestTime"))),
        },
        catchUpPolicy: z
          .enum(discordCatchUpPolicies)
          .parse(formData.get("catchUpPolicy")),
        quietHours: {
          enabled: formData.has("quietHoursEnabled"),
          startMinute: minuteOfDay(String(formData.get("quietStart"))),
          endMinute: minuteOfDay(String(formData.get("quietEnd"))),
          timeZone: z.string().trim().parse(formData.get("timeZone")),
        },
      },
      actor,
    );
  } catch (error) {
    errorCode = safeError(error);
  }
  redirect(
    resultUrl(
      target.installationId,
      errorCode ? "error" : "notice",
      errorCode ?? "saved",
    ),
  );
}

export async function changeDiscordCadenceState(formData: FormData) {
  const target = identity(formData);
  const operation = z
    .enum(["PAUSE", "RESUME"])
    .parse(formData.get("operation"));
  const actor = await authorize(target.accountId, "discord.settings.configure");
  let errorCode: string | null = null;
  try {
    await getDiscordCadenceService().changeState(
      { ...target, operation },
      actor,
    );
  } catch (error) {
    errorCode = safeError(error);
  }
  redirect(
    resultUrl(
      target.installationId,
      errorCode ? "error" : "notice",
      errorCode ?? (operation === "PAUSE" ? "paused" : "resumed"),
    ),
  );
}

export async function requestDiscordManualRefresh(formData: FormData) {
  const target = identity(formData);
  const actor = await authorize(target.accountId, "discord.settings.operate");
  let code = "requested";
  let failed = false;
  try {
    const result = await getDiscordCadenceService().requestManualRefresh(
      target,
      actor,
    );
    if (result.coalesced) code = "coalesced";
  } catch (error) {
    code = safeError(error);
    failed = true;
  }
  redirect(resultUrl(target.installationId, failed ? "error" : "notice", code));
}
