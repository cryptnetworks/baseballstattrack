import {
  STATISTICS_API_MEDIA_TYPE,
  STATISTICS_API_VERSION,
  statisticsApiEnvelope,
} from "@/domain/statistics-api";
import { getAuthorizationService } from "@/server/auth/application";
import {
  safeAuthorizationMessage,
  safeAuthorizationStatus,
} from "@/server/auth/errors";
import { authenticateRouteRequest } from "@/server/auth/next-session";

export const dynamic = "force-dynamic";

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

export async function GET(request: Request) {
  try {
    const identity = await authenticateRouteRequest(request);
    const accounts =
      await getAuthorizationService().listAvailableAccounts(identity);
    return response(
      statisticsApiEnvelope(
        accounts.map(({ externalId, displayName }) => ({
          id: externalId,
          displayName,
        })),
      ),
    );
  } catch (error) {
    return response(
      {
        apiVersion: STATISTICS_API_VERSION,
        error: safeAuthorizationMessage(error),
      },
      safeAuthorizationStatus(error),
    );
  }
}
