import { z } from "zod";

import {
  RateLimitError,
  rateLimitHeaders,
  rateLimitStatus,
  safeRateLimitMessage,
} from "@/domain/rate-limits";
import { getRateLimitService } from "@/server/app/rate-limit-service";
import { getAuthorizationService } from "@/server/auth/application";
import {
  safeAuthorizationMessage,
  safeAuthorizationStatus,
} from "@/server/auth/errors";
import { authenticateRouteRequest } from "@/server/auth/next-session";
import { authorizeProtectedRequest } from "@/server/auth/protected-boundary";
import type { TrustedActorContext } from "@/server/auth/types";

const accountIdSchema = z.string().trim().min(1).max(128);

type ContextActor = Readonly<{
  accountId: string;
  capability: "account.view";
  authorizedAt: string;
  trusted?: TrustedActorContext;
}>;

type ContextAuthorizer = (
  request: Request,
  accountId: string,
) => Promise<ContextActor>;

const authorizeContext: ContextAuthorizer = async (request, accountId) => {
  const actor = await authorizeProtectedRequest(
    () => authenticateRouteRequest(request),
    getAuthorizationService(),
    { kind: "ACCOUNT", accountId },
    "account.view",
  );
  return {
    accountId: actor.accountId,
    capability: "account.view",
    authorizedAt: actor.authorizedAt,
    trusted: actor,
  };
};

type ContextLimiter = (actor: ContextActor) => Promise<void>;

const limitContext: ContextLimiter = async (actor) => {
  if (!actor.trusted) throw new Error("Trusted actor context is unavailable.");
  await getRateLimitService().enforce(
    { accountId: actor.accountId, endpointClass: "ACCOUNT_SELECTION" },
    actor.trusted,
  );
};

export function createAuthContextHandler(
  authorize: ContextAuthorizer = authorizeContext,
  limit: ContextLimiter = authorize === authorizeContext
    ? limitContext
    : async () => {},
) {
  return async function authContextHandler(request: Request) {
    try {
      const accountId = accountIdSchema.parse(
        new URL(request.url).searchParams.get("accountId"),
      );
      const actor = await authorize(request, accountId);
      await limit(actor);
      return Response.json({
        accountId: actor.accountId,
        capability: actor.capability,
        authorizedAt: actor.authorizedAt,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return Response.json(
          { error: "The request is invalid." },
          { status: 400 },
        );
      }
      if (error instanceof RateLimitError) {
        return Response.json(
          { error: safeRateLimitMessage(error) },
          { status: rateLimitStatus(error), headers: rateLimitHeaders(error) },
        );
      }
      return Response.json(
        { error: safeAuthorizationMessage(error) },
        { status: safeAuthorizationStatus(error) },
      );
    }
  };
}

export const GET = createAuthContextHandler();
