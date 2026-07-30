import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { CreateGameForm } from "@/components/game-setup/create-game-form";
import { ApplicationShell } from "@/components/app/application-shell";
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
      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-[var(--accent-strong)]">
              Pregame
            </p>
            <h1 className="mt-1 text-3xl font-semibold">Game setup</h1>
            <p className="mt-2 max-w-2xl text-[var(--muted)]">
              Create a draft, resume it from any device, and make the accepted
              setup ready before first pitch.
            </p>
          </div>
          <Link
            className="inline-flex min-h-12 items-center rounded-lg border border-[var(--line)] bg-white px-4 font-medium"
            href="/accounts"
          >
            Change account
          </Link>
        </div>

        <section
          aria-labelledby="resume-heading"
          className="mt-8 rounded-xl border border-[var(--line)] bg-white p-5"
        >
          <h2 className="text-xl font-semibold" id="resume-heading">
            Resume a saved setup
          </h2>
          {context.games.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--muted)]">
              No unstarted drafts are available.
            </p>
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
        </section>

        <section
          aria-labelledby="create-heading"
          className="mt-6 rounded-xl border border-[var(--line)] bg-white p-5"
        >
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
        </section>
      </main>
    </ApplicationShell>
  );
}
