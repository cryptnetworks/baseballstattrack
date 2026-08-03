"use server";

import { randomUUID } from "node:crypto";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getFantasyExperienceService } from "@/server/app/fantasy-experience-service";
import { getAuthorizationService } from "@/server/auth/application";
import { AuthorizationError } from "@/server/auth/errors";
import { authenticatePageSession } from "@/server/auth/next-session";
import { authorizeProtectedAction } from "@/server/auth/protected-boundary";
import { selectedAccountCookie } from "@/server/auth/request-security";
import type { Capability } from "@/server/auth/types";

const id = z.string().trim().min(1).max(128);
const uuid = z.uuid();
const section = z.enum([
  "overview",
  "team",
  "roster",
  "transactions",
  "standings",
  "scoring",
  "notifications",
  "commissioner",
]);

async function authorize(accountId: string, capability: Capability) {
  const requestHeaders = await headers();
  if ((await cookies()).get(selectedAccountCookie.name)?.value !== accountId) {
    throw new AuthorizationError("ACCOUNT_UNAVAILABLE");
  }
  return authorizeProtectedAction({
    origin: requestHeaders.get("origin"),
    host: requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"),
    authenticate: authenticatePageSession,
    authorization: getAuthorizationService(),
    target: { kind: "ACCOUNT", accountId },
    capability,
  });
}

function route(
  sectionName: z.infer<typeof section>,
  leagueId: string,
  teamId: string | null,
  outcome: "notice" | "error",
  message: string,
) {
  const query = new URLSearchParams({ league: leagueId, [outcome]: message });
  if (teamId) query.set("team", teamId);
  return `/fantasy/${sectionName}?${query.toString()}`;
}

function booleanField(value: FormDataEntryValue | null) {
  return value === "on" || value === "true";
}

function minuteField(value: FormDataEntryValue | null, fallback: number) {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value))
    return fallback;
  const [hours, minutes] = value.split(":").map(Number);
  return hours! * 60 + minutes!;
}

function safeMessage(error: unknown) {
  if (error instanceof AuthorizationError)
    return "That fantasy league action is unavailable.";
  if (error instanceof z.ZodError)
    return "Review the submitted fantasy league values.";
  if (error instanceof Error) {
    const allowed = [
      "Fantasy league is unavailable.",
      "Fantasy roster is unavailable.",
      "Two distinct current roster slots are required.",
      "No future waiver window is available.",
      "Lineup deadline must be in the future.",
    ];
    if (allowed.includes(error.message)) return error.message;
  }
  return "The fantasy league change could not be completed. Reload and try again.";
}

export async function provisionFantasyLeague(
  formData: FormData,
): Promise<never> {
  const accountId = id.parse(formData.get("accountId"));
  try {
    const [manageLeague, activateLeague, manageTeam, manageRoster] =
      await Promise.all([
        authorize(accountId, "fantasy.league.manage"),
        authorize(accountId, "fantasy.league.activate"),
        authorize(accountId, "fantasy.team.manage"),
        authorize(accountId, "fantasy.roster.manage"),
      ]);
    const result = await getFantasyExperienceService().provision(
      {
        accountId,
        seasonId: id.parse(formData.get("seasonId")),
        leagueName: id.parse(formData.get("leagueName")),
        teamName: id.parse(formData.get("teamName")),
        lineupDeadlineAt: new Date(
          `${z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u)
            .parse(formData.get("lineupDeadlineAt"))}:00.000Z`,
        ).toISOString(),
        operationId: randomUUID(),
      },
      {
        manageLeague,
        activateLeague,
        manageTeam,
        manageRoster,
      },
    );
    redirect(
      route(
        "overview",
        result.leagueId,
        result.teamId,
        "notice",
        "League created.",
      ),
    );
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(
      `/fantasy/overview?error=${encodeURIComponent(safeMessage(error))}`,
    );
  }
}

