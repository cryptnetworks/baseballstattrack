# Discord settings web UI

Issue #111 establishes the authorized administration shell for the M5 Discord
control plane. It does not implement channel discovery, team-scope writes,
update policy, message rendering, or activity queries; those capabilities plug
into the stable workspaces defined here.

## Route and authorization

`/discord` and `/discord/overview` open the default workspace. Channels, Teams,
Updates, Permissions, Preview, and Activity have stable sibling paths. The
selected installation is an Account-scoped external UUID in the `server` query
parameter. Unknown paths return the application not-found state. A missing or
cross-Account installation is never enumerated; the page selects an available
server and shows a focus-managed validation summary.

Every request authenticates the current Supabase session, lists only active
Account memberships, and independently checks Account-level
`discord.settings.view` authority. Accounts without that capability are not
offered in the selector. Account switching is a same-origin server action,
rechecks the same capability, applies the Account-selection rate limit, and
stores only the existing selected-Account navigation cookie. Direct requests
cannot bypass these checks.

The shell consumes the secret-free installation view from #110. It never reads
or renders a raw guild ID, bot token, OAuth value, or credential reference.

## Interaction and state contract

Account and server selection use labelled native selects and submit buttons, so
they work with keyboards and without client JavaScript. The section navigation
uses links with `aria-current="page"`; it scrolls horizontally below the desktop
breakpoint and becomes a sidebar when space allows. Controls retain the global
44-pixel minimum target and focus-visible treatment.

The route provides explicit authorized loading, no-Account, no-installation,
invalid-selection, disconnected/revoked/incomplete, not-found, and runtime
failure states. Stale installations remain inspectable but are labelled
read-only. Runtime retries use the Next.js error-boundary reset without
displaying an error digest.

`DiscordSettingsFeedback` is the child-workspace contract for idle, saving,
saved, validation-error, and failure feedback. Validation errors link to native
field IDs. Validation and failure summaries are programmatically focused after
state changes, use an alert role, and explain that prior saved configuration is
unchanged. Saving and success use polite status announcements. Later settings
forms must reuse this contract rather than introducing silent or optimistic
success states.
