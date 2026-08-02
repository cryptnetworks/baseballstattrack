# M5 Discord control-plane reconciliation

Epic [#108](https://github.com/cryptnetworks/baseballstattrack/issues/108)
is complete. This reconciliation was performed from clean `main` at
`505349627c4647072cbcb9540330c8fe3d8c72ae`, where the exact-head CI and
CodeQL runs were successful and all thirteen child delivery issues were closed
as completed.

## Completed delivery

| Child | Implementation and evidence                                                                                                                                                  | PR                                                                  | Merge SHA                                  |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------ |
| #109  | Versioned settings contract and Account-scoped API; defaults, validation, optimistic concurrency, reset, secret separation, audit, persistence, and boundary tests           | [#176](https://github.com/cryptnetworks/baseballstattrack/pull/176) | `79bc276fcc8de55ec2230d52123b4668fa6b480e` |
| #110  | Least-privilege Discord OAuth installation, callback verification, lifecycle handling, audit, onboarding UI, and provider/service/persistence tests                          | [#180](https://github.com/cryptnetworks/baseballstattrack/pull/180) | `899e601a5e6c0fc5cd1ee6fae3a0a7d745f3d7ca` |
| #111  | Authorized Account/server settings shell, complete workspace navigation, explicit states, responsive layout, and semantic accessibility coverage                             | [#181](https://github.com/cryptnetworks/baseballstattrack/pull/181) | `5070e452b2480e9a7e6543cc48d576fe87186b25` |
| #112  | Permission-filtered channel discovery, purpose routing, safe disablement, live permission revalidation, test delivery, and routing integration tests                         | [#183](https://github.com/cryptnetworks/baseballstattrack/pull/183) | `852e94ed51d78ee99aac230976c229f5ac805d05` |
| #120  | Account-authorized team-season selection, lifecycle display policy, pause behavior, stale/empty states, and cross-Account persistence tests                                  | [#184](https://github.com/cryptnetworks/baseballstattrack/pull/184) | `5b3ccd838c3b7e5fa3e4ce294d2ba83cfd8e9a29` |
| #118  | Event, interval, manual, digest, time-zone, game-window, quiet-hour, pause/resume, catch-up, and durable schedule behavior with bounded cadence tests                        | [#185](https://github.com/cryptnetworks/baseballstattrack/pull/185) | `e0facd9535b0357b521897eec82d8b3141f309cf` |
| #115  | Complete update-trigger vocabulary, four message strategies, three bounded formats, synthetic previews, and correction-safe planning tests                                   | [#186](https://github.com/cryptnetworks/baseballstattrack/pull/186) | `bc45f0a308dcc88377e0d731006cd50f0d067d6b` |
| #119  | Version-pinned evaluation, API-only statistics reads, deterministic/idempotent delivery, leases, ordered retries, dead letters, recovery, and concurrency tests              | [#187](https://github.com/cryptnetworks/baseballstattrack/pull/187) | `5175ece025b489d5dbbd9d98e72adb1a111a0a30` |
| #117  | Account and Discord-role capabilities, stale-membership fail-closed behavior, secret-free audit history, revocation, and authorization tests                                 | [#177](https://github.com/cryptnetworks/baseballstattrack/pull/177) | `b883ec94ca386855c1cd0bd010e7b3bd0f04520f` |
| #113  | Whole-configuration validation, representative previews, unmistakable synthetic test delivery, permission findings, audit, and rate-limit tests                              | [#188](https://github.com/cryptnetworks/baseballstattrack/pull/188) | `16da20bd63b5a44b6bd42481ce35f6d4297b7905` |
| #114  | Operator activity and health workspace, classified failures, bounded correlated history, redaction, and M4 operational-event integration                                     | [#194](https://github.com/cryptnetworks/baseballstattrack/pull/194) | `6510819454fc8e2b57ff74c8f404219c743a9b55` |
| #116  | Synthetic representative server and game fixture proving start, score, correction, and final delivery plus isolation, deduplication, retry, stale-data, and failure behavior | [#195](https://github.com/cryptnetworks/baseballstattrack/pull/195) | `e5729070605959719f9ffeb53db838eb05153c4b` |
| #121  | Operable web, gateway, scheduler, worker, API, and database topology; secret ownership, health, shutdown, migrations, provider-stub CI, and container smoke verification     | [#196](https://github.com/cryptnetworks/baseballstattrack/pull/196) | `cfafafa88d2fbecab2e579794368f8ee7f333b1b` |

Dependencies #73, #91, and #97 are also closed as completed. Together they
provide the read-only Python consumer, versioned statistics API, and M5
integration trust and support program required by #108.

## Epic acceptance reconciliation

| #108 acceptance criterion                                                                                       | Evidence                                                                                                                                                                                                                           | Result   |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| An administrator can install or connect a Discord server to an authorized Account.                              | #110 implements the OAuth and lifecycle flow; #117 enforces Account and guild authorization.                                                                                                                                       | Complete |
| The web UI configures channels, tracked teams/seasons, cadence, triggers, format, quiet hours, and permissions. | #111, #112, #120, #118, #115, and #117 implement and test every named workspace.                                                                                                                                                   | Complete |
| Changes are validated, versioned, auditable, and applied without bot restart.                                   | #109 owns revisioned persistence; #113 validates; #117 audits; #112, #118, #119, and the #116 fixture prove runtime consumption of saved revisions.                                                                                | Complete |
| The bot does not read production tables and obtains statistics through the authorized API.                      | #73 and #91 establish the consumer/API boundary; #119 consumes current statistics through that API; #121 gives the Python gateway no database network or credential.                                                               | Complete |
| A representative server configures and observes a live-game flow end to end.                                    | #116 uses the production repositories, publication service, PostgreSQL claim/retry path, planner, and worker to prove start, score, correction, and final updates without duplicates; #121 proves the deployable process topology. | Complete |

## Missing

No epic acceptance criterion or child implementation is missing. There is no
unassigned M5 implementation gap.

## Explicit deferrals

- Real Discord credentials, provider connectivity, and an external sandbox
  smoke are production deployment evidence. The Platform and Discord
  integration maintainers own that release-time operation; it is not assigned
  to a later feature milestone and does not replace the mandatory synthetic CI
  suite.
- Vendor-specific hosting or Kubernetes topology remains a future Platform
  deployment decision with no roadmap milestone assigned. The accepted
  provider-neutral topology is complete.
- Discord score editing, arbitrary third-party writes, and AI-generated game
  commentary remain explicitly outside #108. Product maintainers own any
  future proposal; this reconciliation does not assign them to M8.

## Decision

**Close.** The epic acceptance criteria are satisfied by merged, tested child
deliveries. The remaining items are operational activation or expressly
out-of-scope future proposals, not incomplete control-plane implementation.