export async function changeFantasyRoster(formData: FormData): Promise<never> {
  const accountId = id.parse(formData.get("accountId"));
  const leagueId = uuid.parse(formData.get("leagueId"));
  const teamId = uuid.parse(formData.get("teamId"));
  const destination = section.parse(formData.get("section"));
  try {
    const commissioner = booleanField(formData.get("commissioner"));
    const actor = await authorize(
      accountId,
      commissioner ? "fantasy.league.manage" : "fantasy.roster.manage",
    );
    const action = z
      .enum(["ADD_PLAYER", "LINEUP_SWAP", "DROP_PLAYER", "WAIVER_CLAIM"])
      .parse(formData.get("action"));
    const common = {
      accountId,
      leagueId,
      fantasyTeamId: teamId,
      operationId: uuid.parse(formData.get("operationId")),
      expectedRevision: z.coerce
        .number()
        .int()
        .nonnegative()
        .parse(formData.get("expectedRevision")),
    };
    const input =
      action === "ADD_PLAYER"
        ? {
            ...common,
            action,
            playerEntryId: id.parse(formData.get("playerEntryId")),
            targetSlotId: id.parse(formData.get("targetSlotId")),
          }
        : action === "LINEUP_SWAP"
          ? {
              ...common,
              action,
              firstSlotId: id.parse(formData.get("firstSlotId")),
              secondSlotId: id.parse(formData.get("secondSlotId")),
            }
          : action === "DROP_PLAYER"
            ? {
                ...common,
                action,
                playerEntryId: id.parse(formData.get("playerEntryId")),
              }
            : {
                ...common,
                action,
                playerEntryId: id.parse(formData.get("playerEntryId")),
                targetSlotId: id.parse(formData.get("targetSlotId")),
                conditionalDropPlayerEntryId:
                  z
                    .string()
                    .parse(formData.get("conditionalDropPlayerEntryId")) ||
                  null,
              };
    const result = await getFantasyExperienceService().transact(
      input,
      actor,
      commissioner,
    );
    const message = result.duplicate
      ? "That request was already safely recorded."
      : result.outcome.record.status === "QUEUED"
        ? "Waiver claim queued."
        : "Roster updated.";
    redirect(route(destination, leagueId, teamId, "notice", message));
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(route(destination, leagueId, teamId, "error", safeMessage(error)));
  }
}

export async function updateFantasyNotifications(
  formData: FormData,
): Promise<never> {
  const accountId = id.parse(formData.get("accountId"));
  const leagueId = uuid.parse(formData.get("leagueId"));
  try {
    const actor = await authorize(accountId, "fantasy.league.view");
    const subscribedEvents = [
      ["transactionUpdates", "FANTASY_TRANSACTION_UPDATED"],
      ["scoringUpdates", "FANTASY_SCORING_UPDATED"],
      ["matchupResults", "FANTASY_MATCHUP_FINAL"],
    ]
      .filter(([field]) => booleanField(formData.get(field!)))
      .map(([, event]) => event);
    await getFantasyExperienceService().updateNotifications(
      {
        accountId,
        leagueId,
        preferenceId: uuid.parse(formData.get("preferenceId")),
        operationId: randomUUID(),
        recipientEnabled: booleanField(formData.get("recipientEnabled")),
        subscribedEvents,
        digestMode: z
          .enum(["IMMEDIATE", "DAILY_DIGEST"])
          .parse(formData.get("digestMode")),
        digestMinute: minuteField(formData.get("digestTime"), 480),
        timeZone: id.parse(formData.get("timeZone")),
        quietHoursEnabled: booleanField(formData.get("quietHoursEnabled")),
        quietStartMinute: minuteField(formData.get("quietStart"), 1_320),
        quietEndMinute: minuteField(formData.get("quietEnd"), 420),
      },
      actor,
    );
    redirect(
      route(
        "notifications",
        leagueId,
        null,
        "notice",
        "Notification settings updated.",
      ),
    );
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(
      route("notifications", leagueId, null, "error", safeMessage(error)),
    );
  }
}

export async function controlFantasyLeague(formData: FormData): Promise<never> {
  const accountId = id.parse(formData.get("accountId"));
  const leagueId = uuid.parse(formData.get("leagueId"));
  try {
    const actor = await authorize(accountId, "fantasy.league.manage");
    await getFantasyExperienceService().control(
      {
        accountId,
        leagueId,
        operationId: randomUUID(),
        action: z
          .enum([
            "PAUSE",
            "RESUME",
            "ARCHIVE",
            "REQUEST_DELETION",
            "RESET_WEEK",
            "OPEN_APPROVAL",
            "OPEN_DISPUTE",
            "RESOLVE_CASE",
          ])
          .parse(formData.get("action")),
        reason: z.string().trim().min(3).max(240).parse(formData.get("reason")),
        caseId: z.string().trim().parse(formData.get("caseId")) || null,
        resolution: z
          .enum(["APPROVED", "REJECTED", "RESOLVED"])
          .nullable()
          .parse(formData.get("resolution") || null),
      },
      actor,
    );
    redirect(
      route(
        "commissioner",
        leagueId,
        null,
        "notice",
        "Commissioner action recorded.",
      ),
    );
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(
      route("commissioner", leagueId, null, "error", safeMessage(error)),
    );
  }
}
