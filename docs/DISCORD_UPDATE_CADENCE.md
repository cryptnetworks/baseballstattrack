# Discord update cadence and scheduling

Issue #118 defines the Account-scoped control plane for deciding when a
Discord installation may evaluate game updates. It does not send Discord
messages. The delivery worker, retry ledger, dead-letter handling, and
edit-versus-append behavior remain owned by #119.

## Versioned policy

One `DiscordIntegrationSettings` revision contains all scheduling policy:

- `EVENT_DRIVEN` evaluates matching accepted game events without polling;
- `FIXED_INTERVAL` permits only 60–3,600 second intervals, with administrator
  choices of 1, 5, 15, 30, or 60 minutes in the web UI;
- `MANUAL_ONLY` has no recurring evaluation;
- a daily digest time may accompany any cadence mode;
- one IANA time zone controls digest time, the optional daily game window, and
  quiet hours;
- catch-up is either `SKIP` or `LATEST_ONLY`. There is no replay-all option.

The additive fields retain the version-1 administration API contract. An older
complete-replacement client that omits them receives the documented fixed
five-minute cadence, disabled game window and digest, and `LATEST_ONLY`
catch-up defaults; existing cadence seconds are still honored.

Daily windows support both ordinary and overnight ranges. Start and end must
differ. Quiet hours always defer a timed or manual evaluation. If the game
window and quiet hours leave no eligible minute, calculation fails closed with
no scheduled evaluation rather than bypassing either boundary.

The persisted `nextScheduledEvaluationAt` is an indexed UTC instant. Event
driven settings correctly show “waiting for a matching game event” instead of
inventing a time. `lastSuccessfulUpdateAt` is worker-owned operational state;
the UI explicitly shows when no successful update has occurred.

## Pause, resume, and catch-up

Pause disables delivery, records `pausedAt`, clears pending manual work, and
sets the next scheduled evaluation to null. It preserves the installation,
credential reference, routes, team-season scopes, policy, settings history, and
delivery history. Clearing every route or tracked scope also disables delivery
through the existing settings invariant.

Resume requires an active installation, at least one exact-Account tracked
team-season, and at least one routable destination. `LATEST_ONLY` schedules one
eligible evaluation of current state; `SKIP` waits for the next event, interval,
or digest. Neither option replays every missed event.

Configuration writes use the existing optimistic settings revision. A worker
must load and pin that revision when claiming evaluation work. If settings
change during an in-progress game, the next evaluation uses the new revision;
delivery identity and deduplication remain #119 responsibilities. Configuration
changes never manufacture Discord message identities.

## Manual evaluation

Manual evaluation is an operational action requiring exact-Account
`discord.settings.operate`. It is same-origin protected and administration-rate
limited. Only one `manualRefreshRequestedAt` slot may be pending. Repeated
requests coalesce into that slot, are audited as coalesced, and cannot create a
request storm. The pending evaluation still respects the game window and quiet
hours.

The future worker clears the slot only after atomically claiming it. Until #119
is implemented, the control plane honestly displays a pending request; it does
not claim that a Discord update was sent.

## Security, privacy, and operations

Reads require exact-Account `discord.settings.view`; schedule changes and
pause/resume require `discord.settings.configure`; manual evaluation requires
`discord.settings.operate`. Authority is resolved from the authenticated
session and active membership. Browser Account IDs are routing input, never
authority.

Repository lookups use the compound Account/install identity. The browser sees
only public installation identity and scheduling state—never guild IDs, channel
IDs, credential references, bot tokens, worker credentials, or internal
team-season keys. Audits record revision, policy categories, bounded cadence,
and counts, not Discord or baseball identifiers.

The migration adds constrained columns to the existing service-only RLS table
and a partial due-work index. No public policy is added. Stop the future worker
to contain a scheduling incident; administrators can also pause one
installation without deleting evidence. Rollback requires application rollback
before reversing the additive migration because older binaries do not know the
new schedule fields.
