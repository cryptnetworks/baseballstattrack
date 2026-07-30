import { cookies } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ApplicationShell } from "@/components/app/application-shell";
import { formatExactRate, formatInningsPitched } from "@/domain/statistics";
import { getSeasonDashboardService } from "@/server/app/season-dashboard-service";
import { getAuthorizationService } from "@/server/auth/application";
import { AuthorizationError } from "@/server/auth/errors";
import { authenticatePageSession } from "@/server/auth/next-session";
import { authorizeProtectedRequest } from "@/server/auth/protected-boundary";
import { selectedAccountCookie } from "@/server/auth/request-security";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ playerId: string }>;
  searchParams: Promise<{ teamId?: string; seasonId?: string }>;
};

function rate(
  value: Parameters<typeof formatExactRate>[0],
  omitLeadingZero = true,
) {
  return formatExactRate(value, { precision: 3, omitLeadingZero }) ?? "—";
}

export default async function PlayerSeasonSummaryPage({
  params,
  searchParams,
}: PageProps) {
  const accountId = (await cookies()).get(selectedAccountCookie.name)?.value;
  if (!accountId) redirect("/accounts");
  const [{ playerId }, query] = await Promise.all([params, searchParams]);
  if (!query.teamId || !query.seasonId) notFound();
  const authorization = getAuthorizationService();
  let actor;
  try {
    actor = await authorizeProtectedRequest(
      authenticatePageSession,
      authorization,
      { kind: "SEASON", accountId, seasonId: query.seasonId },
      "report.view",
    );
  } catch (error) {
    if (error instanceof AuthorizationError) notFound();
    throw error;
  }
  const dashboard = await getSeasonDashboardService().load(
    {
      accountId,
      teamId: query.teamId,
      seasonId: query.seasonId,
      dateFrom: null,
      dateTo: null,
    },
    actor,
  );
  const player = dashboard.players.find(
    (candidate) => candidate.playerId === playerId,
  );
  if (!player) notFound();

  return (
    <ApplicationShell>
      <main
        className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6"
        id="main-content"
        tabIndex={-1}
      >
        <Link
          className="inline-flex min-h-11 items-center rounded-lg underline"
          href={`/reports/season?selection=${dashboard.version.teamId}:${dashboard.version.seasonId}`}
        >
          Back to season dashboard
        </Link>
        <p className="mt-5 text-sm font-medium text-[var(--accent)]">
          {dashboard.selection.teamDisplayName} ·{" "}
          {dashboard.selection.seasonDisplayName}
        </p>
        <h1 className="mt-1 text-3xl font-semibold">
          {player.displayName} season summary
        </h1>
        <p className="mt-2 text-[var(--muted)]">
          Verified games only · current effective history · privacy overlay{" "}
          {dashboard.version.privacyOverlayRevision}
        </p>

        <div className="mt-8 grid gap-5 md:grid-cols-3">
          <section className="rounded-xl border border-[var(--line)] bg-white p-5">
            <h2 className="text-xl font-semibold">Batting</h2>
            {player.batting ? (
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-[var(--muted)]">PA / AB</dt>
                  <dd>
                    {player.batting.counters.plateAppearances} /{" "}
                    {player.batting.counters.atBats}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">H / RBI</dt>
                  <dd>
                    {player.batting.counters.hits} /{" "}
                    {player.batting.counters.runsBattedIn}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">AVG</dt>
                  <dd>{rate(player.batting.rates.battingAverage)}</dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">OBP</dt>
                  <dd>{rate(player.batting.rates.onBasePercentage)}</dd>
                </div>
              </dl>
            ) : (
              <p className="mt-4 text-sm">No verified batting opportunities.</p>
            )}
          </section>
          <section className="rounded-xl border border-[var(--line)] bg-white p-5">
            <h2 className="text-xl font-semibold">Pitching</h2>
            {player.pitching ? (
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-[var(--muted)]">IP</dt>
                  <dd>
                    {formatInningsPitched(
                      player.pitching.counters.outsRecorded,
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">SO / BB</dt>
                  <dd>
                    {player.pitching.counters.strikeouts} /{" "}
                    {player.pitching.counters.walks}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">ERA</dt>
                  <dd>{rate(player.pitching.rates.earnedRunAverage, false)}</dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">WHIP</dt>
                  <dd>
                    {rate(
                      player.pitching.rates.walksAndHitsPerInningPitched,
                      false,
                    )}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="mt-4 text-sm">
                No verified pitching opportunities.
              </p>
            )}
          </section>
          <section className="rounded-xl border border-[var(--line)] bg-white p-5">
            <h2 className="text-xl font-semibold">Fielding</h2>
            {player.fielding ? (
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-[var(--muted)]">Chances</dt>
                  <dd>{player.fielding.rates.chances}</dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">Errors</dt>
                  <dd>{player.fielding.counters.errors}</dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">FLD</dt>
                  <dd>{rate(player.fielding.rates.fieldingPercentage)}</dd>
                </div>
              </dl>
            ) : (
              <p className="mt-4 text-sm">
                No verified fielding opportunities.
              </p>
            )}
          </section>
        </div>

        <section aria-labelledby="player-source-games" className="mt-10">
          <h2 className="text-2xl font-semibold" id="player-source-games">
            Source games
          </h2>
          {player.sourceGames.length === 0 ? (
            <p className="mt-4" role="status">
              No verified source game is available.
            </p>
          ) : (
            <ul className="mt-4 grid gap-3">
              {player.sourceGames.map((game) => (
                <li
                  className="rounded-xl border border-[var(--line)] bg-white p-4"
                  key={game.gameId}
                >
                  <Link
                    className="inline-flex min-h-11 items-center underline"
                    href={`/games/${game.gameId}/box-score`}
                  >
                    Box score · {game.scheduledAt?.slice(0, 10) ?? game.gameId}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section
          aria-labelledby="player-version"
          className="mt-10 rounded-xl bg-slate-950 p-5 text-white"
        >
          <h2 className="text-xl font-semibold" id="player-version">
            Version and freshness
          </h2>
          <p className="mt-2 text-sm text-slate-300">
            Current source-derived · derivation{" "}
            {dashboard.version.derivationVersion} · source games{" "}
            {player.sourceGames.length}
          </p>
        </section>
      </main>
    </ApplicationShell>
  );
}
