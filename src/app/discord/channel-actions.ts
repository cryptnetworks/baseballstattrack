"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { discordRoutingCategories } from "@/domain/discord-channel-routing";
import { discordMessageFormats } from "@/domain/discord-settings";
import {
  DiscordChannelRoutingError,
  getDiscordChannelRoutingService,
} from "@/server/app/discord-channel-routing-service";
import { DiscordSettingsError } from "@/server/app/discord-settings-service";
import { RateLimitError } from "@/domain/rate-limits";
import { getAuthorizationService } from "@/server/auth/application";
import { authenticatePageSession } from "@/server/auth/next-session";
import { authorizeProtectedAction } from "@/server/auth/protected-boundary";
import type { Capability } from "@/server/auth/types";

const accountId = z.string().trim().min(1).max(128);
const installationId = z.uuid();
const destinationId = z.uuid();

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

function resultUrl(
  server: string,
  result: "notice" | "error",
  code: string,
  section: "channels" | "preview" = "channels",
) {
  const search = new URLSearchParams({ server, [result]: code });
  return `/discord/${section}?${search.toString()}`;
}

function safeError(error: unknown) {
  if (error instanceof z.ZodError) return "validation";
  if (error instanceof RateLimitError) return "rate-limited";
  if (error instanceof DiscordSettingsError) {
    return error.code === "REVISION_CONFLICT" ? "conflict" : "unavailable";
  }
  if (error instanceof DiscordChannelRoutingError) {
    if (error.code === "PERMISSION_REQUIRED") return "permissions";
    if (error.code === "PROVIDER_RATE_LIMITED") return "rate-limited";
    if (error.code === "PROVIDER_UNAVAILABLE") return "provider";
    if (error.code === "INSTALLATION_INACTIVE") return "inactive";
    return "unavailable";
  }
  throw error;
}

export async function refreshDiscordChannels(formData: FormData) {
  const account = accountId.parse(formData.get("accountId"));
  const installation = installationId.parse(formData.get("installationId"));
  const actor = await authorize(account, "discord.settings.configure");
  let errorCode: string | null = null;
  try {
    await getDiscordChannelRoutingService().refresh(
      { accountId: account, installationId: installation },
      actor,
    );
  } catch (error) {
    errorCode = safeError(error);
  }
  redirect(
    resultUrl(
      installation,
      errorCode ? "error" : "notice",
      errorCode ?? "refreshed",
    ),
  );
}

export async function saveDiscordChannelRouting(formData: FormData) {
  const account = accountId.parse(formData.get("accountId"));
  const installation = installationId.parse(formData.get("installationId"));
  const actor = await authorize(account, "discord.settings.configure");
  let errorCode: string | null = null;
  try {
    const routes = Object.fromEntries(
      discordRoutingCategories.map(({ id }) => {
        const value = formData.get(`route-${id}`);
        return [id, value ? destinationId.parse(value) : null];
      }),
    );
    await getDiscordChannelRoutingService().updateRouting(
      {
        accountId: account,
        installationId: installation,
        expectedRevision: z.coerce
          .number()
          .int()
          .min(0)
          .parse(formData.get("expectedRevision")),
        routes,
      },
      actor,
    );
  } catch (error) {
    errorCode = safeError(error);
  }
  redirect(
    resultUrl(
      installation,
      errorCode ? "error" : "notice",
      errorCode ?? "saved",
    ),
  );
}

export async function toggleDiscordChannel(formData: FormData) {
  const account = accountId.parse(formData.get("accountId"));
  const installation = installationId.parse(formData.get("installationId"));
  const enabled = z.enum(["true", "false"]).parse(formData.get("enabled"));
  const actor = await authorize(account, "discord.settings.configure");
  let errorCode: string | null = null;
  try {
    await getDiscordChannelRoutingService().toggle(
      {
        accountId: account,
        installationId: installation,
        destinationId: destinationId.parse(formData.get("destinationId")),
        enabled: enabled === "true",
      },
      actor,
    );
  } catch (error) {
    errorCode = safeError(error);
  }
  redirect(
    resultUrl(
      installation,
      errorCode ? "error" : "notice",
      errorCode ?? (enabled === "true" ? "enabled" : "disabled"),
    ),
  );
}

export async function testDiscordChannelDelivery(formData: FormData) {
  const account = accountId.parse(formData.get("accountId"));
  const installation = installationId.parse(formData.get("installationId"));
  const actor = await authorize(account, "discord.settings.preview");
  const returnSection = z
    .enum(["channels", "preview"])
    .catch("channels")
    .parse(formData.get("returnSection"));
  let errorCode: string | null = null;
  try {
    await getDiscordChannelRoutingService().testDelivery(
      {
        accountId: account,
        installationId: installation,
        destinationId: destinationId.parse(formData.get("destinationId")),
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
      installation,
      errorCode ? "error" : "notice",
      errorCode ?? "tested",
      returnSection,
    ),
  );
}
