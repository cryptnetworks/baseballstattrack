import { randomUUID } from "node:crypto";

import { cookies } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ApplicationShell } from "@/components/app/application-shell";
import { BoxScoreVerificationPanel } from "@/components/reports/box-score-verification-panel";
import type { GameBoxScore } from "@/domain/reports";
import { formatExactRate, formatInningsPitched } from "@/domain/statistics";
import { getGameBoxScoreService } from "@/server/app/game-box-score-service";
import { getGameSetupService } from "@/server/app/game-setup-service";
import { getAuthorizationService } from "@/server/auth/application";
import { AuthorizationError } from "@/server/auth/errors";
import { authenticatePageSession } from "@/server/auth/next-session";
import { authorizeProtectedRequest } from "@/server/auth/protected-boundary";
import { selectedAccountCookie } from "@/server/auth/request-security";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ gameId: string }>;
};

function words(value: string) {
  return value.replaceAll("_", " ").toLowerCase();
}

function playerName(report: GameBoxScore, playerId: string) {
  for (const side of ["AWAY", "HOME"] as const) {
    const player = report.teams[side].lineup.find(
      (candidate) => candidate.playerId === playerId,
    );
    if (player) return player.displayName;
  }
  return playerId;
}

function Rate({ value }: { value: Parameters<typeof formatExactRate>[0] }) {
  return formatExactRate(value, { omitLeadingZero: true }) ?? "—";
}

