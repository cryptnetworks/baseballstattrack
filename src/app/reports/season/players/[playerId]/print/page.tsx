import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { PrintablePlayerReport } from "@/components/reports/printable-reports";
import type { SeasonDashboard } from "@/domain/reports";
import { getSeasonDashboardService } from "@/server/app/season-dashboard-service";
import { getAuthorizationService } from "@/server/auth/application";
import { AuthorizationError } from "@/server/auth/errors";
import { authenticatePageSession } from "@/server/auth/next-session";
import { authorizeProtectedRequest } from "@/server/auth/protected-boundary";
import { selectedAccountCookie } from "@/server/auth/request-security";

export const dynamic = "force-dynamic";

export default async function PrintablePlayerPage({
  params,
  searchParams,
}: {
  params: Promise<{ playerId: string }>;
  searchParams: Promise<{ teamId?: string; seasonId?: string }>;
}) {
  const accountId = (await cookies()).get(selectedAccountCookie.name)?.value;
  if (!accountId) redirect("/accounts");
  const [{ playerId }, query] = await Promise.all([params, searchParams]);
  if (!query.teamId || !query.seasonId) notFound();
  let dashboard: SeasonDashboard;
  let player: SeasonDashboard["players"][number];
  try {
    const actor = await authorizeProtectedRequest(
      authenticatePageSession,
      getAuthorizationService(),
      { kind: "TEAM", accountId, teamId: query.teamId },
      "report.view",
    );
    dashboard = await getSeasonDashboardService().load(
      {
        accountId,
        teamId: query.teamId,
        seasonId: query.seasonId,
        dateFrom: null,
        dateTo: null,
      },
      actor,
    );
    const resolvedPlayer = dashboard.players.find(
      (candidate) => candidate.playerId === playerId,
    );
    if (!resolvedPlayer) notFound();
    player = resolvedPlayer;
  } catch (error) {
    if (error instanceof AuthorizationError) notFound();
    throw error;
  }
  return (
    <PrintablePlayerReport
      dashboard={dashboard}
      generatedAt={new Date().toISOString()}
      player={player}
    />
  );
}
