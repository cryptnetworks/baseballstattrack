import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ApplicationShell } from "@/components/app/application-shell";
import type { SeasonDashboard, SeasonLeaderboardEntry } from "@/domain/reports";
import { formatExactRate, formatInningsPitched } from "@/domain/statistics";
import { getSeasonDashboardService } from "@/server/app/season-dashboard-service";
import { getAuthorizationService } from "@/server/auth/application";
import { AuthorizationError } from "@/server/auth/errors";
import { authenticatePageSession } from "@/server/auth/next-session";
import { authorizeProtectedRequest } from "@/server/auth/protected-boundary";
import { selectedAccountCookie } from "@/server/auth/request-security";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{
    selection?: string;
    teamId?: string;
    seasonId?: string;
    dateFrom?: string;
    dateTo?: string;
  }>;
};

function rate(value: SeasonLeaderboardEntry["rate"]) {
  return (
    formatExactRate(value, {
      precision: 3,
      omitLeadingZero: true,
    }) ?? "—"
  );
}

function Leaderboard({
  title,
  entries,
  sampleLabel,
  seasonId,
  teamId,
}: {
  title: string;
  entries: SeasonLeaderboardEntry[];
  sampleLabel: string;
  seasonId: string;
  teamId: string;
}) {
  return (
    <section aria-labelledby={`${title.toLowerCase()}-leaders-heading`}>
      <h3
        className="text-lg font-semibold"
        id={`${title.toLowerCase()}-leaders-heading`}
      >
        {title}
      </h3>
      <div className="mt-3 overflow-x-auto rounded-xl border border-[var(--line)] bg-white">
        <table className="w-full min-w-[28rem] border-collapse text-sm">
          <caption className="sr-only">
            Qualified {title.toLowerCase()} leaders
          </caption>
          <thead>
            <tr className="border-b border-[var(--line)] text-left">
              <th className="p-3" scope="col">
                Rank
              </th>
              <th className="p-3" scope="col">
                Player
              </th>
              <th className="p-3 text-right" scope="col">
                Rate
              </th>
              <th className="p-3 text-right" scope="col">
                {sampleLabel}
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr>
                <td className="p-4 text-[var(--muted)]" colSpan={4}>
                  No player currently meets the documented minimum.
                </td>
              </tr>
            ) : (
              entries.slice(0, 10).map((entry, index) => (
                <tr
                  className="border-b border-[var(--line)]"
                  key={entry.playerId}
                >
                  <td className="p-3">{index + 1}</td>
                  <th className="p-3 text-left font-medium" scope="row">
                    <Link
                      className="underline"
                      href={`/reports/season/players/${entry.playerId}?teamId=${teamId}&seasonId=${seasonId}`}
                    >
                      {entry.displayName}
                    </Link>
                  </th>
                  <td className="p-3 text-right">{rate(entry.rate)}</td>
                  <td className="p-3 text-right">{entry.sampleSize}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Dashboard({ dashboard }: { dashboard: SeasonDashboard }) {
  const officialGames =
    dashboard.record.wins + dashboard.record.losses + dashboard.record.ties;
  const printQuery = new URLSearchParams({
    teamId: dashboard.version.teamId,
    seasonId: dashboard.version.seasonId,
    ...(dashboard.selection.dateFrom
      ? { dateFrom: dashboard.selection.dateFrom }
      : {}),
    ...(dashboard.selection.dateTo
      ? { dateTo: dashboard.selection.dateTo }
      : {}),
  });
  return (
    <>
      <div className="mt-6 flex justify-end">
        <Link
          className="inline-flex min-h-11 items-center rounded-lg border border-[var(--line)] bg-white px-4 font-medium"
          href={`/reports/season/print?${printQuery.toString()}`}
        >
          Printable season report
        </Link>
      </div>
      <section
        aria-labelledby="season-summary-heading"
        className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <h2 className="sr-only" id="season-summary-heading">
          Season summary
        </h2>
        {[
          [
            "Official record",
            `${dashboard.record.wins}-${dashboard.record.losses}-${dashboard.record.ties}`,
          ],
          ["Verified games", String(officialGames)],
          ["Runs scored", String(dashboard.statistics.team.batting.runs)],
          ["Recent games shown", String(dashboard.recentGames.length)],
        ].map(([label, value]) => (
          <div
            className="rounded-xl border border-[var(--line)] bg-white p-5"
            key={label}
          >
            <p className="text-sm text-[var(--muted)]">{label}</p>
            <p className="mt-1 text-2xl font-semibold">{value}</p>
          </div>
        ))}
      </section>

      <section
        aria-labelledby="season-state-heading"
        className="mt-6 rounded-xl border border-[var(--line)] bg-white p-5"
      >
        <h2 className="text-xl font-semibold" id="season-state-heading">
          Inclusion and current state
        </h2>
        <p className="mt-2">
          Official record, leaders, and trends use verified games only.
          Unverified and incomplete games remain visible below without changing
          official totals.
        </p>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-[var(--muted)]">Incomplete</dt>
            <dd>{dashboard.record.incomplete}</dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">
              Corrected, awaiting reverification
            </dt>
            <dd>{dashboard.record.correctedAwaitingReverification}</dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">Abandoned</dt>
            <dd>{dashboard.record.abandoned}</dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">Cancelled</dt>
            <dd>{dashboard.record.cancelled}</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="leaders-heading" className="mt-10">
        <h2 className="text-2xl font-semibold" id="leaders-heading">
          Qualified leaders
        </h2>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Product defaults:{" "}
          {dashboard.inclusionPolicy.minimums.battingPlateAppearances} PA for
          batting average,{" "}
          {dashboard.inclusionPolicy.minimums.pitchingOutsRecorded} pitching
          outs for ERA, and {dashboard.inclusionPolicy.minimums.fieldingChances}{" "}
          fielding chances for fielding percentage. Sample size is always shown.
        </p>
        <div className="mt-5 grid gap-7 xl:grid-cols-3">
          <Leaderboard
            entries={dashboard.leaders.batting}
            sampleLabel="PA"
            seasonId={dashboard.version.seasonId}
            teamId={dashboard.version.teamId}
            title="Batting"
          />
          <Leaderboard
            entries={dashboard.leaders.pitching}
            sampleLabel="Outs"
            seasonId={dashboard.version.seasonId}
            teamId={dashboard.version.teamId}
            title="Pitching"
          />
          <Leaderboard
            entries={dashboard.leaders.fielding}
            sampleLabel="Chances"
            seasonId={dashboard.version.seasonId}
            teamId={dashboard.version.teamId}
            title="Fielding"
          />
        </div>
      </section>

      <section aria-labelledby="recent-games-heading" className="mt-10">
        <h2 className="text-2xl font-semibold" id="recent-games-heading">
          Recent games
        </h2>
        <div className="mt-4 overflow-x-auto rounded-xl border border-[var(--line)] bg-white">
          <table className="w-full min-w-[48rem] border-collapse text-sm">
            <caption className="sr-only">
              Current games ordered by scheduled date
            </caption>
            <thead>
              <tr className="border-b border-[var(--line)] text-left">
                {[
                  "Date",
                  "Opponent",
                  "Score",
                  "Result",
                  "Status",
                  "Confidence",
                  "Source",
                ].map((label) => (
                  <th className="p-3" key={label} scope="col">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dashboard.recentGames.length === 0 ? (
                <tr>
                  <td className="p-4 text-[var(--muted)]" colSpan={7}>
                    No games are available for this selection.
                  </td>
                </tr>
              ) : (
                dashboard.recentGames.map((game) => (
                  <tr
                    className="border-b border-[var(--line)]"
                    key={game.gameId}
                  >
                    <td className="p-3">
                      {game.scheduledAt?.slice(0, 10) ?? "Unscheduled"}
                    </td>
                    <th className="p-3 text-left font-medium" scope="row">
                      {game.opponentDisplayName}
                    </th>
                    <td className="p-3">
                      {game.scoreFor}–{game.scoreAgainst}
                    </td>
                    <td className="p-3">{game.result.toLowerCase()}</td>
                    <td className="p-3">
                      {game.status.replaceAll("_", " ").toLowerCase()}
                    </td>
                    <td className="p-3">{game.confidence.toLowerCase()}</td>
                    <td className="p-3">
                      <Link
                        className="underline"
                        href={`/games/${game.gameId}/box-score`}
                      >
                        Box score
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="trends-heading" className="mt-10">
        <h2 className="text-2xl font-semibold" id="trends-heading">
          Verified game trend
        </h2>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Textual run totals are the authoritative chart equivalent; no
          predictive or unverified values are included.
        </p>
        <ol className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {dashboard.trends.map((trend) => (
            <li
              className="rounded-xl border border-[var(--line)] bg-white p-4"
              key={trend.gameId}
            >
              <span className="font-medium">
                {trend.scheduledAt?.slice(0, 10) ?? "Unscheduled"}
              </span>
              <span className="block text-sm text-[var(--muted)]">
                {trend.result.toLowerCase()}: {trend.runsScored} scored,{" "}
                {trend.runsAllowed} allowed
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="players-heading" className="mt-10">
        <h2 className="text-2xl font-semibold" id="players-heading">
          Player season summaries
        </h2>
        <div className="mt-4 grid gap-5">
          {dashboard.players.map((player) => (
            <article
              className="scroll-mt-4 rounded-xl border border-[var(--line)] bg-white p-5"
              id={`player-${player.playerId}`}
              key={player.playerId}
            >
              <h3 className="text-xl font-semibold">
                <Link
                  className="underline"
                  href={`/reports/season/players/${player.playerId}?teamId=${dashboard.version.teamId}&seasonId=${dashboard.version.seasonId}`}
                >
                  {player.displayName}
                </Link>
              </h3>
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-[var(--muted)]">Batting</dt>
                  <dd>
                    {player.batting
                      ? `${player.batting.counters.plateAppearances} PA · ${player.batting.counters.hits} H · ${rate(player.batting.rates.battingAverage)} AVG`
                      : "No verified batting opportunities"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">Pitching</dt>
                  <dd>
                    {player.pitching
                      ? `${formatInningsPitched(player.pitching.counters.outsRecorded)} IP · ${player.pitching.counters.strikeouts} SO · ${rate(player.pitching.rates.earnedRunAverage)} ERA`
                      : "No verified pitching opportunities"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">Fielding</dt>
                  <dd>
                    {player.fielding
                      ? `${player.fielding.rates.chances} chances · ${player.fielding.counters.errors} E · ${rate(player.fielding.rates.fieldingPercentage)} FLD`
                      : "No verified fielding opportunities"}
                  </dd>
                </div>
              </dl>
              <ul className="mt-4 flex flex-wrap gap-3 text-sm">
                {player.sourceGames.map((game) => (
                  <li key={game.gameId}>
                    <Link
                      className="underline"
                      href={`/games/${game.gameId}/box-score`}
                    >
                      Source game{" "}
                      {game.scheduledAt?.slice(0, 10) ?? game.gameId}
                    </Link>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section
        aria-labelledby="freshness-heading"
        className="mt-10 rounded-xl bg-slate-950 p-5 text-white"
      >
        <h2 className="text-xl font-semibold" id="freshness-heading">
          Version and freshness
        </h2>
        <p className="mt-2 text-sm text-slate-300">
          Current source-derived data · derivation{" "}
          {dashboard.version.derivationVersion} · statistic rules{" "}
          {dashboard.version.statisticRulesVersion} · privacy overlay{" "}
          {dashboard.version.privacyOverlayRevision}
        </p>
      </section>
    </>
  );
}

export default async function SeasonDashboardPage({ searchParams }: PageProps) {
  const accountId = (await cookies()).get(selectedAccountCookie.name)?.value;
  if (!accountId) redirect("/accounts");
  const query = await searchParams;
  const authorization = getAuthorizationService();
  let accountActor;
  try {
    accountActor = await authorizeProtectedRequest(
      authenticatePageSession,
      authorization,
      { kind: "ACCOUNT", accountId },
      "report.view",
    );
  } catch (error) {
    if (error instanceof AuthorizationError) redirect("/accounts");
    throw error;
  }
  const service = getSeasonDashboardService();
  const choices = await service.listChoices(accountId, accountActor);
  const selected =
    choices.find(
      (choice) =>
        `${choice.teamId}:${choice.seasonId}` === query.selection ||
        (choice.teamId === query.teamId && choice.seasonId === query.seasonId),
    ) ?? choices[0];
  let dashboard: SeasonDashboard | null = null;
  if (selected) {
    const actor = await authorizeProtectedRequest(
      authenticatePageSession,
      authorization,
      { kind: "TEAM", accountId, teamId: selected.teamId },
      "report.view",
    );
    dashboard = await service.load(
      {
        accountId,
        teamId: selected.teamId,
        seasonId: selected.seasonId,
        dateFrom: query.dateFrom || null,
        dateTo: query.dateTo || null,
      },
      actor,
    );
  }

  return (
    <ApplicationShell>
      <main
        className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6"
        id="main-content"
        tabIndex={-1}
      >
        <p className="text-sm font-medium text-[var(--accent)]">
          Season reports
        </p>
        <h1 className="mt-1 text-3xl font-semibold">
          Season dashboard and leaderboards
        </h1>
        <p className="mt-2 max-w-3xl text-[var(--muted)]">
          Official results are derived from current effective history for
          verified games. Provisional and corrected games stay visibly separate.
        </p>

        <form
          aria-label="Dashboard filters"
          className="mt-6 grid gap-4 rounded-xl border border-[var(--line)] bg-white p-4 sm:grid-cols-2 lg:grid-cols-5"
          method="get"
        >
          <label className="grid gap-1 text-sm font-medium lg:col-span-2">
            Team and season
            <select
              className="min-h-11 rounded-lg border border-[var(--line)] bg-white px-3"
              defaultValue={
                selected ? `${selected.teamId}:${selected.seasonId}` : ""
              }
              name="selection"
              disabled={choices.length === 0}
            >
              {choices.map((choice) => (
                <option
                  key={choice.teamSeasonId}
                  value={`${choice.teamId}:${choice.seasonId}`}
                >
                  {choice.teamDisplayName} — {choice.seasonDisplayName}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium">
            From
            <input
              className="min-h-11 rounded-lg border border-[var(--line)] px-3"
              defaultValue={query.dateFrom}
              name="dateFrom"
              type="date"
            />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Through
            <input
              className="min-h-11 rounded-lg border border-[var(--line)] px-3"
              defaultValue={query.dateTo}
              name="dateTo"
              type="date"
            />
          </label>
          <button
            className="min-h-11 self-end rounded-lg bg-[var(--accent)] px-4 font-medium text-white"
            type="submit"
          >
            Apply filters
          </button>
        </form>

        {dashboard ? (
          <Dashboard dashboard={dashboard} />
        ) : (
          <p
            className="mt-8 rounded-xl border border-[var(--line)] bg-white p-6"
            role="status"
          >
            No active team-season is available for this Account.
          </p>
        )}
      </main>
    </ApplicationShell>
  );
}
