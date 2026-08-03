import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { deploymentConfiguration } from "@/server/config/runtime-environment";

export const DISCORD_OAUTH_STATE_TTL_SECONDS = 10 * 60;

const statePayloadSchema = z
  .object({
    version: z.literal(1),
    nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
    accountId: z.string().trim().min(1).max(128),
    actorUserId: z.string().trim().min(1).max(128),
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
  })
  .strict();

export type DiscordOAuthStatePayload = z.infer<typeof statePayloadSchema>;

export class DiscordOAuthStateError extends Error {
  constructor() {
    super("Discord OAuth state is unavailable.");
    this.name = "DiscordOAuthStateError";
  }
}

function signature(encodedPayload: string, secret: string) {
  return createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64url");
}

export function issueDiscordOAuthState(input: {
  accountId: string;
  actorUserId: string;
  secret: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const issuedAt = Math.floor(now.getTime() / 1_000);
  const payload = statePayloadSchema.parse({
    version: 1,
    nonce: randomBytes(32).toString("base64url"),
    accountId: input.accountId,
    actorUserId: input.actorUserId,
    issuedAt,
    expiresAt: issuedAt + DISCORD_OAUTH_STATE_TTL_SECONDS,
  });
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url",
  );
  return {
    nonce: payload.nonce,
    cookieValue: `${encodedPayload}.${signature(encodedPayload, input.secret)}`,
    expiresAt: new Date(payload.expiresAt * 1_000),
  };
}

export function verifyDiscordOAuthState(input: {
  cookieValue: string | null | undefined;
  returnedState: string | null | undefined;
  secret: string;
  now?: Date;
}): DiscordOAuthStatePayload {
  try {
    const [encodedPayload, providedSignature, extra] =
      input.cookieValue?.split(".") ?? [];
    if (!encodedPayload || !providedSignature || extra) {
      throw new DiscordOAuthStateError();
    }
    const expectedSignature = signature(encodedPayload, input.secret);
    const expected = Buffer.from(expectedSignature);
    const provided = Buffer.from(providedSignature);
    if (
      expected.length !== provided.length ||
      !timingSafeEqual(expected, provided)
    ) {
      throw new DiscordOAuthStateError();
    }
    const payload = statePayloadSchema.parse(
      JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")),
    );
    const now = Math.floor((input.now ?? new Date()).getTime() / 1_000);
    if (
      input.returnedState !== payload.nonce ||
      payload.issuedAt > now + 30 ||
      payload.expiresAt < now ||
      payload.expiresAt - payload.issuedAt !== DISCORD_OAUTH_STATE_TTL_SECONDS
    ) {
      throw new DiscordOAuthStateError();
    }
    return payload;
  } catch (error) {
    if (error instanceof DiscordOAuthStateError) throw error;
    throw new DiscordOAuthStateError();
  }
}

export const discordOAuthStateCookie = Object.freeze({
  name: "bst_discord_oauth_state",
  options: {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: deploymentConfiguration().nodeEnvironment === "production",
    path: "/api/admin/discord-installations/callback",
    maxAge: DISCORD_OAUTH_STATE_TTL_SECONDS,
  },
});
