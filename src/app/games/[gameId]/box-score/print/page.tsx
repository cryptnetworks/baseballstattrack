import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { PrintableGameReport } from "@/components/reports/printable-reports";
import type { GameBoxScore } from "@/domain/reports";
import { getGameBoxScoreService } from "@/server/app/game-box-score-service";
import { getGameSetupService } from "@/server/app/game-setup-service";
import { getAuthorizationService } from "@/server/auth/application";
import { AuthorizationError } from "@/server/auth/errors";
import { authenticatePageSession } from "@/server/auth/next-session";
import { authorizeProtectedRequest } from "@/server/auth/protected-boundary";
import { selectedAccountCookie } from "@/server/auth/request-security";

export const dynamic = "force-dynamic";

export default async function PrintableGamePage({
  params,
}: {
  params: Promise<{ gameId: string }>;
}) {
  const { gameId } = await params;
  const accountId = (await cookies()).get(selectedAccountCookie.name)?.value;
  if (!accountId) redirect("/accounts");
  let report: GameBoxScore;
  try {
    const authorization = getAuthorizationService();
    const [reportActor, viewActor] = await Promise.all([
      authorizeProtectedRequest(
        authenticatePageSession,
        authorization,
        { kind: "GAME", accountId, gameId },
        "report.view",
      ),
      authorizeProtectedRequest(
        authenticatePageSession,
        authorization,
        { kind: "GAME", accountId, gameId },
        "game.view",
      ),
    ]);
    const current = await getGameSetupService().loadCurrentSetup(
      { accountId, gameId },
      viewActor,
    );
    if (!current.game.readySetupSnapshotId) {
      redirect(`/games/setup/${gameId}`);
    }
    report = await getGameBoxScoreService().load(
      {
        accountId,
        gameId,
        setupSnapshotId: current.game.readySetupSnapshotId,
      },
      reportActor,
    );
  } catch (error) {
    if (error instanceof AuthorizationError) notFound();
    throw error;
  }
  return <PrintableGameReport report={report} />;
}
