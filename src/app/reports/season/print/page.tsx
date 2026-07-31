import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { PrintableSeasonReport } from "@/components/reports/printable-reports";
import type { SeasonDashboard } from "@/domain/reports";
import { getSeasonDashboardService } from "@/server/app/season-dashboard-service";
import { getAuthorizationService } from "@/server/auth/application";
import { AuthorizationError } from "@/server/auth/errors";
import { authenticatePageSession } from "@/server/auth/next-session";
import { authorizeProtectedRequest } from "@/server/auth/protected-boundary";
import { selectedAccountCookie } from "@/server/auth/request-security";

export const dynamic = "force-dynamic";

export default async function PrintableSeasonPage({
  searchParams,
}: {
  searchParams: Promise<{
    teamId?: string;
    seasonId?: string;
    dateFrom?: string;
    dateTo?: string;
  }>;
}) {
  const accountId = (await cookies()).get(selectedAccountCookie.name)?.value;
  if (!accountId) redirect("/accounts");
  const query = await searchParams;
  if (!query.teamId || !query.seasonId) notFound();
  let dashboard: SeasonDashboard;
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
        dateFrom: query.dateFrom || null,
        dateTo: query.dateTo || null,
      },
      actor,
    );
  } catch (error) {
    if (error instanceof AuthorizationError) notFound();
    throw error;
  }
  return (
    <PrintableSeasonReport
      dashboard={dashboard}
      generatedAt={new Date().toISOString()}
    />
  );
}
