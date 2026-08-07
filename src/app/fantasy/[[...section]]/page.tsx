import { cookies } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { provisionFantasyLeague } from "@/app/fantasy/actions";
import { ApplicationShell } from "@/components/app/application-shell";
import {
  FantasyLeagueManager,
  fantasySections,
  type FantasySection,
} from "@/components/fantasy/fantasy-league-manager";
import { PageShell, SectionHeader } from "@/components/ui/product-primitives";
import { getFantasyExperienceService } from "@/server/app/fantasy-experience-service";
import { getAuthorizationService } from "@/server/auth/application";
import { AuthorizationError } from "@/server/auth/errors";
import { authenticatePageSession } from "@/server/auth/next-session";
import { selectedAccountCookie } from "@/server/auth/request-security";

export const dynamic = "force-dynamic";

function deadlineDefault() {
  const date = new Date(Date.now() + 7 * 86_400_000);
  date.setUTCHours(16, 0, 0, 0);
  return date.toISOString().slice(0, 16);
}

async function load(accountId: string) {
  const identity = await authenticatePageSession();
  const authorization = getAuthorizationService();
  const viewActor = await authorization.authorize(
    identity,
    { kind: "ACCOUNT", accountId },
    "fantasy.league.view",
  );
  let manageActor = null;
  try {
    manageActor = await authorization.authorize(
      identity,
      { kind: "ACCOUNT", accountId },
      "fantasy.league.manage",
    );
  } catch (error) {
    if (!(error instanceof AuthorizationError)) throw error;
  }
  const service = getFantasyExperienceService();
  const [choices, provisioningChoices] = await Promise.all([
    service.choices(accountId, viewActor),
    manageActor ? service.provisioningChoices(accountId, manageActor) : [],
  ]);
  return { service, viewActor, manageActor, choices, provisioningChoices };
}

export default async function FantasyPage({
  params,
  searchParams,
}: {
  params: Promise<{ section?: string[] }>;
  searchParams: Promise<{
    league?: string;
    team?: string;
    notice?: string;
    error?: string;
  }>;
}) {
  const path = (await params).section ?? [];
  if (path.length > 1) notFound();
  const parsedSection = z
    .enum(fantasySections)
    .safeParse(path[0] ?? "overview");
  if (!parsedSection.success) notFound();
  const section: FantasySection = parsedSection.data;
  const search = await searchParams;
  const accountId = (await cookies()).get(selectedAccountCookie.name)?.value;
  if (!accountId) redirect("/accounts");
  let workspace;
  try {
    workspace = await load(accountId);
  } catch (error) {
    if (error instanceof AuthorizationError) redirect("/accounts");
    throw error;
  }

  const requestedLeague = z.uuid().safeParse(search.league);
  if (requestedLeague.success) {
    const selectedTeam = z.uuid().safeParse(search.team);
    const league = await workspace.service.workspace(
      {
        accountId,
        leagueId: requestedLeague.data,
        teamId: selectedTeam.success ? selectedTeam.data : null,
      },
      workspace.viewActor,
      workspace.manageActor,
    );
    if (section === "commissioner" && !league.presentation.canManageLeague) {
      notFound();
    }
    return (
      <ApplicationShell>
        <FantasyLeagueManager
          data={league.presentation}
          {...(search.error ? { error: search.error } : {})}
          {...(search.notice ? { notice: search.notice } : {})}
          preferences={league.notificationPreferences}
          section={section}
        />
      </ApplicationShell>
    );
  }

  return (
    <ApplicationShell>
      <PageShell id="main-content" tabIndex={-1}>
        <SectionHeader
          eyebrow="Fantasy baseball"
          title="Fantasy leagues"
          description="Manage derived fantasy competition without changing canonical games, events, or statistics."
        />
        {search.error ? (
          <p
            className="mt-5 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900"
            role="alert"
          >
            {search.error}
          </p>
        ) : null}
        <div className="mt-8 grid gap-6 lg:grid-cols-[1.3fr_1fr]">
          <section
            aria-labelledby="league-list-heading"
            className="rounded-xl border border-[var(--line)] bg-white p-5"
          >
            <h2 className="text-xl font-semibold" id="league-list-heading">
              Your leagues
            </h2>
            {workspace.choices.length ? (
              <ul className="mt-4 grid gap-3">
                {workspace.choices.map((choice) => (
                  <li key={choice.id}>
                    <Link
                      className="block min-h-20 rounded-lg border border-[var(--line)] p-4 transition hover:border-[var(--accent)] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                      href={`/fantasy/overview?league=${choice.id}`}
                    >
                      <span className="font-semibold">{choice.name}</span>
                      <span className="mt-1 block text-sm text-[var(--muted)]">
                        {choice.seasonName} ·{" "}
                        {choice.status.replaceAll("_", " ")}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-sm text-[var(--muted)]">
                No fantasy leagues are available in this Account.
              </p>
            )}
          </section>
          <section
            aria-labelledby="create-league-heading"
            className="rounded-xl border border-[var(--line)] bg-white p-5"
          >
            <h2 className="text-xl font-semibold" id="create-league-heading">
              Create a league
            </h2>
            {!workspace.manageActor ? (
              <p className="mt-3 text-sm text-[var(--muted)]">
                Account administrator permission is required.
              </p>
            ) : workspace.provisioningChoices.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--muted)]">
                Create a baseball season before creating a fantasy league.
              </p>
            ) : (
              <form action={provisionFantasyLeague} className="mt-4 space-y-4">
                <input name="accountId" type="hidden" value={accountId} />
                <label
                  className="block text-sm font-medium"
                  htmlFor="season-id"
                >
                  Baseball season
                </label>
                <select
                  className="min-h-11 w-full rounded-lg border border-[var(--line)] bg-white px-3"
                  id="season-id"
                  name="seasonId"
                  required
                >
                  {workspace.provisioningChoices.map((season) => (
                    <option key={season.id} value={season.id}>
                      {season.name} · {season.playerCount} rostered players
                    </option>
                  ))}
                </select>
                <label
                  className="block text-sm font-medium"
                  htmlFor="league-name"
                >
                  League name
                </label>
                <input
                  className="min-h-11 w-full rounded-lg border border-[var(--line)] px-3"
                  id="league-name"
                  maxLength={120}
                  name="leagueName"
                  required
                />
                <label
                  className="block text-sm font-medium"
                  htmlFor="team-name"
                >
                  Your team name
                </label>
                <input
                  className="min-h-11 w-full rounded-lg border border-[var(--line)] px-3"
                  id="team-name"
                  maxLength={120}
                  name="teamName"
                  required
                />
                <label
                  className="block text-sm font-medium"
                  htmlFor="lineup-deadline"
                >
                  First lineup deadline (UTC)
                </label>
                <input
                  className="min-h-11 w-full rounded-lg border border-[var(--line)] px-3"
                  defaultValue={deadlineDefault()}
                  id="lineup-deadline"
                  name="lineupDeadlineAt"
                  required
                  type="datetime-local"
                />
                <button
                  className="min-h-11 rounded-lg bg-[var(--accent-strong)] px-4 font-semibold text-white"
                  type="submit"
                >
                  Create fantasy league
                </button>
              </form>
            )}
          </section>
        </div>
      </PageShell>
    </ApplicationShell>
  );
}
