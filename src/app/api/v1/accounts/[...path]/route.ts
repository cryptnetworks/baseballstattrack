import { z } from "zod";

import {
  STATISTICS_API_MEDIA_TYPE,
  STATISTICS_API_VERSION,
  StatisticsApiError,
} from "@/domain/statistics-api";
import {
  RateLimitError,
  rateLimitHeaders,
  rateLimitStatus,
  safeRateLimitMessage,
} from "@/domain/rate-limits";
import { getStatisticsApiService } from "@/server/app/statistics-api-service";
import { getAuthorizationService } from "@/server/auth/application";
import {
  safeAuthorizationMessage,
  safeAuthorizationStatus,
} from "@/server/auth/errors";
import { authenticateRouteRequest } from "@/server/auth/next-session";
import { authorizeProtectedRequest } from "@/server/auth/protected-boundary";
import type { Capability, ResourceTarget } from "@/server/auth/types";
import { getPrismaClient } from "@/server/data/prisma";
import { PrismaStatisticsApiRepository } from "@/server/data/statistics-api-repository";

export const dynamic = "force-dynamic";

const externalId = z.uuid();
const directory = z.enum(["teams", "seasons", "players", "games"]);

function response(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Content-Type": STATISTICS_API_MEDIA_TYPE,
      "Cache-Control": "private, no-store, max-age=0",
      "X-API-Version": STATISTICS_API_VERSION,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function errorResponse(error: unknown) {
  if (error instanceof RateLimitError) {
    return Response.json(
      {
        apiVersion: STATISTICS_API_VERSION,
        error: safeRateLimitMessage(error),
      },
      { status: rateLimitStatus(error), headers: rateLimitHeaders(error) },
    );
  }
  if (error instanceof StatisticsApiError) {
    return response(
      {
        apiVersion: STATISTICS_API_VERSION,
        error:
          error.code === "INVALID_QUERY" || error.code === "INVALID_PATH"
            ? "The API request is invalid."
            : "The requested API resource is unavailable.",
        code: error.code,
      },
      error.code === "INVALID_QUERY" || error.code === "INVALID_PATH"
        ? 400
        : error.code === "SOURCE_CHANGED"
          ? 409
          : 404,
    );
  }
  return response(
    {
      apiVersion: STATISTICS_API_VERSION,
      error: safeAuthorizationMessage(error),
    },
    safeAuthorizationStatus(error),
  );
}

export async function GET(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  try {
    const path = (await context.params).path;
    const accountExternalId = externalId.safeParse(path[0]);
    if (!accountExternalId.success) {
      throw new StatisticsApiError("INVALID_PATH");
    }
    const identity = await authenticateRouteRequest(request);
    const repository = new PrismaStatisticsApiRepository(getPrismaClient());
    const account = await repository.resolveAccount(accountExternalId.data);
    if (!account) throw new StatisticsApiError("RESOURCE_UNAVAILABLE");

    let target: ResourceTarget = {
      kind: "ACCOUNT",
      accountId: account.id,
    };
    let capability: Capability = "account.view";
    let operation:
      | { kind: "ACCOUNT" }
      | { kind: "DIRECTORY"; resource: z.infer<typeof directory> }
      | { kind: "BOX_SCORE"; gameExternalId: string }
      | {
          kind: "LEADERS";
          seasonExternalId: string;
          teamExternalId: string;
        };

    if (path.length === 1) {
      operation = { kind: "ACCOUNT" };
    } else if (path.length === 2) {
      const resource = directory.safeParse(path[1]);
      if (!resource.success) throw new StatisticsApiError("INVALID_PATH");
      operation = { kind: "DIRECTORY", resource: resource.data };
      capability =
        resource.data === "teams"
          ? "team.view"
          : resource.data === "seasons"
            ? "season.view"
            : resource.data === "players"
              ? "roster.view"
              : "game.view";
    } else if (
      path.length === 4 &&
      path[1] === "games" &&
      path[3] === "box-score"
    ) {
      const gameExternalId = externalId.safeParse(path[2]);
      if (!gameExternalId.success) {
        throw new StatisticsApiError("INVALID_PATH");
      }
      const game = await repository.resolveGame(
        account.id,
        gameExternalId.data,
      );
      if (!game) throw new StatisticsApiError("RESOURCE_UNAVAILABLE");
      target = { kind: "GAME", accountId: account.id, gameId: game.id };
      capability = "report.view";
      operation = { kind: "BOX_SCORE", gameExternalId: gameExternalId.data };
    } else if (
      path.length === 4 &&
      path[1] === "seasons" &&
      path[3] === "leaders"
    ) {
      const seasonExternalId = externalId.safeParse(path[2]);
      const teamExternalId = externalId.safeParse(
        new URL(request.url).searchParams.get("teamId"),
      );
      if (!seasonExternalId.success || !teamExternalId.success) {
        throw new StatisticsApiError("INVALID_QUERY");
      }
      const scope = await repository.resolveSeasonTeam(
        account.id,
        seasonExternalId.data,
        teamExternalId.data,
      );
      if (!scope) throw new StatisticsApiError("RESOURCE_UNAVAILABLE");
      target = {
        kind: "SEASON",
        accountId: account.id,
        seasonId: scope.seasonId,
      };
      capability = "report.view";
      operation = {
        kind: "LEADERS",
        seasonExternalId: seasonExternalId.data,
        teamExternalId: teamExternalId.data,
      };
    } else {
      throw new StatisticsApiError("INVALID_PATH");
    }

    const actor = await authorizeProtectedRequest(
      () => Promise.resolve(identity),
      getAuthorizationService(),
      target,
      capability,
    );
    const service = getStatisticsApiService();
    const result =
      operation.kind === "ACCOUNT"
        ? await service.account(account.id, actor)
        : operation.kind === "DIRECTORY"
          ? await service.directory(
              operation.resource,
              account.id,
              new URL(request.url).searchParams,
              actor,
            )
          : operation.kind === "BOX_SCORE"
            ? await service.boxScore(
                account.id,
                operation.gameExternalId,
                actor,
              )
            : await service.leaders(
                account.id,
                operation.seasonExternalId,
                operation.teamExternalId,
                actor,
              );
    return response(result);
  } catch (error) {
    return errorResponse(error);
  }
}
