import { randomUUID } from "node:crypto";

import Link from "next/link";

import {
  changeFantasyRoster,
  controlFantasyLeague,
  updateFantasyNotifications,
} from "@/app/fantasy/actions";
import type { FantasyExperiencePresentation } from "@/domain/fantasy-experience";

export const fantasySections = [
  "overview",
  "team",
  "roster",
  "transactions",
  "standings",
  "scoring",
  "notifications",
  "commissioner",
] as const;

export type FantasySection = (typeof fantasySections)[number];

type Preference = Readonly<{
  id: string;
  channel: "EMAIL" | "DISCORD";
  subscribedEvents: readonly string[];
  status: "ACTIVE" | "OPTED_OUT" | "DISABLED";
  recipientEnabled: boolean;
  digestMode: "IMMEDIATE" | "DAILY_DIGEST";
  digestMinute: number;
  timeZone: string;
  quietHoursEnabled: boolean;
  quietStartMinute: number;
  quietEndMinute: number;
}>;

const sectionLabels: Record<FantasySection, string> = {
  overview: "League",
  team: "My team",
  roster: "Roster",
  transactions: "Transactions",
  standings: "Standings",
  scoring: "Scoring",
  notifications: "Notifications",
  commissioner: "Commissioner",
};

function points(milliPoints: number) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }).format(milliPoints / 1_000);
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function timeValue(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function Feedback({ notice, error }: { notice?: string; error?: string }) {
  if (!notice && !error) return null;
  return (
    <p
      className={`mt-5 rounded-lg border px-4 py-3 text-sm ${error ? "border-red-300 bg-red-50 text-red-900" : "border-emerald-300 bg-emerald-50 text-emerald-950"}`}
      role={error ? "alert" : "status"}
      tabIndex={-1}
    >
      {error ?? notice}
    </p>
  );
}

function HiddenContext({
  data,
  section,
}: {
  data: FantasyExperiencePresentation;
  section: FantasySection;
}) {
  return (
    <>
      <input name="accountId" type="hidden" value={data.accountId} />
      <input name="leagueId" type="hidden" value={data.leagueId} />
      <input name="teamId" type="hidden" value={data.selectedTeam?.id ?? ""} />
      <input name="section" type="hidden" value={section} />
      <input name="operationId" type="hidden" value={randomUUID()} />
      <input
        name="expectedRevision"
        type="hidden"
        value={data.transactionRevision}
      />
    </>
  );
}

function Overview({ data }: { data: FantasyExperiencePresentation }) {
  return (
    <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
      <section
        aria-labelledby="league-summary"
        className="rounded-xl border border-[var(--line)] bg-white p-5"
      >
        <h2 className="text-xl font-semibold" id="league-summary">
          League summary
        </h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-[var(--muted)]">Status</dt>
            <dd className="mt-1 font-semibold">
              {data.leagueStatus.replaceAll("_", " ")}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-[var(--muted)]">Lineup deadline</dt>
            <dd className="mt-1 font-semibold">
              <time dateTime={data.lineupDeadlineAt}>
                {dateTime(data.lineupDeadlineAt)} UTC
              </time>
            </dd>
          </div>
          <div>
            <dt className="text-sm text-[var(--muted)]">Roster</dt>
            <dd className="mt-1 font-semibold">
              {data.rosterHealth.filled} of {data.rosterHealth.total} slots
              filled
            </dd>
          </div>
          <div>
            <dt className="text-sm text-[var(--muted)]">Available players</dt>
            <dd className="mt-1 font-semibold">{data.availableMoveCount}</dd>
          </div>
        </dl>
      </section>
      <aside
        aria-labelledby="next-action"
        className="rounded-xl border border-[var(--accent)] bg-[var(--accent-soft)] p-5"
      >
        <h2 className="text-lg font-semibold" id="next-action">
          Next action
        </h2>
        <p className="mt-2 text-sm leading-6">{data.nextAction}</p>
        {data.rosterHealth.uncertainty > 0 ? (
          <p className="mt-3 font-semibold text-amber-900">
            {data.rosterHealth.uncertainty} scoring uncertainty item(s) remain
            visible.
          </p>
        ) : null}
      </aside>
    </div>
  );
}

function TeamView({ data }: { data: FantasyExperiencePresentation }) {
  return (
    <section
      aria-labelledby="team-heading"
      className="rounded-xl border border-[var(--line)] bg-white p-5"
    >
      <h2 className="text-xl font-semibold" id="team-heading">
        {data.selectedTeam?.name ?? "Fantasy team"}
      </h2>
      <p className="mt-2 text-sm text-[var(--muted)]">
        This entry references canonical baseball players. It does not copy
        private player identity fields.
      </p>
      <ul className="mt-5 grid gap-3 sm:grid-cols-3">
        <li className="rounded-lg bg-[var(--background)] p-4">
          <span className="block text-sm text-[var(--muted)]">
            Active lineup
          </span>
          <strong className="mt-1 block text-2xl">
            {
              data.roster.filter(
                ({ kind, playerEntryId }) => kind === "ACTIVE" && playerEntryId,
              ).length
            }
          </strong>
        </li>
        <li className="rounded-lg bg-[var(--background)] p-4">
          <span className="block text-sm text-[var(--muted)]">
            Current score
          </span>
          <strong className="mt-1 block text-2xl">
            {data.teamResult ? points(data.teamResult.totalMilliPoints) : "—"}
          </strong>
        </li>
        <li className="rounded-lg bg-[var(--background)] p-4">
          <span className="block text-sm text-[var(--muted)]">
            Pending claims
          </span>
          <strong className="mt-1 block text-2xl">
            {
              data.waiverClaims.filter(({ status }) => status === "PENDING")
                .length
            }
          </strong>
        </li>
      </ul>
    </section>
  );
}

function RosterView({ data }: { data: FantasyExperiencePresentation }) {
  const occupied = data.roster.filter(({ playerEntryId }) => playerEntryId);
  return (
    <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
      <section
        aria-labelledby="roster-heading"
        className="overflow-hidden rounded-xl border border-[var(--line)] bg-white"
      >
        <div className="p-5">
          <h2 className="text-xl font-semibold" id="roster-heading">
            Roster
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Lineup changes lock at {dateTime(data.lineupDeadlineAt)} UTC.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
            <caption className="sr-only">
              Current roster slots for {data.selectedTeam?.name}
            </caption>
            <thead className="bg-[var(--background)]">
              <tr>
                <th className="px-5 py-3" scope="col">
                  Slot
                </th>
                <th className="px-5 py-3" scope="col">
                  Status
                </th>
                <th className="px-5 py-3" scope="col">
                  Player
                </th>
                <th className="px-5 py-3" scope="col">
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {data.roster.map((slot) => (
                <tr className="border-t border-[var(--line)]" key={slot.slotId}>
                  <th className="px-5 py-3 font-medium" scope="row">
                    {slot.lineupSlot ?? slot.kind}
                  </th>
                  <td className="px-5 py-3">{slot.kind}</td>
                  <td className="px-5 py-3">{slot.playerName}</td>
                  <td className="px-5 py-3">
                    {data.canManageRoster && slot.playerEntryId ? (
                      <form action={changeFantasyRoster}>
                        <HiddenContext data={data} section="roster" />
                        <input
                          name="action"
                          type="hidden"
                          value="DROP_PLAYER"
                        />
                        <input
                          name="playerEntryId"
                          type="hidden"
                          value={slot.playerEntryId}
                        />
                        <button
                          className="min-h-11 rounded-lg border border-[var(--line)] px-3 font-medium"
                          type="submit"
                        >
                          Drop
                        </button>
                      </form>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className="space-y-5">
        <section
          aria-labelledby="lineup-change"
          className="rounded-xl border border-[var(--line)] bg-white p-5"
        >
          <h2 className="text-lg font-semibold" id="lineup-change">
            Move players
          </h2>
          {data.canManageRoster && occupied.length > 1 ? (
            <form action={changeFantasyRoster} className="mt-4 space-y-4">
              <HiddenContext data={data} section="roster" />
              <input name="action" type="hidden" value="LINEUP_SWAP" />
              <label className="block text-sm font-medium" htmlFor="first-slot">
                First slot
              </label>
              <select
                className="min-h-11 w-full rounded-lg border border-[var(--line)] bg-white px-3"
                id="first-slot"
                name="firstSlotId"
              >
                {occupied.map((slot) => (
                  <option key={slot.slotId} value={slot.slotId}>
                    {slot.lineupSlot ?? slot.kind}: {slot.playerName}
                  </option>
                ))}
              </select>
              <label
                className="block text-sm font-medium"
                htmlFor="second-slot"
              >
                Second slot
              </label>
              <select
                className="min-h-11 w-full rounded-lg border border-[var(--line)] bg-white px-3"
                id="second-slot"
                name="secondSlotId"
              >
                {occupied.map((slot) => (
                  <option key={slot.slotId} value={slot.slotId}>
                    {slot.lineupSlot ?? slot.kind}: {slot.playerName}
                  </option>
                ))}
              </select>
              <button
                className="min-h-11 rounded-lg bg-[var(--accent-strong)] px-4 font-semibold text-white"
                type="submit"
              >
                Save lineup move
              </button>
            </form>
          ) : (
            <p className="mt-3 text-sm text-[var(--muted)]">
              Two occupied slots and roster authority are required.
            </p>
          )}
        </section>
        <section
          aria-labelledby="waiver-heading"
          className="rounded-xl border border-[var(--line)] bg-white p-5"
        >
          <h2 className="text-lg font-semibold" id="waiver-heading">
            Player acquisition
          </h2>
          {data.canManageLeague &&
          data.availablePlayers.length &&
          data.roster.some(({ playerEntryId }) => !playerEntryId) ? (
            <form action={changeFantasyRoster} className="mt-4 space-y-4">
              <HiddenContext data={data} section="roster" />
              <input name="action" type="hidden" value="ADD_PLAYER" />
              <input name="commissioner" type="hidden" value="true" />
              <label
                className="block text-sm font-medium"
                htmlFor="assignment-player"
              >
                Commissioner assignment
              </label>
              <select
                className="min-h-11 w-full rounded-lg border border-[var(--line)] bg-white px-3"
                id="assignment-player"
                name="playerEntryId"
              >
                {data.availablePlayers.map((player) => (
                  <option
                    key={player.playerEntryId}
                    value={player.playerEntryId}
                  >
                    {player.playerName} · {player.eligiblePositions.join(", ")}
                  </option>
                ))}
              </select>
              <label
                className="block text-sm font-medium"
                htmlFor="assignment-slot"
              >
                Open roster slot
              </label>
              <select
                className="min-h-11 w-full rounded-lg border border-[var(--line)] bg-white px-3"
                id="assignment-slot"
                name="targetSlotId"
              >
                {data.roster
                  .filter(({ playerEntryId }) => !playerEntryId)
                  .map((slot) => (
                    <option key={slot.slotId} value={slot.slotId}>
                      {slot.lineupSlot ?? slot.kind}
                    </option>
                  ))}
              </select>
              <button
                className="min-h-11 rounded-lg border border-[var(--accent)] px-4 font-semibold text-[var(--accent-strong)]"
                type="submit"
              >
                Assign player
              </button>
            </form>
          ) : null}
          {data.canManageRoster &&
          data.availablePlayers.length &&
          data.roster.length ? (
            <form action={changeFantasyRoster} className="mt-4 space-y-4">
              <HiddenContext data={data} section="roster" />
              <input name="action" type="hidden" value="WAIVER_CLAIM" />
              <label
                className="block text-sm font-medium"
                htmlFor="available-player"
              >
                Player
              </label>
              <select
                className="min-h-11 w-full rounded-lg border border-[var(--line)] bg-white px-3"
                id="available-player"
                name="playerEntryId"
              >
                {data.availablePlayers.map((player) => (
                  <option
                    key={player.playerEntryId}
                    value={player.playerEntryId}
                  >
                    {player.playerName} · {player.eligiblePositions.join(", ")}
                  </option>
                ))}
              </select>
              <label
                className="block text-sm font-medium"
                htmlFor="target-slot"
              >
                Target slot
              </label>
              <select
                className="min-h-11 w-full rounded-lg border border-[var(--line)] bg-white px-3"
                id="target-slot"
                name="targetSlotId"
              >
                {data.roster.map((slot) => (
                  <option key={slot.slotId} value={slot.slotId}>
                    {slot.lineupSlot ?? slot.kind}: {slot.playerName}
                  </option>
                ))}
              </select>
              <label
                className="block text-sm font-medium"
                htmlFor="conditional-drop"
              >
                Conditional drop
              </label>
              <select
                className="min-h-11 w-full rounded-lg border border-[var(--line)] bg-white px-3"
                id="conditional-drop"
                name="conditionalDropPlayerEntryId"
              >
                <option value="">None</option>
                {occupied.map((slot) => (
                  <option key={slot.playerEntryId} value={slot.playerEntryId!}>
                    {slot.playerName}
                  </option>
                ))}
              </select>
              <button
                className="min-h-11 rounded-lg bg-[var(--accent-strong)] px-4 font-semibold text-white"
                type="submit"
              >
                Submit waiver claim
              </button>
            </form>
          ) : (
            <p className="mt-3 text-sm text-[var(--muted)]">
              No eligible waiver move is available.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

function TransactionsView({ data }: { data: FantasyExperiencePresentation }) {
  return (
    <section
      aria-labelledby="transactions-heading"
      className="overflow-hidden rounded-xl border border-[var(--line)] bg-white"
    >
      <div className="p-5">
        <h2 className="text-xl font-semibold" id="transactions-heading">
          Transaction history
        </h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Append-only league activity. Duplicate submissions reuse their
          original outcome.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[42rem] text-left text-sm">
          <caption className="sr-only">
            Fantasy transaction audit history
          </caption>
          <thead className="bg-[var(--background)]">
            <tr>
              <th className="px-5 py-3" scope="col">
                When
              </th>
              <th className="px-5 py-3" scope="col">
                Action
              </th>
              <th className="px-5 py-3" scope="col">
                Status
              </th>
              <th className="px-5 py-3" scope="col">
                Revision
              </th>
              <th className="px-5 py-3" scope="col">
                Players affected
              </th>
            </tr>
          </thead>
          <tbody>
            {data.transactions.length ? (
              [...data.transactions].reverse().map((item) => (
                <tr
                  className="border-t border-[var(--line)]"
                  key={item.operationId}
                >
                  <td className="px-5 py-3">
                    <time dateTime={item.submittedAt}>
                      {dateTime(item.submittedAt)} UTC
                    </time>
                  </td>
                  <th className="px-5 py-3 font-medium" scope="row">
                    {item.action.replaceAll("_", " ")}
                  </th>
                  <td className="px-5 py-3">{item.status}</td>
                  <td className="px-5 py-3">
                    {item.beforeRevision} → {item.afterRevision}
                  </td>
                  <td className="px-5 py-3">
                    {item.affectedPlayerEntryIds.length}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="px-5 py-5 text-[var(--muted)]" colSpan={5}>
                  No transactions recorded.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StandingsView({ data }: { data: FantasyExperiencePresentation }) {
  const teamName = (id: string) =>
    data.teams.find((team) => team.id === id)?.name ?? "Unavailable team";
  return (
    <section
      aria-labelledby="standings-heading"
      className="overflow-hidden rounded-xl border border-[var(--line)] bg-white"
    >
      <div className="p-5">
        <h2 className="text-xl font-semibold" id="standings-heading">
          Standings
        </h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {data.standings
            ? `Through period ${data.standings.throughPeriodSequence} · ${data.standings.status.replaceAll("_", " ")}`
            : "Standings appear after a verified matchup result."}
        </p>
      </div>
      {data.standings ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <caption className="sr-only">Fantasy league standings</caption>
            <thead className="bg-[var(--background)]">
              <tr>
                <th className="px-5 py-3" scope="col">
                  Rank
                </th>
                <th className="px-5 py-3" scope="col">
                  Team
                </th>
                <th className="px-5 py-3" scope="col">
                  W–L–T
                </th>
                <th className="px-5 py-3" scope="col">
                  Points for
                </th>
                <th className="px-5 py-3" scope="col">
                  Streak
                </th>
                <th className="px-5 py-3" scope="col">
                  Playoffs
                </th>
              </tr>
            </thead>
            <tbody>
              {data.standings.records.map((record) => (
                <tr
                  className="border-t border-[var(--line)]"
                  key={record.fantasyTeamId}
                >
                  <td className="px-5 py-3">{record.rank}</td>
                  <th className="px-5 py-3 font-medium" scope="row">
                    {teamName(record.fantasyTeamId)}
                  </th>
                  <td className="px-5 py-3">
                    {record.wins}–{record.losses}–{record.ties}
                  </td>
                  <td className="px-5 py-3">{points(record.pointsForMilli)}</td>
                  <td className="px-5 py-3">{record.currentStreak}</td>
                  <td className="px-5 py-3">
                    {record.playoffQualification.replaceAll("_", " ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="border-t border-[var(--line)] p-5 text-sm text-[var(--muted)]">
          No calculated standings yet.
        </p>
      )}
    </section>
  );
}

function ScoringView({ data }: { data: FantasyExperiencePresentation }) {
  const result = data.teamResult;
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section
        aria-labelledby="score-heading"
        className="rounded-xl border border-[var(--line)] bg-white p-5"
      >
        <h2 className="text-xl font-semibold" id="score-heading">
          Scoring result
        </h2>
        {result ? (
          <>
            <p className="mt-5 text-4xl font-semibold">
              {points(result.totalMilliPoints)}{" "}
              <span className="text-base font-normal text-[var(--muted)]">
                points
              </span>
            </p>
            <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-[var(--muted)]">Status</dt>
                <dd className="font-semibold">
                  {result.status.replaceAll("_", " ")}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Result revision</dt>
                <dd className="font-semibold">{result.revision}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Fantasy model</dt>
                <dd className="font-mono text-xs">
                  {result.lineage.fantasyModelVersionId}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Source revisions</dt>
                <dd className="font-semibold">
                  {result.lineage.sourceRevisions.join(", ") || "Unavailable"}
                </dd>
              </div>
            </dl>
          </>
        ) : (
          <p className="mt-4 text-sm text-[var(--muted)]">
            No verified baseball statistics have produced a team result.
          </p>
        )}
      </section>
      <section
        aria-labelledby="uncertainty-heading"
        className="rounded-xl border border-[var(--line)] bg-white p-5"
      >
        <h2 className="text-xl font-semibold" id="uncertainty-heading">
          Uncertainty
        </h2>
        {result?.uncertainties.length ? (
          <ul className="mt-4 space-y-3">
            {result.uncertainties.map((item, index) => (
              <li
                className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
                key={`${item.code}-${index}`}
              >
                <strong className="block">
                  {item.code.replaceAll("_", " ")}
                </strong>
                <span>
                  Roster slot {item.rosterSlotId}; completed{" "}
                  {item.completedGames ?? "unknown"} of{" "}
                  {item.expectedGames ?? "unknown"} expected games.
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-[var(--muted)]">
            {result
              ? "No unresolved scoring uncertainty is reported."
              : "Status remains unavailable until scoring sources are calculated."}
          </p>
        )}
        {result?.correction ? (
          <p className="mt-4 rounded-lg border border-blue-300 bg-blue-50 p-3 text-sm text-blue-950">
            Corrected result: {result.correction.reason}. Prior result lineage
            remains preserved.
          </p>
        ) : null}
      </section>
    </div>
  );
}

function NotificationsView({
  data,
  preferences,
}: {
  data: FantasyExperiencePresentation;
  preferences: readonly Preference[];
}) {
  return (
    <section
      aria-labelledby="notifications-heading"
      className="rounded-xl border border-[var(--line)] bg-white p-5"
    >
      <h2 className="text-xl font-semibold" id="notifications-heading">
        Notifications
      </h2>
      <p className="mt-2 max-w-3xl text-sm text-[var(--muted)]">
        Only previously consented, managed destinations can be used. Messages
        contain league result metadata, never private youth fields or player
        contact information.
      </p>
      {preferences.length ? (
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          {preferences.map((preference) => (
            <form
              action={updateFantasyNotifications}
              className="rounded-lg border border-[var(--line)] p-4"
              key={preference.id}
            >
              <input name="accountId" type="hidden" value={data.accountId} />
              <input name="leagueId" type="hidden" value={data.leagueId} />
              <input name="preferenceId" type="hidden" value={preference.id} />
              <h3 className="font-semibold">
                {preference.channel === "EMAIL" ? "Email" : "Discord"}
              </h3>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Destination is managed outside this league and is not displayed.
              </p>
              <fieldset className="mt-4 space-y-3">
                <legend className="text-sm font-semibold">Updates</legend>
                <label className="flex min-h-11 items-center gap-3">
                  <input
                    defaultChecked={preference.recipientEnabled}
                    name="recipientEnabled"
                    type="checkbox"
                  />
                  Enable this destination
                </label>
                <label className="flex min-h-11 items-center gap-3">
                  <input
                    defaultChecked={preference.subscribedEvents.includes(
                      "FANTASY_TRANSACTION_UPDATED",
                    )}
                    name="transactionUpdates"
                    type="checkbox"
                  />
                  Transaction updates
                </label>
                <label className="flex min-h-11 items-center gap-3">
                  <input
                    defaultChecked={preference.subscribedEvents.includes(
                      "FANTASY_SCORING_UPDATED",
                    )}
                    name="scoringUpdates"
                    type="checkbox"
                  />
                  Scoring updates
                </label>
                <label className="flex min-h-11 items-center gap-3">
                  <input
                    defaultChecked={preference.subscribedEvents.includes(
                      "FANTASY_MATCHUP_FINAL",
                    )}
                    name="matchupResults"
                    type="checkbox"
                  />
                  Matchup results
                </label>
              </fieldset>
              <label
                className="mt-4 block text-sm font-medium"
                htmlFor={`digest-${preference.id}`}
              >
                Delivery cadence
              </label>
              <select
                className="mt-1 min-h-11 w-full rounded-lg border border-[var(--line)] bg-white px-3"
                defaultValue={preference.digestMode}
                id={`digest-${preference.id}`}
                name="digestMode"
              >
                <option value="IMMEDIATE">Immediate</option>
                <option value="DAILY_DIGEST">Daily digest</option>
              </select>
              <label
                className="mt-4 block text-sm font-medium"
                htmlFor={`digest-time-${preference.id}`}
              >
                Daily digest time
              </label>
              <input
                className="mt-1 min-h-11 w-full rounded-lg border border-[var(--line)] px-3"
                defaultValue={timeValue(preference.digestMinute)}
                id={`digest-time-${preference.id}`}
                name="digestTime"
                type="time"
              />
              <label
                className="mt-4 block text-sm font-medium"
                htmlFor={`timezone-${preference.id}`}
              >
                Time zone
              </label>
              <input
                className="mt-1 min-h-11 w-full rounded-lg border border-[var(--line)] px-3"
                defaultValue={preference.timeZone}
                id={`timezone-${preference.id}`}
                name="timeZone"
              />
              <fieldset className="mt-4 grid gap-3 sm:grid-cols-2">
                <legend className="col-span-full text-sm font-semibold">
                  Quiet hours
                </legend>
                <label className="col-span-full flex min-h-11 items-center gap-3">
                  <input
                    defaultChecked={preference.quietHoursEnabled}
                    name="quietHoursEnabled"
                    type="checkbox"
                  />
                  Delay during quiet hours
                </label>
                <label
                  className="text-sm"
                  htmlFor={`quiet-start-${preference.id}`}
                >
                  Starts
                  <input
                    className="mt-1 min-h-11 w-full rounded-lg border border-[var(--line)] px-3"
                    defaultValue={timeValue(preference.quietStartMinute)}
                    id={`quiet-start-${preference.id}`}
                    name="quietStart"
                    type="time"
                  />
                </label>
                <label
                  className="text-sm"
                  htmlFor={`quiet-end-${preference.id}`}
                >
                  Ends
                  <input
                    className="mt-1 min-h-11 w-full rounded-lg border border-[var(--line)] px-3"
                    defaultValue={timeValue(preference.quietEndMinute)}
                    id={`quiet-end-${preference.id}`}
                    name="quietEnd"
                    type="time"
                  />
                </label>
              </fieldset>
              <button
                className="mt-5 min-h-11 rounded-lg bg-[var(--accent-strong)] px-4 font-semibold text-white"
                type="submit"
              >
                Save {preference.channel.toLowerCase()} settings
              </button>
            </form>
          ))}
        </div>
      ) : (
        <p className="mt-5 rounded-lg bg-[var(--background)] p-4 text-sm">
          No consented notification destination is configured for your Account.
          An Account administrator can configure one without exposing the
          destination here.
        </p>
      )}
    </section>
  );
}

function CommissionerView({ data }: { data: FantasyExperiencePresentation }) {
  if (!data.canManageLeague)
    return (
      <section className="rounded-xl border border-[var(--line)] bg-white p-5">
        <h2 className="text-xl font-semibold">Commissioner controls</h2>
        <p className="mt-3 text-sm text-[var(--muted)]">
          Commissioner permission is required.
        </p>
      </section>
    );
  const nextAction = data.leagueStatus === "PAUSED" ? "RESUME" : "PAUSE";
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section
        aria-labelledby="league-control"
        className="rounded-xl border border-[var(--line)] bg-white p-5"
      >
        <h2 className="text-xl font-semibold" id="league-control">
          League control
        </h2>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Actions append audit history. Reset requests never rewrite accepted
          baseball or fantasy results.
        </p>
        <form action={controlFantasyLeague} className="mt-5 space-y-4">
          <input name="accountId" type="hidden" value={data.accountId} />
          <input name="leagueId" type="hidden" value={data.leagueId} />
          <input name="caseId" type="hidden" value="" />
          <input name="resolution" type="hidden" value="" />
          <label className="block text-sm font-medium" htmlFor="control-action">
            Action
          </label>
          <select
            className="min-h-11 w-full rounded-lg border border-[var(--line)] bg-white px-3"
            defaultValue={nextAction}
            id="control-action"
            name="action"
          >
            <option value={nextAction}>
              {nextAction === "PAUSE" ? "Pause activity" : "Resume activity"}
            </option>
            <option value="RESET_WEEK">Request week reset review</option>
            <option value="OPEN_APPROVAL">Open approval case</option>
            <option value="OPEN_DISPUTE">Open dispute</option>
            <option value="ARCHIVE">Archive league</option>
            <option value="REQUEST_DELETION">Request deletion</option>
          </select>
          <label className="block text-sm font-medium" htmlFor="control-reason">
            Reason
          </label>
          <textarea
            className="min-h-24 w-full rounded-lg border border-[var(--line)] p-3"
            id="control-reason"
            maxLength={240}
            minLength={3}
            name="reason"
            required
          />
          <label className="flex items-start gap-3 text-sm">
            <input className="mt-1" name="confirm" required type="checkbox" />I
            understand this creates an audited control event and does not
            rewrite history.
          </label>
          <button
            className="min-h-11 rounded-lg bg-[var(--accent-strong)] px-4 font-semibold text-white"
            type="submit"
          >
            Record commissioner action
          </button>
        </form>
      </section>
      <section
        aria-labelledby="cases-heading"
        className="rounded-xl border border-[var(--line)] bg-white p-5"
      >
        <h2 className="text-xl font-semibold" id="cases-heading">
          Approval and dispute cases
        </h2>
        {data.commissionerCases.length ? (
          <ul className="mt-4 space-y-3">
            {data.commissionerCases.map((item) => (
              <li
                className="rounded-lg border border-[var(--line)] p-4"
                key={item.id}
              >
                <strong>
                  {item.kind} · {item.status}
                </strong>
                <p className="mt-1 text-sm">{item.summary}</p>
                <p className="mt-2 text-xs text-[var(--muted)]">
                  Opened {dateTime(item.openedAt)} UTC
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-[var(--muted)]">
            No commissioner cases are open.
          </p>
        )}
      </section>
    </div>
  );
}

export function FantasyLeagueManager({
  data,
  section,
  preferences,
  notice,
  error,
}: {
  data: FantasyExperiencePresentation;
  section: FantasySection;
  preferences: readonly Preference[];
  notice?: string;
  error?: string;
}) {
  const query = data.selectedTeam
    ? `?league=${data.leagueId}&team=${data.selectedTeam.id}`
    : `?league=${data.leagueId}`;
  return (
    <main
      className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6"
      id="main-content"
      tabIndex={-1}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-[var(--accent-strong)]">
            Fantasy baseball
          </p>
          <h1 className="mt-1 text-3xl font-semibold">{data.leagueName}</h1>
          <p className="mt-2 text-[var(--muted)]">
            Derived from verified baseball statistics. Fantasy actions never
            alter baseball truth.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            className="inline-flex min-h-11 items-center rounded-lg border border-[var(--line)] bg-white px-4 font-medium"
            href="/fantasy"
          >
            Change league
          </Link>
          {data.canManageLeague ? (
            <Link
              className="inline-flex min-h-11 items-center rounded-lg border border-[var(--line)] bg-white px-4 font-medium"
              href={`/api/fantasy/export?league=${data.leagueId}`}
            >
              Export
            </Link>
          ) : null}
        </div>
      </div>
      <Feedback {...(error ? { error } : {})} {...(notice ? { notice } : {})} />
      <nav
        aria-label="Fantasy league"
        className="mt-6 flex gap-1 overflow-x-auto border-b border-[var(--line)] pb-2"
      >
        {fantasySections
          .filter((item) => item !== "commissioner" || data.canManageLeague)
          .map((item) => (
            <Link
              aria-current={item === section ? "page" : undefined}
              className={`inline-flex min-h-11 shrink-0 items-center rounded-lg px-3 text-sm font-medium ${item === section ? "bg-[var(--accent-soft)] text-[var(--accent-strong)]" : "text-[var(--muted)] hover:bg-white"}`}
              href={`/fantasy/${item}${query}`}
              key={item}
            >
              {sectionLabels[item]}
            </Link>
          ))}
      </nav>
      <div className="mt-6">
        {section === "overview" ? (
          <Overview data={data} />
        ) : section === "team" ? (
          <TeamView data={data} />
        ) : section === "roster" ? (
          <RosterView data={data} />
        ) : section === "transactions" ? (
          <TransactionsView data={data} />
        ) : section === "standings" ? (
          <StandingsView data={data} />
        ) : section === "scoring" ? (
          <ScoringView data={data} />
        ) : section === "notifications" ? (
          <NotificationsView data={data} preferences={preferences} />
        ) : (
          <CommissionerView data={data} />
        )}
      </div>
    </main>
  );
}
