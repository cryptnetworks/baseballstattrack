"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  discordMessageFormats,
  discordMessageStrategies,
  discordUpdateTriggers,
} from "@/domain/discord-settings";
import { RateLimitError } from "@/domain/rate-limits";
import { DiscordSettingsError } from "@/server/app/discord-settings-service";
import {
  DiscordUpdateContentError,
  getDiscordUpdateContentService,
} from "@/server/app/discord-update-content-service";
import { getAuthorizationService } from "@/server/auth/application";
import { authenticatePageSession } from "@/server/auth/next-session";
import { authorizeProtectedAction } from "@/server/auth/protected-boundary";

const accountId = z.string().trim().min(1).max(128);
const installationId = z.uuid();
const expectedRevision = z.coerce.number().int().min(0);

function resultUrl(server: string, result: "notice" | "error", code: string) {
  const search = new URLSearchParams({ server, [result]: code });
  return `/discord/updates?${search.toString()}`;
}

function safeError(error: unknown) {
  if (error instanceof z.ZodError) return "content-validation";
  if (error instanceof RateLimitError) return "content-rate-limited";
  if (error instanceof DiscordSettingsError) {
    return error.code === "REVISION_CONFLICT"
      ? "content-conflict"
      : "content-unavailable";
  }
  if (error instanceof DiscordUpdateContentError) {
    return error.code === "INSTALLATION_INACTIVE"
      ? "content-inactive"
      : "content-unavailable";
  }
  throw error;
}

export async function saveDiscordUpdateContent(formData: FormData) {
  const target = {
    accountId: accountId.parse(formData.get("accountId")),
    installationId: installationId.parse(formData.get("installationId")),
    expectedRevision: expectedRevision.parse(formData.get("expectedRevision")),
  };
  const requestHeaders = await headers();
  const actor = await authorizeProtectedAction({
    origin: requestHeaders.get("origin"),
    host: requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"),
    authenticate: authenticatePageSession,
    authorization: getAuthorizationService(),
    target: { kind: "ACCOUNT", accountId: target.accountId },
    capability: "discord.settings.configure",
  });
  let errorCode: string | null = null;
  try {
    await getDiscordUpdateContentService().update(
      {
        ...target,
        triggers: z
          .array(z.enum(discordUpdateTriggers))
          .parse(formData.getAll("triggers")),
        messageStrategy: z
          .enum(discordMessageStrategies)
          .parse(formData.get("messageStrategy")),
        messageFormat: z
          .enum(discordMessageFormats)
          .parse(formData.get("messageFormat")),
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
      errorCode ?? "content-saved",
    ),
  );
}
