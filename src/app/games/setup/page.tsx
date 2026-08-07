import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { CreateGameForm } from "@/components/game-setup/create-game-form";
import { ApplicationShell } from "@/components/app/application-shell";
import {
  ActionLink,
  EmptyState,
  PageShell,
  SectionHeader,
  Surface,
} from "@/components/ui/product-primitives";
import { getGameSetupService } from "@/server/app/game-setup-service";
import { getAuthorizationService } from "@/server/auth/application";
import { AuthorizationError } from "@/server/auth/errors";
import { authenticatePageSession } from "@/server/auth/next-session";
import { authorizeProtectedRequest } from "@/server/auth/protected-boundary";
import { selectedAccountCookie } from "@/server/auth/request-security";

export const dynamic = "force-dynamic";

function defaultScheduledAt() {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  date.setMinutes(0, 0, 0);
  return date.toISOString().slice(0, 16);
}

async function loadGameSetupIndex() {
  const accountId = (await cookies()).get(selectedAccountCookie.name)?.value;
  if (!accountId) redirect("/accounts");
  try {
    const actor = await authorizeProtectedRequest(
      authenticatePageSession,
      getAuthorizationService(),
      { kind: "ACCOUNT", accountId },
      "game.create",
    );
    const context = await getGameSetupService().loadCreationContext(
      { accountId },
      actor,
    );
    return { accountId, context };
  } catch (error) {
    if (error instanceof AuthorizationError) redirect("/accounts");
    throw error;
  }
}

export default async function GameSetupIndexPage() {
  const { accountId, context } = await loadGameSetupIndex();
  return (
    <ApplicationShell>
      <PageShell>
        <SectionHeader
          eyebrow="Scorekeeping · pregame"
          title="Game setup"
          description="Create a draft, resume it from any device, and make the accepted setup ready before first pitch."
          actions={<ActionLink href="/accounts">Change account</ActionLink>}
        />

        <Surface labelledBy="resume-heading" className="mt-8">
          <h2 className="text-xl font-semibold" id="resume-heading">
            Resume a saved setup
          </h2>
          {context.games.length === 0 ? (
            <div className="mt-4">
              <EmptyState
                title="No saved setups"
                description="Create a game below when the teams and season are ready."
              />
            </div>
          ) : (
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {context.games.map((game) => {
                const sides =
                  game.setupSnapshots[0]?.teamSnapshots
                    .map(({ displayName }) => displayName)
                    .join(" vs ") ?? game.teamSeason.team.displayName;
                return (
                  <li key={game.id}>
                    <Link
                      className="block min-h-20 rounded-lg border border-[var(--line)] p-4 transition hover:border-[var(--accent)] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                      href={`/games/setup/${game.id}`}
                    >
                      <span className="block font-semibold">{sides}</span>
                      <span className="mt-1 block text-sm text-[var(--muted)]">
                        {game.status === "READY"
                          ? "Ready for first pitch"
                          : `Draft · revision ${game.setupRevision}`}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Surface>

        <Surface labelledBy="create-heading" className="mt-6">
          <h2 className="text-xl font-semibold" id="create-heading">
            Create a new game
          </h2>
          {context.teamSeasons.length === 0 ? (
            <p className="mt-3 text-sm text-red-800" role="alert">
              Create an active team-season before starting a game setup.
            </p>
          ) : (
            <CreateGameForm
              accountId={accountId}
              defaultScheduledAt={defaultScheduledAt()}
              teamSeasons={context.teamSeasons.map((teamSeason) => ({
                id: teamSeason.id,
                seasonId: teamSeason.seasonId,
                teamName: teamSeason.team.displayName,
                seasonName: teamSeason.season.displayName,
              }))}
            />
          )}
        </Surface>
      </PageShell>
    </ApplicationShell>
  );
}
