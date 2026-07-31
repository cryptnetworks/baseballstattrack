import type {
  GameBoxScore,
  SeasonDashboard,
  SeasonLeaderboardEntry,
} from "@/domain/reports";
import { formatExactRate, formatInningsPitched } from "@/domain/statistics";
import { PrintAction } from "./print-action";

type MetadataItem = {
  label: string;
  value: string;
};

function words(value: string) {
  return value.replaceAll("_", " ").toLowerCase();
}

function timestamp(value: string) {
  return `${value.slice(0, 19)} UTC`;
}

function rate(
  value: Parameters<typeof formatExactRate>[0],
  omitLeadingZero = true,
) {
  return formatExactRate(value, { precision: 3, omitLeadingZero }) ?? "—";
}

function ReportFrame({
  title,
  subtitle,
  metadata,
  warning,
  orientation = "portrait",
  children,
}: {
  title: string;
  subtitle: string;
  metadata: readonly MetadataItem[];
  warning: string;
  orientation?: "portrait" | "landscape";
  children: React.ReactNode;
}) {
  return (
    <main
      className={`print-report print-report--${orientation} mx-auto max-w-6xl bg-white px-4 py-6 text-slate-950 sm:px-8`}
      id="main-content"
      tabIndex={-1}
    >
      <header className="print-report-header border-b-2 border-slate-950 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold tracking-wide uppercase">
              Authorized printable report
            </p>
            <h1 className="mt-1 text-3xl font-bold">{title}</h1>
            <p className="mt-1 text-base">{subtitle}</p>
          </div>
          <PrintAction />
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-4">
          {metadata.map((item) => (
            <div key={item.label}>
              <dt className="font-semibold">{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
        <p
          className="mt-4 border-2 border-slate-950 p-3 text-sm font-semibold"
          role="status"
        >
          {warning}
        </p>
      </header>
      {children}
      <footer className="print-report-footer mt-8 border-t border-slate-600 pt-3 text-xs">
        Authorized presentation only. Current source-derived data; generated
        time is not the game or source-event time.
      </footer>
    </main>
  );
}

function GameTeamTables({
  report,
  side,
}: {
  report: GameBoxScore;
  side: "AWAY" | "HOME";
}) {
  const team = report.teams[side];
  const name = (playerId: string) =>
    team.lineup.find((player) => player.playerId === playerId)?.displayName ??
    "Player";
  return (
    <section
      aria-labelledby={`print-${side.toLowerCase()}-heading`}
      className="print-report-section mt-8"
    >
      <h2
        className="text-2xl font-bold"
        id={`print-${side.toLowerCase()}-heading`}
      >
        {team.displayName}
      </h2>
      <div className="mt-4 grid gap-6">
        <div className="print-table-wrap">
          <table className="print-table w-full border-collapse text-xs">
            <caption className="pb-2 text-left text-base font-bold">
              Batting
            </caption>
            <thead>
              <tr>
                {["Player", "PA", "AB", "R", "H", "RBI", "BB", "SO", "AVG"].map(
                  (label) => (
                    <th key={label} scope="col">
                      {label}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {team.batting.map((line) => (
                <tr key={line.playerId}>
                  <th scope="row">{name(line.playerId)}</th>
                  <td>{line.counters.plateAppearances}</td>
                  <td>{line.counters.atBats}</td>
                  <td>{line.counters.runs}</td>
                  <td>{line.counters.hits}</td>
                  <td>{line.counters.runsBattedIn}</td>
                  <td>{line.counters.walks}</td>
                  <td>{line.counters.strikeouts}</td>
                  <td>{rate(line.rates.battingAverage)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="print-table-wrap">
          <table className="print-table w-full border-collapse text-xs">
            <caption className="pb-2 text-left text-base font-bold">
              Pitching and fielding
            </caption>
            <thead>
              <tr>
                <th scope="col">Player</th>
                <th scope="col">IP</th>
                <th scope="col">H</th>
                <th scope="col">R</th>
                <th scope="col">ER</th>
                <th scope="col">BB</th>
                <th scope="col">SO</th>
                <th scope="col">ERA</th>
                <th scope="col">PO</th>
                <th scope="col">A</th>
                <th scope="col">E</th>
              </tr>
            </thead>
            <tbody>
              {team.lineup
                .filter((player) =>
                  [...team.pitching, ...team.fielding].some(
                    (line) => line.playerId === player.playerId,
                  ),
                )
                .map((player) => {
                  const pitching = team.pitching.find(
                    (line) => line.playerId === player.playerId,
                  );
                  const fielding = team.fielding.find(
                    (line) => line.playerId === player.playerId,
                  );
                  return (
                    <tr key={player.playerId}>
                      <th scope="row">{player.displayName}</th>
                      <td>
                        {pitching
                          ? formatInningsPitched(pitching.counters.outsRecorded)
                          : "—"}
                      </td>
                      <td>{pitching?.counters.hitsAllowed ?? "—"}</td>
                      <td>{pitching?.counters.runsAllowed ?? "—"}</td>
                      <td>{pitching?.counters.earnedRuns ?? "—"}</td>
                      <td>{pitching?.counters.walks ?? "—"}</td>
                      <td>{pitching?.counters.strikeouts ?? "—"}</td>
                      <td>
                        {pitching
                          ? rate(pitching.rates.earnedRunAverage, false)
                          : "—"}
                      </td>
                      <td>{fielding?.counters.putouts ?? "—"}</td>
                      <td>{fielding?.counters.assists ?? "—"}</td>
                      <td>{fielding?.counters.errors ?? "—"}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

export function PrintableGameReport({ report }: { report: GameBoxScore }) {
  const innings = [...new Set(report.innings.map(({ inning }) => inning))];
  const warning =
    report.reportState === "VERIFIED"
      ? "Verified: this exact source revision is verified."
      : `${words(report.reportState)}: this report is not a verified final result.`;
  return (
    <ReportFrame
      metadata={[
        { label: "Report type", value: "Game box score" },
        { label: "Season", value: report.season.displayName },
        { label: "Game status", value: words(report.reportState) },
        {
          label: "Correction state",
          value:
            report.correctionStatus === "NONE"
              ? "none"
              : `corrected history (${report.version.correctionCount})`,
        },
        {
          label: "Verification",
          value: words(report.version.verificationState),
        },
        {
          label: "Source revision",
          value: String(report.version.sourceRevision),
        },
        {
          label: "Derivation / privacy",
          value: `${report.version.derivationVersion} / ${report.version.privacyOverlayRevision}`,
        },
        { label: "Generated", value: timestamp(report.version.generatedAt) },
      ]}
      orientation="landscape"
      subtitle={`${report.teams.AWAY.displayName} at ${report.teams.HOME.displayName}`}
      title="Printable game report"
      warning={warning}
    >
      <section aria-labelledby="print-score-heading" className="mt-6">
        <h2 className="sr-only" id="print-score-heading">
          Score by inning
        </h2>
        <div className="print-table-wrap">
          <table className="print-table w-full border-collapse text-sm">
            <caption className="pb-2 text-left text-xl font-bold">
              {words(report.scoreKind)} score by inning
            </caption>
            <thead>
              <tr>
                <th scope="col">Team</th>
                {innings.map((inning) => (
                  <th key={inning} scope="col">
                    {inning}
                  </th>
                ))}
                <th scope="col">R</th>
                <th scope="col">H</th>
                <th scope="col">E</th>
              </tr>
            </thead>
            <tbody>
              {(["AWAY", "HOME"] as const).map((side) => (
                <tr key={side}>
                  <th scope="row">{report.teams[side].displayName}</th>
                  {innings.map((inning) => (
                    <td key={inning}>
                      {report.innings.find(
                        (line) => line.side === side && line.inning === inning,
                      )?.runs ?? "—"}
                    </td>
                  ))}
                  <td>{report.score[side]}</td>
                  <td>{report.teams[side].totals.batting.hits}</td>
                  <td>{report.teams[side].totals.fielding.errors}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <GameTeamTables report={report} side="AWAY" />
      <GameTeamTables report={report} side="HOME" />
    </ReportFrame>
  );
}

function LeaderTable({
  title,
  sample,
  entries,
}: {
  title: string;
  sample: string;
  entries: readonly SeasonLeaderboardEntry[];
}) {
  return (
    <div className="print-table-wrap">
      <table className="print-table w-full border-collapse text-sm">
        <caption className="pb-2 text-left text-base font-bold">
          {title}
        </caption>
        <thead>
          <tr>
            <th scope="col">Rank</th>
            <th scope="col">Player</th>
            <th scope="col">Rate</th>
            <th scope="col">{sample}</th>
          </tr>
        </thead>
        <tbody>
          {entries.slice(0, 10).map((entry, index) => (
            <tr key={entry.playerId}>
              <td>{index + 1}</td>
              <th scope="row">{entry.displayName}</th>
              <td>{rate(entry.rate, title !== "Batting average")}</td>
              <td>{entry.sampleSize}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function seasonMetadata(
  dashboard: SeasonDashboard,
  generatedAt: string,
  reportType: string,
): MetadataItem[] {
  return [
    { label: "Report type", value: reportType },
    { label: "Team", value: dashboard.selection.teamDisplayName },
    { label: "Season", value: dashboard.selection.seasonDisplayName },
    {
      label: "Verification",
      value: `${dashboard.record.wins + dashboard.record.losses + dashboard.record.ties} verified games`,
    },
    {
      label: "Correction state",
      value: `${dashboard.record.correctedAwaitingReverification} awaiting reverification`,
    },
    {
      label: "Source revisions",
      value: `${dashboard.version.sourceRevisions.length} current games`,
    },
    {
      label: "Derivation / privacy",
      value: `${dashboard.version.derivationVersion} / ${dashboard.version.privacyOverlayRevision}`,
    },
    { label: "Generated", value: timestamp(generatedAt) },
  ];
}

export function PrintableSeasonReport({
  dashboard,
  generatedAt,
}: {
  dashboard: SeasonDashboard;
  generatedAt: string;
}) {
  return (
    <ReportFrame
      metadata={seasonMetadata(
        dashboard,
        generatedAt,
        "Team and season summary",
      )}
      orientation="landscape"
      subtitle={`${dashboard.selection.teamDisplayName} · ${dashboard.selection.seasonDisplayName}`}
      title="Printable season report"
      warning="Official totals and leaders include verified games only. Incomplete and corrected games remain outside official totals."
    >
      <section className="mt-6" aria-labelledby="print-season-summary">
        <h2 className="text-xl font-bold" id="print-season-summary">
          Team summary
        </h2>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="font-semibold">Official record</dt>
            <dd>
              {dashboard.record.wins}-{dashboard.record.losses}-
              {dashboard.record.ties}
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Runs / hits</dt>
            <dd>
              {dashboard.statistics.team.batting.runs} /{" "}
              {dashboard.statistics.team.batting.hits}
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Incomplete</dt>
            <dd>{dashboard.record.incomplete}</dd>
          </div>
          <div>
            <dt className="font-semibold">Abandoned / cancelled</dt>
            <dd>
              {dashboard.record.abandoned} / {dashboard.record.cancelled}
            </dd>
          </div>
        </dl>
      </section>
      <section className="print-report-section mt-8" aria-labelledby="leaders">
        <h2 className="text-xl font-bold" id="leaders">
          Season leaderboard summary
        </h2>
        <p className="mt-1 text-sm">
          Minimums: {dashboard.inclusionPolicy.minimums.battingPlateAppearances}{" "}
          PA, {dashboard.inclusionPolicy.minimums.pitchingOutsRecorded} pitching
          outs, {dashboard.inclusionPolicy.minimums.fieldingChances} fielding
          chances. Sample sizes are shown.
        </p>
        <div className="mt-4 grid gap-5 md:grid-cols-3">
          <LeaderTable
            entries={dashboard.leaders.batting}
            sample="PA"
            title="Batting average"
          />
          <LeaderTable
            entries={dashboard.leaders.pitching}
            sample="Outs"
            title="Earned run average"
          />
          <LeaderTable
            entries={dashboard.leaders.fielding}
            sample="Chances"
            title="Fielding percentage"
          />
        </div>
      </section>
      <section
        className="print-report-section mt-8"
        aria-labelledby="recent-games"
      >
        <h2 className="text-xl font-bold" id="recent-games">
          Recent games and correction state
        </h2>
        <div className="print-table-wrap mt-3">
          <table className="print-table w-full border-collapse text-sm">
            <thead>
              <tr>
                {[
                  "Date",
                  "Opponent",
                  "Score",
                  "Result",
                  "Status",
                  "Confidence",
                ].map((label) => (
                  <th key={label} scope="col">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dashboard.recentGames.map((game) => (
                <tr key={game.gameId}>
                  <td>{game.scheduledAt?.slice(0, 10) ?? "Unscheduled"}</td>
                  <th scope="row">{game.opponentDisplayName}</th>
                  <td>
                    {game.scoreFor}-{game.scoreAgainst}
                  </td>
                  <td>{words(game.result)}</td>
                  <td>{words(game.status)}</td>
                  <td>{words(game.confidence)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </ReportFrame>
  );
}

export function PrintablePlayerReport({
  dashboard,
  generatedAt,
  player,
}: {
  dashboard: SeasonDashboard;
  generatedAt: string;
  player: SeasonDashboard["players"][number];
}) {
  return (
    <ReportFrame
      metadata={seasonMetadata(dashboard, generatedAt, "Player season summary")}
      subtitle={`${dashboard.selection.teamDisplayName} · ${dashboard.selection.seasonDisplayName}`}
      title={`${player.displayName} — season summary`}
      warning="Player statistics include verified games only. Current effective history and privacy-resolved display identity are used."
    >
      <section
        className="mt-6 grid gap-5 sm:grid-cols-3"
        aria-label="Player statistics"
      >
        <div className="print-stat-block">
          <h2 className="text-lg font-bold">Batting</h2>
          <p className="mt-2 text-sm">
            {player.batting
              ? `${player.batting.counters.plateAppearances} PA · ${player.batting.counters.hits} H · ${rate(player.batting.rates.battingAverage)} AVG`
              : "No verified batting opportunities"}
          </p>
        </div>
        <div className="print-stat-block">
          <h2 className="text-lg font-bold">Pitching</h2>
          <p className="mt-2 text-sm">
            {player.pitching
              ? `${formatInningsPitched(player.pitching.counters.outsRecorded)} IP · ${player.pitching.counters.strikeouts} SO · ${rate(player.pitching.rates.earnedRunAverage, false)} ERA`
              : "No verified pitching opportunities"}
          </p>
        </div>
        <div className="print-stat-block">
          <h2 className="text-lg font-bold">Fielding</h2>
          <p className="mt-2 text-sm">
            {player.fielding
              ? `${player.fielding.rates.chances} chances · ${player.fielding.counters.errors} E · ${rate(player.fielding.rates.fieldingPercentage)} FLD`
              : "No verified fielding opportunities"}
          </p>
        </div>
      </section>
      <section className="print-report-section mt-8" aria-labelledby="sources">
        <h2 className="text-xl font-bold" id="sources">
          Verified source games
        </h2>
        <div className="print-table-wrap mt-3">
          <table className="print-table w-full border-collapse text-sm">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Verification</th>
                <th scope="col">Source revision</th>
              </tr>
            </thead>
            <tbody>
              {player.sourceGames.map((game) => {
                const source = dashboard.version.sourceRevisions.find(
                  ({ gameId }) => gameId === game.gameId,
                );
                return (
                  <tr key={game.gameId}>
                    <th scope="row">
                      {game.scheduledAt?.slice(0, 10) ?? "Unscheduled"}
                    </th>
                    <td>{words(game.verificationState)}</td>
                    <td>{source?.sourceRevision ?? "current"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </ReportFrame>
  );
}
