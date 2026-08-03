# Pull-only ICS calendar feeds

Baseball Stat Track publishes game schedules as read-only RFC 5545 (`.ics`)
feeds. Calendar clients pull the feed on their own schedule; the application no
longer connects to Google Calendar, stores provider credential references, runs
a calendar worker, or writes events into a third-party calendar.

The checked-in `20260731213000_calendar_sync` migration is retained as immutable
history. Its tables are not used by the ICS runtime and must not be removed by
editing or reversing an applied migration.

## Enable and obtain a feed

Keep the signing secret external:

```dotenv
ICS_FEED_SIGNING_KEY=replace-with-at-least-32-random-characters
```

Then enable calendar feeds and choose the detail level in **Settings →
Application configuration**. Legacy `FEATURE_ICS_CALENDAR_ENABLED` and
`ICS_FEED_DETAIL_LEVEL` values are read only by the reviewed initial seed.

An Account administrator requests a team's subscription URL with:

```text
GET /api/admin/calendars?accountId=<internal-account-id>&teamId=<team-external-uuid>
```

The authenticated response contains a stable HTTPS URL ending in `feed.ics`.
Paste that URL into Apple Calendar, Google Calendar, Outlook, or any calendar
client that supports subscribing by URL. The public feed route requires the
signed token embedded in the URL and returns `text/calendar`; it never accepts
calendar writes or changes baseball data.

## Privacy and rotation

The database-owned detail level supports:

- `private` — time and a generic “Baseball game” title;
- `opponent` — also names the opponent when setup data is available;
- `full` — also includes the game location.

Use `private` for youth schedules unless the Account owner has approved wider
disclosure. Treat a subscription URL like a password: anyone holding it can
read the feed without signing in. Rotate `ICS_FEED_SIGNING_KEY` to revoke every
issued URL, then request replacement URLs. Disable the feed immediately in the
application configuration portal.

Cancelled, abandoned, archived, and unscheduled games are omitted. Each event
has a stable UID derived from the game's public UUID, so reschedules update the
subscriber's existing event instead of creating another one. The feed includes
no players, lineups, scores, contacts, analytics, or scoring-event history.
