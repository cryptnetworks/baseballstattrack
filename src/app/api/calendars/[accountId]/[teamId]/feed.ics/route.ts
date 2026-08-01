import { z } from "zod";

import {
  CalendarFeedError,
  getCalendarFeedService,
} from "@/server/app/calendar-feed-service";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ accountId: string; teamId: string }> },
) {
  try {
    const params = await context.params;
    const token = z
      .string()
      .min(32)
      .max(256)
      .parse(new URL(request.url).searchParams.get("token"));
    const calendar = await getCalendarFeedService().render({
      ...params,
      token,
    });
    return new Response(calendar, {
      headers: {
        "Cache-Control": "private, max-age=300",
        "Content-Disposition": 'inline; filename="baseball-games.ics"',
        "Content-Type": "text/calendar; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const status = error instanceof CalendarFeedError ? error.status : 404;
    return Response.json(
      { error: "The calendar feed is unavailable." },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
