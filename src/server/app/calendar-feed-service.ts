import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import {
  renderCalendarFeed,
  type CalendarFeedDetailLevel,
} from "@/domain/calendar-feed";
import { AuthorizationError } from "@/server/auth/errors";
import {
  requireTrustedActor,
  type TrustedActorContext,
} from "@/server/auth/types";
import { featureEnabled } from "@/server/config/feature-flags";
import { getPrismaClient } from "@/server/data/prisma";

const externalId = z.uuid();
const detailLevelSchema = z
  .enum(["private", "opponent", "full"])
  .default("private");

export class CalendarFeedError extends Error {
  constructor(
    readonly code: "DISABLED" | "CONFIGURATION_ERROR" | "NOT_FOUND",
    readonly status: 404 | 500,
  ) {
    super(code);
    this.name = "CalendarFeedError";
  }
}

function signingKey(): string {
  const key = process.env.ICS_FEED_SIGNING_KEY;
  if (!key || key.length < 32) {
    throw new CalendarFeedError("CONFIGURATION_ERROR", 500);
  }
  return key;
}

function configuredDetailLevel(): CalendarFeedDetailLevel {
  return detailLevelSchema.parse(
    process.env.ICS_FEED_DETAIL_LEVEL?.trim().toLowerCase(),
  );
}

function signature(accountId: string, teamId: string): string {
  return createHmac("sha256", signingKey())
    .update(`v1\n${accountId}\n${teamId}`)
    .digest("base64url");
}

function requireEnabled(): void {
  if (!featureEnabled("FEATURE_ICS_CALENDAR_ENABLED")) {
    throw new CalendarFeedError("DISABLED", 404);
  }
}

export function calendarFeedToken(accountId: string, teamId: string): string {
  requireEnabled();
  return signature(externalId.parse(accountId), externalId.parse(teamId));
}

export function calendarFeedTokenIsValid(
  accountId: string,
  teamId: string,
  token: string,
): boolean {
  try {
    requireEnabled();
    const expected = Buffer.from(
      signature(externalId.parse(accountId), externalId.parse(teamId)),
    );
    const actual = Buffer.from(token);
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  } catch {
    return false;
  }
}

export class CalendarFeedService {
  constructor(private readonly prisma = getPrismaClient()) {}

  async subscription(
    input: { accountId: string; teamId: string },
    actorInput: TrustedActorContext,
  ) {
    requireEnabled();
    const actor = requireTrustedActor(
      actorInput,
      input.accountId,
      "account.manage",
    );
    if (actor.target.kind !== "ACCOUNT") {
      throw new AuthorizationError("AUTHORIZATION_REQUIRED");
    }
    const team = await this.prisma.team.findFirst({
      where: {
        accountId: input.accountId,
        externalId: externalId.parse(input.teamId),
        archivedAt: null,
      },
      select: {
        externalId: true,
        account: { select: { externalId: true } },
      },
    });
    if (!team) throw new CalendarFeedError("NOT_FOUND", 404);
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
    if (!siteUrl) throw new CalendarFeedError("CONFIGURATION_ERROR", 500);
    const url = new URL(
      `/api/calendars/${team.account.externalId}/${team.externalId}/feed.ics`,
      siteUrl,
    );
    url.searchParams.set(
      "token",
      calendarFeedToken(team.account.externalId, team.externalId),
    );
    return { url: url.toString() };
  }

  async render(input: { accountId: string; teamId: string; token: string }) {
    const accountId = externalId.parse(input.accountId);
    const teamId = externalId.parse(input.teamId);
    if (!calendarFeedTokenIsValid(accountId, teamId, input.token)) {
      throw new CalendarFeedError("NOT_FOUND", 404);
    }
    const team = await this.prisma.team.findFirst({
      where: {
        externalId: teamId,
        archivedAt: null,
        account: { externalId: accountId, archivedAt: null },
      },
      select: {
        id: true,
        displayName: true,
        accountId: true,
      },
    });
    if (!team) throw new CalendarFeedError("NOT_FOUND", 404);

    const games = await this.prisma.game.findMany({
      where: {
        accountId: team.accountId,
        teamSeason: { teamId: team.id },
        scheduledAt: { not: null },
        archivedAt: null,
        status: { notIn: ["CANCELLED", "ABANDONED"] },
      },
      orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
      take: 1_000,
      select: {
        externalId: true,
        scheduledAt: true,
        updatedAt: true,
        location: true,
        teamSeasonId: true,
        readySetupSnapshot: {
          select: {
            teamSnapshots: {
              select: { teamSeasonId: true, displayName: true },
            },
          },
        },
      },
    });

    return renderCalendarFeed({
      name: `${team.displayName} games`,
      detailLevel: configuredDetailLevel(),
      games: games.flatMap((game) =>
        game.scheduledAt
          ? [
              {
                id: game.externalId,
                scheduledAt: game.scheduledAt,
                updatedAt: game.updatedAt,
                location: game.location,
                opponent:
                  game.readySetupSnapshot?.teamSnapshots.find(
                    (snapshot) =>
                      snapshot.teamSeasonId === null ||
                      snapshot.teamSeasonId !== game.teamSeasonId,
                  )?.displayName ?? null,
              },
            ]
          : [],
      ),
    });
  }
}

export function getCalendarFeedService() {
  return new CalendarFeedService();
}