export function LineupTable({
  report,
  side,
}: {
  report: GameBoxScore;
  side: "AWAY" | "HOME";
}) {
  const team = report.teams[side];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[42rem] border-collapse text-sm">
        <caption className="pb-3 text-left text-lg font-semibold">
          {team.displayName} lineup
        </caption>
        <thead>
          <tr className="border-b border-[var(--line)] text-left">
            <th className="p-2" scope="col">
              Order
            </th>
            <th className="p-2" scope="col">
              Player
            </th>
            <th className="p-2" scope="col">
              No.
            </th>
            <th className="p-2" scope="col">
              Starting position
            </th>
            <th className="p-2" scope="col">
              Current position
            </th>
            <th className="p-2" scope="col">
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {team.lineup.map((player) => (
            <tr className="border-b border-[var(--line)]" key={player.playerId}>
              <td className="p-2">{player.battingOrder ?? "—"}</td>
              <th className="p-2 text-left font-medium" scope="row">
                {player.displayName}
              </th>
              <td className="p-2">{player.jerseyNumber ?? "—"}</td>
              <td className="p-2">
                {player.startingPosition ? words(player.startingPosition) : "—"}
              </td>
              <td className="p-2">
                {player.currentPosition ? words(player.currentPosition) : "—"}
              </td>
              <td className="p-2">
                {player.active
                  ? "active"
                  : player.participated
                    ? "participated"
                    : player.started
                      ? "starter"
                      : "did not enter"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function BattingTable({
  report,
  side,
}: {
  report: GameBoxScore;
  side: "AWAY" | "HOME";
}) {
  const team = report.teams[side];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] border-collapse text-sm">
        <caption className="pb-3 text-left text-lg font-semibold">
          {team.displayName} batting
        </caption>
        <thead>
          <tr className="border-b border-[var(--line)] text-right">
            <th className="p-2 text-left" scope="col">
              Player
            </th>
            {["PA", "AB", "R", "H", "RBI", "BB", "SO", "AVG"].map((label) => (
              <th className="p-2" key={label} scope="col">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {team.batting.map((line) => (
            <tr
              className="border-b border-[var(--line)] text-right"
              key={line.playerId}
            >
              <th className="p-2 text-left font-medium" scope="row">
                {playerName(report, line.playerId)}
              </th>
              <td className="p-2">{line.counters.plateAppearances}</td>
              <td className="p-2">{line.counters.atBats}</td>
              <td className="p-2">{line.counters.runs}</td>
              <td className="p-2">{line.counters.hits}</td>
              <td className="p-2">{line.counters.runsBattedIn}</td>
              <td className="p-2">{line.counters.walks}</td>
              <td className="p-2">{line.counters.strikeouts}</td>
              <td className="p-2">
                <Rate value={line.rates.battingAverage} />
              </td>
            </tr>
          ))}
          <tr className="bg-slate-50 text-right font-semibold">
            <th className="p-2 text-left" scope="row">
              Team totals
            </th>
            <td className="p-2">{team.totals.batting.plateAppearances}</td>
            <td className="p-2">{team.totals.batting.atBats}</td>
            <td className="p-2">{team.totals.batting.runs}</td>
            <td className="p-2">{team.totals.batting.hits}</td>
            <td className="p-2">{team.totals.batting.runsBattedIn}</td>
            <td className="p-2">{team.totals.batting.walks}</td>
            <td className="p-2">{team.totals.batting.strikeouts}</td>
            <td className="p-2">
              <Rate value={team.totals.batting.battingAverage} />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function PitchingTable({
  report,
  side,
}: {
  report: GameBoxScore;
  side: "AWAY" | "HOME";
}) {
  const team = report.teams[side];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[38rem] border-collapse text-sm">
        <caption className="pb-3 text-left text-lg font-semibold">
          {team.displayName} pitching
        </caption>
        <thead>
          <tr className="border-b border-[var(--line)] text-right">
            <th className="p-2 text-left" scope="col">
              Pitcher
            </th>
            {["IP", "BF", "H", "R", "ER", "BB", "SO", "ERA"].map((label) => (
              <th className="p-2" key={label} scope="col">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {team.pitching.map((line) => (
            <tr
              className="border-b border-[var(--line)] text-right"
              key={line.playerId}
            >
              <th className="p-2 text-left font-medium" scope="row">
                {playerName(report, line.playerId)}
              </th>
              <td className="p-2">
                {formatInningsPitched(line.counters.outsRecorded)}
              </td>
              <td className="p-2">{line.counters.battersFaced}</td>
              <td className="p-2">{line.counters.hitsAllowed}</td>
              <td className="p-2">{line.counters.runsAllowed}</td>
              <td className="p-2">{line.counters.earnedRuns}</td>
              <td className="p-2">{line.counters.walks}</td>
              <td className="p-2">{line.counters.strikeouts}</td>
              <td className="p-2">
                <Rate value={line.rates.earnedRunAverage} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function FieldingTable({
  report,
  side,
}: {
  report: GameBoxScore;
  side: "AWAY" | "HOME";
}) {
  const team = report.teams[side];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[28rem] border-collapse text-sm">
        <caption className="pb-3 text-left text-lg font-semibold">
          {team.displayName} fielding
        </caption>
        <thead>
          <tr className="border-b border-[var(--line)] text-right">
            <th className="p-2 text-left" scope="col">
              Fielder
            </th>
            {["PO", "A", "E", "FLD"].map((label) => (
              <th className="p-2" key={label} scope="col">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {team.fielding.map((line) => (
            <tr
              className="border-b border-[var(--line)] text-right"
              key={line.playerId}
            >
              <th className="p-2 text-left font-medium" scope="row">
                {playerName(report, line.playerId)}
              </th>
              <td className="p-2">{line.counters.putouts}</td>
              <td className="p-2">{line.counters.assists}</td>
              <td className="p-2">{line.counters.errors}</td>
              <td className="p-2">
                <Rate value={line.rates.fieldingPercentage} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function loadPage(accountId: string, gameId: string) {
  try {
    const authorization = getAuthorizationService();
    const reportActor = await authorizeProtectedRequest(
      authenticatePageSession,
      authorization,
      { kind: "GAME", accountId, gameId },
      "report.view",
    );
    const viewActor = await authorizeProtectedRequest(
      authenticatePageSession,
      authorization,
      { kind: "GAME", accountId, gameId },
      "game.view",
    );
    const current = await getGameSetupService().loadCurrentSetup(
      { accountId, gameId },
      viewActor,
    );
    if (!current.game.readySetupSnapshotId) return { current, report: null };
    const report = await getGameBoxScoreService().load(
      {
        accountId,
        gameId,
        setupSnapshotId: current.game.readySetupSnapshotId,
      },
      reportActor,
    );
    return { current, report };
  } catch (error) {
    if (error instanceof AuthorizationError) notFound();
    throw error;
  }
}

async function canVerify(
  accountId: string,
  gameId: string,
  mode: "VERIFY" | "REVERIFY",
) {
  try {
    await authorizeProtectedRequest(
      authenticatePageSession,
      getAuthorizationService(),
      { kind: "GAME", accountId, gameId },
      mode === "REVERIFY" ? "game.reverify" : "game.verify",
    );
    return true;
  } catch (error) {
    if (error instanceof AuthorizationError) return false;
    throw error;
  }
}

export default async function GameBoxScorePage({ params }: PageProps) {
  const { gameId } = await params;
  const accountId = (await cookies()).get(selectedAccountCookie.name)?.value;
  if (!accountId) redirect("/accounts");
  const { current, report } = await loadPage(accountId, gameId);
  if (!current.game.readySetupSnapshotId || !report) {
    redirect(`/games/setup/${gameId}`);
  }
  const verificationMode =
    report.reportState === "COMPLETED"
      ? ("VERIFY" as const)
      : report.reportState === "CORRECTED" ||
          report.reportState === "AWAITING_REVERIFICATION"
        ? ("REVERIFY" as const)
        : null;
  const verificationAllowed = verificationMode
    ? await canVerify(accountId, gameId, verificationMode)
    : false;
  const innings = [...new Set(report.innings.map(({ inning }) => inning))];

  return (
    <ApplicationShell>
      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 print:max-w-none print:p-0">
        <div className="flex flex-wrap items-start justify-between gap-4 print:block">
          <div>
            <p className="text-sm font-semibold text-[var(--accent-strong)]">
              {words(report.scoreKind)} box score
            </p>
            <h1 className="mt-1 text-3xl font-semibold">
              {report.teams.AWAY.displayName} at {report.teams.HOME.displayName}
            </h1>
            <p className="mt-2 text-sm text-[var(--muted)]">
              {words(report.reportState)} · source revision{" "}
              {report.version.sourceRevision} · setup revision{" "}
              {report.version.setupRevision}
            </p>
          </div>
          <Link
            className="inline-flex min-h-11 items-center rounded-lg border border-[var(--line)] bg-white px-4 font-medium print:hidden"
            href={`/games/score/${gameId}`}
          >
            Return to scorekeeping
          </Link>
        </div>

        <section
          aria-label="Box score status"
          className={`mt-6 rounded-xl border p-4 ${
            report.reportState === "VERIFIED"
              ? "border-emerald-300 bg-emerald-50"
              : "border-amber-300 bg-amber-50"
          }`}
        >
          <p className="font-semibold">
            {report.reportState === "VERIFIED"
              ? "Verified report"
              : `${words(report.reportState)} — not verified`}
          </p>
          <p className="mt-1 text-sm">
            {report.scoreKind === "CURRENT"
              ? "This is a current, provisional score. It is not a final result."
              : report.scoreKind === "TERMINATED"
                ? "This game ended without a verified final result."
                : report.version.verificationState === "VERIFIED"
                  ? "This exact source version is verified."
                  : "Review and verification are required before this result is trustworthy."}
          </p>
          {report.correctionStatus === "CORRECTED_HISTORY" ? (
            <p className="mt-2 text-sm font-medium">
              Corrected history · {report.version.correctionCount} correction
              {report.version.correctionCount === 1 ? "" : "s"} · latest
              correction revision {report.version.correctionRevision}
            </p>
          ) : null}
        </section>

        <section
          aria-label="Score by inning"
          className="mt-6 overflow-x-auto rounded-xl border border-[var(--line)] bg-white p-4"
        >
          <table className="w-full min-w-[34rem] border-collapse text-right">
            <caption className="pb-3 text-left text-xl font-semibold">
              {words(report.scoreKind)} score by inning
            </caption>
            <thead>
              <tr className="border-b border-[var(--line)]">
                <th className="p-2 text-left" scope="col">
                  Team
                </th>
                {innings.map((inning) => (
                  <th className="p-2" key={inning} scope="col">
                    {inning}
                  </th>
                ))}
                <th className="p-2" scope="col">
                  R
                </th>
                <th className="p-2" scope="col">
                  H
                </th>
                <th className="p-2" scope="col">
                  E
                </th>
              </tr>
            </thead>
            <tbody>
              {(["AWAY", "HOME"] as const).map((side) => (
                <tr className="border-b border-[var(--line)]" key={side}>
                  <th className="p-2 text-left font-medium" scope="row">
                    {report.teams[side].displayName}
                  </th>
                  {innings.map((inning) => (
                    <td className="p-2" key={inning}>
                      {report.innings.find(
                        (line) => line.side === side && line.inning === inning,
                      )?.runs ?? "—"}
                    </td>
                  ))}
                  <td className="p-2 font-semibold">{report.score[side]}</td>
                  <td className="p-2">
                    {report.teams[side].totals.batting.hits}
                  </td>
                  <td className="p-2">
                    {report.teams[side].totals.fielding.errors}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {verificationMode && verificationAllowed ? (
          <div className="mt-6 print:hidden">
            <BoxScoreVerificationPanel
              accountId={accountId}
              gameId={gameId}
              mode={verificationMode}
              setupSnapshotId={report.version.setupSnapshotId}
              sourceRevision={report.version.sourceRevision}
              submission={{
                eventId: randomUUID(),
                playTransactionId: randomUUID(),
                clientSubmissionId: randomUUID(),
                recordedAt: new Date().toISOString(),
              }}
            />
          </div>
        ) : verificationMode ? (
          <p
            className="mt-6 rounded-xl border border-[var(--line)] bg-white p-4"
            role="status"
          >
            Verification requires authorization for this exact Account and game.
          </p>
        ) : null}

        {(["AWAY", "HOME"] as const).map((side) => (
          <section
            aria-labelledby={`${side.toLowerCase()}-team-heading`}
            className="mt-10 break-inside-avoid border-t border-[var(--line)] pt-8"
            key={side}
          >
            <h2
              className="mb-6 text-2xl font-semibold"
              id={`${side.toLowerCase()}-team-heading`}
            >
              {report.teams[side].displayName}
            </h2>
            <div className="grid gap-8">
              <LineupTable report={report} side={side} />
              <BattingTable report={report} side={side} />
              <PitchingTable report={report} side={side} />
              <FieldingTable report={report} side={side} />
            </div>
          </section>
        ))}

        <section
          aria-labelledby="report-version-heading"
          className="mt-10 rounded-xl bg-slate-950 p-4 text-white sm:p-6"
        >
          <h2 className="text-xl font-semibold" id="report-version-heading">
            Version and reconciliation
          </h2>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt className="text-slate-300">Freshness</dt>
              <dd>{words(report.version.freshness)}</dd>
            </div>
            <div>
              <dt className="text-slate-300">Projection checkpoint</dt>
              <dd>{words(report.version.projectionFreshness)}</dd>
            </div>
            <div>
              <dt className="text-slate-300">Privacy overlay revision</dt>
              <dd>{report.version.privacyOverlayRevision}</dd>
            </div>
            <div>
              <dt className="text-slate-300">Derivation / statistic rules</dt>
              <dd>
                {report.version.derivationVersion} /{" "}
                {report.version.statisticRulesVersion}
              </dd>
            </div>
            <div>
              <dt className="text-slate-300">Ruleset</dt>
              <dd>{report.version.rulesetVersionId}</dd>
            </div>
            <div>
              <dt className="text-slate-300">Generated</dt>
              <dd>
                <time dateTime={report.version.generatedAt}>
                  {report.version.generatedAt.slice(0, 19)} UTC
                </time>
              </dd>
            </div>
          </dl>
          <p className="mt-5 font-semibold text-emerald-300">
            Reconciliation {words(report.reconciliation.status)}
          </p>
          <ul className="mt-2 grid gap-1 text-sm text-slate-300 sm:grid-cols-2">
            {report.reconciliation.checks.map((check) => (
              <li key={check}>✓ {check}</li>
            ))}
          </ul>
        </section>
      </main>
    </ApplicationShell>
  );
}
