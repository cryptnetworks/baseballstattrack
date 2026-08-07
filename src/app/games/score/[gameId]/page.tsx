import { randomUUID } from "node:crypto";

import { cookies } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ApplicationShell } from "@/components/app/application-shell";
import { PageShell } from "@/components/ui/product-primitives";
import { LiveLineupChangesPanel } from "@/components/scoring/live-lineup-changes-panel";
import { PlateAppearancePanel } from "@/components/scoring/plate-appearance-panel";
import {
  BaseState,
  RunnerBaseOutPanel,
} from "@/components/scoring/runner-base-out-panel";
import { ScoringCorrectionsPanel } from "@/components/scoring/scoring-corrections-panel";
import { ScoringRecoveryBoundary } from "@/components/scoring/scoring-recovery-boundary";
import { replayGame, type AcceptedEvent } from "@/domain/events/event-log";
import {
  buildCorrectionAudit,
  buildRecentPlayHistory,
  countRecentPlayHistory,
} from "@/features/scoring/scoring-corrections";
import { getGameEventService } from "@/server/app/game-event-service";
import { getGameSetupService } from "@/server/app/game-setup-service";
import { getAuthorizationService } from "@/server/auth/application";
import { AuthorizationError } from "@/server/auth/errors";
import { authenticatePageSession } from "@/server/auth/next-session";
import { authorizeProtectedRequest } from "@/server/auth/protected-boundary";
import { selectedAccountCookie } from "@/server/auth/request-security";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ gameId: string }>;
  searchParams: Promise<{ correctionPage?: string | string[] }>;
};

async function loadScoringContext(accountId: string, gameId: string) {
  try {
    const actor = await authorizeProtectedRequest(
      authenticatePageSession,
      getAuthorizationService(),
      { kind: "GAME", accountId, gameId },
      "game.view",
    );
    const current = await getGameSetupService().loadCurrentSetup(
      { accountId, gameId },
      actor,
    );
    const setupSnapshotId = current.game.readySetupSnapshotId;
    if (!setupSnapshotId || !current.setup) {
      return { acceptedSetup: null, current, state: null };
    }
    const history = await getGameEventService().loadAcceptedHistory(
      accountId,
      gameId,
      setupSnapshotId,
      actor,
    );
    return {
      acceptedSetup: history.setup,
      current,
      state: replayGame(history.setup, history.events, {
        verifyEvidence: true,
      }).state,
      events: history.events,
    };
  } catch (error) {
    if (error instanceof AuthorizationError) notFound();
    throw error;
  }
}

async function canCorrectGame(accountId: string, gameId: string) {
  try {
    await authorizeProtectedRequest(
      authenticatePageSession,
      getAuthorizationService(),
      { kind: "GAME", accountId, gameId },
      "game.correct",
    );
    return true;
  } catch (error) {
    if (error instanceof AuthorizationError) return false;
    throw error;
  }
}

