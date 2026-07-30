import { randomUUID } from "node:crypto";

import { cookies } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ApplicationShell } from "@/components/app/application-shell";
import { GameSetupWizard } from "@/components/game-setup/game-setup-wizard";
import type {
  ExternalLineupRow,
  ManagedLineupRow,
  SetupWorkflowDraft,
} from "@/features/game-setup/workflow";
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

function inputDateTime(value: Date | null) {
  return (value ?? new Date()).toISOString().slice(0, 16);
}

async function loadGameSetup(accountId: string, gameId: string) {
  try {
    const actor = await authorizeProtectedRequest(
      authenticatePageSession,
      getAuthorizationService(),
      { kind: "GAME", accountId, gameId },
      "game.setup",
    );
    return getGameSetupService().loadWorkflowContext(
      { accountId, gameId },
      actor,
    );
  } catch (error) {
    if (error instanceof AuthorizationError) notFound();
    throw error;
  }
}

export default async function GameSetupPage({ params }: PageProps) {
  const { gameId } = await params;
  const accountId = (await cookies()).get(selectedAccountCookie.name)?.value;
  if (!accountId) redirect("/accounts");
  const context = await loadGameSetup(accountId, gameId);
  const primary = context.teamSeasons.find(
    ({ id }) => id === context.game.teamSeasonId,
  );
  if (!primary || context.rulesets.length === 0) {
    return (
      <ApplicationShell>
        <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
          <h1 className="text-3xl font-semibold">Setup unavailable</h1>
          <p className="mt-3 text-[var(--muted)]" role="alert">
            This game needs an active managed team-season and ruleset before
            setup can continue.
          </p>
          <Link
            className="mt-6 inline-flex min-h-12 items-center rounded-lg border border-[var(--line)] bg-white px-4 font-medium"
            href="/games/setup"
          >
            Return to game setup
          </Link>
        </main>
      </ApplicationShell>
    );
  }

  const setup = context.setup;
  const primarySnapshot = setup?.teamSnapshots.find(
    ({ teamSeasonId }) => teamSeasonId === context.game.teamSeasonId,
  );
  const opponentSnapshot = setup?.teamSnapshots.find(
    ({ id }) => id !== primarySnapshot?.id,
  );

  const managedRows = (
    teamSeason: (typeof context.teamSeasons)[number],
  ): ManagedLineupRow[] => {
    const teamSnapshot = setup?.teamSnapshots.find(
      ({ teamSeasonId }) => teamSeasonId === teamSeason.id,
    );
    const currentRows = teamSeason.rosterEntries.map((entry) => {
      const slot = setup?.lineupSlots.find(
        ({ rosterEntryId, gameTeamSnapshotId }) =>
          rosterEntryId === entry.id && gameTeamSnapshotId === teamSnapshot?.id,
      );
      return {
        kind: "MANAGED" as const,
        selected: Boolean(slot),
        eligible:
          teamSeason.archivedAt === null &&
          teamSeason.team.status === "ACTIVE" &&
          entry.status === "ACTIVE" &&
          entry.archivedAt === null &&
          entry.endsAt === null &&
          context.game.scheduledAt !== null &&
          entry.startsAt <= context.game.scheduledAt &&
          entry.player.archivedAt === null,
        playerId: entry.playerId,
        rosterEntryId: entry.id,
        displayName: slot?.displayName ?? entry.player.displayName,
        jerseyNumber: slot?.jerseyNumber ?? entry.jerseyNumber,
        battingOrder: slot?.battingOrder ?? null,
        defensivePosition:
          slot?.defensivePosition ?? entry.primaryPosition ?? null,
        isStartingPitcher: slot?.isStartingPitcher ?? false,
      };
    });
    const knownRosterIds = new Set(
      currentRows.map(({ rosterEntryId }) => rosterEntryId),
    );
    const missingSnapshotRows =
      setup?.lineupSlots
        .filter(
          ({ gameTeamSnapshotId, rosterEntryId, playerId }) =>
            gameTeamSnapshotId === teamSnapshot?.id &&
            rosterEntryId !== null &&
            playerId !== null &&
            !knownRosterIds.has(rosterEntryId),
        )
        .map((slot) => ({
          kind: "MANAGED" as const,
          selected: true,
          eligible: false,
          playerId: slot.playerId!,
          rosterEntryId: slot.rosterEntryId!,
          displayName: slot.displayName,
          jerseyNumber: slot.jerseyNumber,
          battingOrder: slot.battingOrder,
          defensivePosition: slot.defensivePosition,
          isStartingPitcher: slot.isStartingPitcher,
        })) ?? [];
    return [...currentRows, ...missingSnapshotRows];
  };

  const externalRows: ExternalLineupRow[] =
    opponentSnapshot && !opponentSnapshot.isAccountTeam
      ? (setup?.lineupSlots ?? [])
          .filter(
            ({ gameTeamSnapshotId }) =>
              gameTeamSnapshotId === opponentSnapshot.id,
          )
          .map((slot) => ({
            kind: "EXTERNAL",
            clientId: slot.id,
            displayName: slot.displayName,
            jerseyNumber: slot.jerseyNumber,
            battingOrder: slot.battingOrder,
            defensivePosition: slot.defensivePosition,
            isStartingPitcher: slot.isStartingPitcher,
          }))
      : [];

  const opponentManaged = opponentSnapshot?.isAccountTeam
    ? context.teamSeasons.find(({ id }) => id === opponentSnapshot.teamSeasonId)
    : undefined;
  const initialDraft: SetupWorkflowDraft = {
    accountId,
    gameId,
    expectedSetupRevision: context.game.setupRevision,
    clientSubmissionId: randomUUID(),
    rulesetVersionId: setup?.rulesetVersionId ?? context.rulesets[0]!.id,
    managedTeamSeasonId: context.game.teamSeasonId,
    managedSide: primarySnapshot?.side ?? "HOME",
    scheduledAt: inputDateTime(setup?.scheduledAt ?? context.game.scheduledAt),
    location: setup?.location ?? context.game.location ?? "",
    weatherCondition:
      setup?.weatherCondition ?? context.game.weatherCondition ?? null,
    temperatureF: setup?.temperatureF ?? context.game.temperatureF ?? null,
    opponentKind: opponentSnapshot?.isAccountTeam ? "MANAGED" : "EXTERNAL",
    opponentTeamSeasonId: opponentManaged?.id ?? null,
    externalOpponentName:
      opponentSnapshot && !opponentSnapshot.isAccountTeam
        ? opponentSnapshot.displayName
        : "",
    managedLineup: managedRows(primary),
    opponentManagedLineup: opponentManaged ? managedRows(opponentManaged) : [],
    externalLineup:
      externalRows.length > 0
        ? externalRows
        : [
            {
              kind: "EXTERNAL",
              clientId: randomUUID(),
              displayName: "",
              jerseyNumber: null,
              battingOrder: null,
              defensivePosition: null,
              isStartingPitcher: false,
            },
          ],
  };
  const gameStatus =
    context.game.status === "DRAFT" || context.game.status === "READY"
      ? context.game.status
      : "IN_PROGRESS";

  return (
    <ApplicationShell>
      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
        <Link
          className="inline-flex min-h-11 items-center text-sm font-medium text-[var(--accent-strong)] underline-offset-4 hover:underline"
          href="/games/setup"
        >
          ← All game setups
        </Link>
        <div className="mt-3">
          <p className="text-sm font-semibold text-[var(--accent-strong)]">
            Pregame workflow
          </p>
          <h1 className="mt-1 text-3xl font-semibold">
            Configure {context.game.teamSeason.team.displayName}
          </h1>
        </div>
        <div className="mt-6">
          <GameSetupWizard
            initialDraft={initialDraft}
            initialGameStatus={gameStatus}
            managedTeamName={context.game.teamSeason.team.displayName}
            rulesets={context.rulesets.map((ruleset) => ({
              id: ruleset.id,
              label: `${ruleset.name} · version ${ruleset.version}${
                ruleset.status === "ARCHIVED" ? " · archived" : ""
              }`,
            }))}
            seasonName={context.game.teamSeason.season.displayName}
            teamSeasons={context.teamSeasons.map((teamSeason) => ({
              id: teamSeason.id,
              teamName: teamSeason.team.displayName,
              roster: managedRows(teamSeason),
            }))}
          />
        </div>
      </main>
    </ApplicationShell>
  );
}
