# Discord end-to-end fixtures

Issue #116 adds a reusable synthetic control-plane fixture and a PostgreSQL
integration suite that proves web-managed Discord settings drive the durable
update worker. The suite never calls Discord, reads production data, or loads a
Discord token.

## Boundary under test

The fixture creates synthetic Accounts, team-seasons, games, installations,
and verified channels. It uses the same installation, channel-routing, and
settings repositories and the same validated `DiscordSettingsService` used by
the administration UI. Signals then pass through
`DiscordUpdatePublicationService`, PostgreSQL claim/retry state, content
planning, and `DiscordUpdateWorkerService` into an in-memory Discord transport.

The configured policy is event-driven, selects an exact Account team-season,
routes live, final, and correction purposes, selects start/score/correction/
final triggers, and uses the edit-live-message strategy with standard content.
Sibling servers and a second Account receive distinct scopes, destinations,
and provider identities.

## Scenario matrix

| Scenario            | Evidence                                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------------------------- |
| Representative game | start creates once; score, correction, and final edit the pinned message                                 |
| Duplicate signal    | the durable evaluation unique key returns `created: 0`                                                   |
| Rate limit          | the same delivery UUID retries only after the bounded `Retry-After` schedule                             |
| Stale statistics    | an older API revision waits, then evaluates when current data arrives                                    |
| Stale settings      | a revision-pinned evaluation cancels after configuration changes                                         |
| Permission change   | a queued delivery cancels before transport after Send permission is lost                                 |
| Discord API failure | a terminal missing-destination response dead-letters once without retry                                  |
| Disablement         | a paused configuration does not enqueue a new signal                                                     |
| Account isolation   | a game UUID cannot be resolved through another Account                                                   |
| Server isolation    | one server cannot select another server's destination, and only the matching tracked scope receives work |

Content assertions verify the accepted start, score, correction marker, and
final state. Delivery assertions verify four durable delivery identities; the
rate-limited attempt reuses its UUID and cannot create a duplicate message.

## CI and local execution

The canonical application CI job provides PostgreSQL 17, deploys the complete
migration chain, and runs every `tests/persistence/*.integration.test.ts`
through `npm run verify`. The new suite is therefore mandatory whenever the CI
planner selects the application gate.

To run it locally against a disposable database:

```text
DATABASE_URL=postgresql://... npm run db:migrate:deploy
DATABASE_URL=postgresql://... npm run test -- --run tests/persistence/discord-control-plane.e2e.integration.test.ts
```

All fixture names and message facts are explicitly synthetic. The transport
is in-memory, credentials are opaque test references, and no environment token
is read. Failure responses are typed synthetic exceptions rather than copied
provider bodies.