export default async function ScoreGamePage({
  params,
  searchParams,
}: PageProps) {
  const { gameId } = await params;
  const accountId = (await cookies()).get(selectedAccountCookie.name)?.value;
  if (!accountId) redirect("/accounts");
  const {
    acceptedSetup,
    current,
    state,
    events = [],
  } = await loadScoringContext(accountId, gameId);
  if (!current.setup || !current.game.readySetupSnapshotId || !acceptedSetup) {
    redirect(`/games/setup/${gameId}`);
  }

  const playerNames = Object.fromEntries(
    current.setup.lineupSlots.map((slot) => [
      slot.playerId ?? slot.id,
      slot.displayName,
    ]),
  );
  const teams = Object.fromEntries(
    current.setup.teamSnapshots.map((team) => [team.side, team.displayName]),
  ) as Record<"HOME" | "AWAY", string>;

  if (!state) redirect(`/games/setup/${gameId}`);
  const defenseSide = state.half === "TOP" ? "HOME" : "AWAY";
  const defenders = Object.entries(state.defense[defenseSide])
    .map(([position, id]) => ({
      id,
      label: `${playerNames[id] ?? id} · ${position
        .replaceAll("_", " ")
        .toLowerCase()}`,
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
  const lastEvent = events.at(-1);
  const lastAcceptedAction = summarizeLastAction(lastEvent);
  const correctionAccess = await canCorrectGame(accountId, gameId);
  const correctionHistoryCount = correctionAccess
    ? countRecentPlayHistory(events)
    : 0;
  const correctionAudit = correctionAccess
    ? buildCorrectionAudit(acceptedSetup, events)
    : [];
  const rawCorrectionPage = (await searchParams).correctionPage;
  const requestedCorrectionPage = Number.parseInt(
    Array.isArray(rawCorrectionPage)
      ? (rawCorrectionPage[0] ?? "1")
      : (rawCorrectionPage ?? "1"),
    10,
  );
  const correctionPageCount = Math.max(
    1,
    Math.ceil(correctionHistoryCount / 10),
  );
  const correctionPage = Math.min(
    correctionPageCount - 1,
    Math.max(
      0,
      Number.isFinite(requestedCorrectionPage)
        ? requestedCorrectionPage - 1
        : 0,
    ),
  );
  const correctionHistory = correctionAccess
    ? buildRecentPlayHistory(acceptedSetup, events, playerNames, {
        offset: correctionPage * 10,
        limit: 10,
      })
    : [];

  return (
    <ApplicationShell>
      <PageShell className="max-w-6xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-[var(--accent-strong)]">
              Live scorekeeping
            </p>
            <h1 className="mt-1 text-3xl font-semibold">
              {teams.AWAY} at {teams.HOME}
            </h1>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Setup revision {state.setupRevision} · source revision{" "}
              {state.sourceRevision} · {state.rulesetVersionId}
            </p>
          </div>
          <Link
            className="inline-flex min-h-11 items-center rounded-lg border border-[var(--line)] bg-white px-4 font-medium"
            href={`/games/setup/${gameId}`}
          >
            View accepted setup
          </Link>
          <Link
            className="inline-flex min-h-11 items-center rounded-lg border border-[var(--line)] bg-white px-4 font-medium"
            href={`/games/${gameId}/box-score`}
          >
            View box score
          </Link>
        </div>

        <section
          aria-label="Game state"
          className="mt-6 rounded-xl bg-slate-950 p-4 text-white"
        >
          <p aria-atomic="true" aria-live="polite" className="sr-only">
            {state.half?.toLowerCase()} of inning {state.inning}, {state.outs}{" "}
            outs. {teams.AWAY} {state.score.AWAY}, {teams.HOME}{" "}
            {state.score.HOME}.
          </p>
          <dl className="grid gap-3 sm:grid-cols-4">
            <div>
              <dt className="text-sm text-slate-300">Inning</dt>
              <dd className="text-2xl font-semibold">
                {state.half?.toLowerCase()} {state.inning}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-slate-300">Outs</dt>
              <dd className="text-2xl font-semibold">{state.outs}</dd>
            </div>
            <div>
              <dt className="text-sm text-slate-300">{teams.AWAY}</dt>
              <dd className="text-2xl font-semibold">{state.score.AWAY}</dd>
            </div>
            <div>
              <dt className="text-sm text-slate-300">{teams.HOME}</dt>
              <dd className="text-2xl font-semibold">{state.score.HOME}</dd>
            </div>
          </dl>
        </section>

        <ScoringRecoveryBoundary
          context={{
            accountId,
            gameId,
            setupSnapshotId: current.game.readySetupSnapshotId,
            setupRevision: state.setupRevision,
            sourceRevision: state.sourceRevision,
            acceptedSubmissionIds: events.map(
              ({ clientSubmissionId }) => clientSubmissionId,
            ),
          }}
        />

        {state.status === "IN_PROGRESS" ? (
          <>
            <div className="mt-6">
              <PlateAppearancePanel
                accountId={accountId}
                defenders={defenders}
                gameId={gameId}
                initialClientSubmissionId={randomUUID()}
                key={`plate-${state.sourceRevision}`}
                lastAcceptedAction={lastAcceptedAction}
                playerNames={playerNames}
                setupSnapshotId={current.game.readySetupSnapshotId}
                state={state}
              />
            </div>
            <LiveLineupChangesPanel
              accountId={accountId}
              gameId={gameId}
              initialClientSubmissionId={randomUUID()}
              key={`lineup-${state.sourceRevision}`}
              playerNames={playerNames}
              setupSnapshotId={current.game.readySetupSnapshotId}
              state={state}
            />
            <section
              aria-labelledby="runner-only-heading"
              className="mt-10 border-t border-[var(--line)] pt-8"
              id="runner-only-actions"
            >
              <h2 className="text-2xl font-semibold" id="runner-only-heading">
                Runner-only actions
              </h2>
              <p className="mt-2 max-w-3xl text-[var(--muted)]">
                Record steals, pickoffs, wild pitches, passed balls, errors, or
                other advances that occur outside a completed plate appearance.
              </p>
              <div className="mt-5">
                <RunnerBaseOutPanel
                  accountId={accountId}
                  defenders={defenders}
                  gameId={gameId}
                  initialClientSubmissionId={randomUUID()}
                  key={`runner-${state.sourceRevision}`}
                  playerNames={playerNames}
                  setupSnapshotId={current.game.readySetupSnapshotId}
                  state={state}
                />
              </div>
            </section>
          </>
        ) : (
          <section className="mt-6">
            <div className="mt-5">
              <p
                className="rounded-xl border border-[var(--line)] bg-white p-4"
                role="status"
              >
                Runner entry is unavailable while the game is{" "}
                {state.status.toLowerCase()}.
              </p>
              <div className="mt-4 max-w-xl">
                <BaseState
                  bases={state.bases}
                  heading="Authoritative bases"
                  playerNames={playerNames}
                />
              </div>
            </div>
          </section>
        )}

        {correctionAccess ? (
          <ScoringCorrectionsPanel
            accountId={accountId}
            audit={correctionAudit}
            gameId={gameId}
            gameStatus={state.status}
            history={correctionHistory}
            page={correctionPage}
            pageCount={correctionPageCount}
            playerNames={playerNames}
            setupSnapshotId={current.game.readySetupSnapshotId}
            sourceRevision={state.sourceRevision}
            submission={{
              eventId: randomUUID(),
              playTransactionId: randomUUID(),
              idempotencyKey: randomUUID(),
              replacementId: randomUUID(),
              recordedAt: new Date().toISOString(),
            }}
          />
        ) : (
          <section
            aria-labelledby="corrections-unavailable-heading"
            className="mt-10 border-t border-[var(--line)] pt-8"
          >
            <h2
              className="text-2xl font-semibold"
              id="corrections-unavailable-heading"
            >
              Recent plays and corrections
            </h2>
            <p
              className="mt-4 rounded-xl border border-[var(--line)] bg-white p-4"
              role="status"
            >
              Correction history is available only to members authorized for
              this Account and game.
            </p>
          </section>
        )}
      </PageShell>
    </ApplicationShell>
  );
}

function summarizeLastAction(event: AcceptedEvent | undefined) {
  if (!event) return "none";
  if (event.eventType === "PlateAppearanceRecorded") {
    return event.payload.outcome.replaceAll("_", " ").toLowerCase();
  }
  if (event.eventType === "RunnerPlayRecorded") {
    return event.payload.playType.replaceAll("_", " ").toLowerCase();
  }
  return event.eventType.replaceAll(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}
