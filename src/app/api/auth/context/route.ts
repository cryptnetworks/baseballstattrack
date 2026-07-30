import { z } from "zod";

import { getAuthorizationService } from "@/server/auth/application";
import {
  safeAuthorizationMessage,
  safeAuthorizationStatus,
} from "@/server/auth/errors";
import { authenticateRouteRequest } from "@/server/auth/next-session";
import { authorizeProtectedRequest } from "@/server/auth/protected-boundary";

const accountIdSchema = z.string().trim().min(1).max(128);

type ContextActor = Readonly<{
  accountId: string;
  capability: "account.view";
  authorizedAt: string;
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
  };
};

export function createAuthContextHandler(
  authorize: ContextAuthorizer = authorizeContext,
) {
  return async function authContextHandler(request: Request) {
    try {
      const accountId = accountIdSchema.parse(
        new URL(request.url).searchParams.get("accountId"),
      );
      const actor = await authorize(request, accountId);
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
      return Response.json(
        { error: safeAuthorizationMessage(error) },
        { status: safeAuthorizationStatus(error) },
      );
    }
  };
}

export const GET = createAuthContextHandler();
