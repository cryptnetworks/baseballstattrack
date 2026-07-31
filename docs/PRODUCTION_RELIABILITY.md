# Production reliability, SLOs, and incident response

This vendor-neutral contract makes service reliability measurable and defines
when delivery yields to recovery. It does not claim production measurements or
select a monitoring provider. Accepted scoring events, corrected replay,
Account authorization, privacy, security audit, backup, and migration contracts
remain authoritative.

## Service-level indicators and objectives

Evaluate each objective over a rolling 30-day window, segmented by production
environment and service version. Account identifiers may be used only in
restricted incident diagnosis; dashboards and SLO counters are aggregate and
must not contain player data, raw event payloads, secrets, or arbitrary errors.
No traffic is `no_data`, not 100% reliability.

| SLO                        | Eligible events                                                                                                                                                    | Good event                                                                                                                                                                     | Target |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| Availability               | Production HTTP requests to user routes and APIs, excluding health probes, bots, explicit client cancellation, and planned maintenance announced before the window | A response is completed without an internal/server/dependency failure. Typed validation, authorization, revision, and baseball-domain rejections count as available responses. | 99.9%  |
| Scoring acceptance latency | Authorized scoring submissions that the domain accepts; measure at the server boundary from receipt through durable transaction response                           | Accepted in at most 1,000 ms                                                                                                                                                   | 99%    |
| Report freshness           | Observations of a game/season report after its authoritative source or privacy revision changes                                                                    | A matching current projection checkpoint is available within 5 minutes                                                                                                         | 99%    |
| Recovery                   | SEV-0/SEV-1 application, scoring, authorization, or derived-data incidents with an agreed recovery start and verified end                                          | Safe service is restored within 60 minutes without changing accepted history or crossing Account boundaries                                                                    | 99%    |

`src/server/observability/reliability-slos.ts` is the executable target and
budget definition. Availability and latency are not correctness SLOs: a fast
wrong score, unauthorized response, or corrupted history is a defect/incident
even if the request metric is green. Disaster recovery retains the separate
backup objectives: logical-backup RPO 24 hours, PITR target RPO 15 minutes, and
restore-verification RTO four hours.

The synthetic database profiles and release regression thresholds for scoring,
box-score generation, and season-dashboard queries are defined in
`PERFORMANCE_AND_LOAD_BUDGETS.md`. They provide controlled evidence for this
SLO; hosted telemetry remains the production authority.

Instrument counters for eligible/good/bad events, latency histograms,
source-to-checkpoint age, incident recovery duration, readiness, version, and
environment. Expected domain/authorization rejections have their own safe
typed-code rate so a behavior shift can be investigated, but they do not enter
the application-error numerator or page as failures. Missing telemetry,
unknown outcomes, and abandoned work are never silently classified as good.

## Error budgets and release policy

For target `T` and `N` eligible events, the budget is `N × (1 − T)` bad events.
Budget consumption is observed bad events divided by that allowance; burn rate
is the observed bad-event rate divided by the allowed rate. Availability at
99.9% permits 43 minutes 12 seconds of bad time in a 30-day continuous
window, but request-based evaluation uses event counts rather than translating
every failure to downtime.

- Below 50% consumed: normal delivery with ordinary reliability review.
- At least 50% consumed: `at_risk`; the service owner reviews causes and burn
  trend before the next release and schedules bounded reliability work.
- 25% consumed within 24 hours, burn rate at least 14.4 over one hour, or burn
  rate at least 6 over six hours: page the owning on-call and freeze rollout of
  the affected service while the signal is investigated.
- Budget exhausted: pause feature releases and feature work that can affect the
  failed SLO. Only containment, recovery, security/privacy obligations,
  reliability repairs, and independently safe work may proceed.
- Resume after the rolling budget is below exhaustion, the incident cause is
  contained, regression evidence and exact-main/deployment checks are green,
  and the accountable owner records the decision. Lowering the target or
  excluding valid bad events to resume work is prohibited.

A single data-integrity, cross-Account, authorization-bypass, accepted-event
loss, or security-audit failure can require an incident and feature pause even
with budget remaining. Error budgets govern release risk; they are not an
allowance to lose authoritative data.

## Alerts and rejection handling

| Condition                                                                                                                                                                      | Route                                                   | Required first action                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Required audit write failure, readiness failure for 2 minutes, unexpected scoring failures above 1% for 5 minutes, fast SLO burn, accepted-event loss, or authorization bypass | Critical page / incident                                | Stop rollout or traffic as appropriate, preserve safe correlation/release evidence, and verify authoritative history and Account boundaries |
| Projection/report age over 5 minutes, exhausted background retries, at-risk budget, or six-hour slow burn                                                                      | Warning ticket; page if scoring recovery is blocked     | Inspect source/privacy revision, checkpoint, retry state, and last known-good artifact                                                      |
| Threefold change in authorization rejection baseline for 10 minutes                                                                                                            | Security review; page when bypass/exposure is plausible | Separate expired membership and expected denial from attack or regression without logging target data                                       |
| Typed validation, baseball-domain rejection, revision conflict, or idempotent retry at ordinary rates                                                                          | User-actionable response and aggregate metric; no page  | Return the safe typed instruction and monitor rate/trend                                                                                    |

`classifyOperationalAlert` provides deterministic event-level classification.
Time windows, ratios, deduplication, silence detection, and routing live in the
deployment adapter and must preserve these meanings. Never page on message text
or treat log silence as recovery.

## Incident severity and roles

| Severity       | Examples                                                                                                                                                         | Initial response and communication                                                |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| SEV-0 critical | Active cross-Account exposure, auth bypass, destructive accepted-history corruption, widespread scoring loss, exposed production secret, unrecoverable data loss | Immediate incident; containment first; operator update at least every 15 minutes  |
| SEV-1 high     | Bounded data-integrity failure, common scoring blocked, repeated duplicate acceptance, serious private-data exposure, migration failure with material impact     | Engage within 15 minutes; update at least every 30 minutes                        |
| SEV-2 moderate | Degraded report freshness, meaningful incorrect behavior with mitigation, partial availability or accessibility block                                            | Owner within one business hour; update at material changes or hourly while active |
| SEV-3 low      | Minor operational/documentation defect without material workflow or data risk                                                                                    | Routine issue and normal release process                                          |

The incident commander owns severity, decisions, delegation, and recovery
declaration. The operations lead owns containment and rollback/roll-forward.
The domain/security/privacy lead verifies accepted history, Account scope, and
specialist obligations. The scribe keeps the timestamped decision/evidence log.
The communications owner produces safe operator/user updates. One person may
hold several roles only when staffing requires it; name the roles explicitly.

Updates state what is affected, user-visible impact, safe workaround, current
containment, next update time, and whether data/security scope is known. Do not
include Account ids, player information, credentials, private payloads, or
unverified root cause. Security/privacy incidents use the private route in
`SECURITY.md`; notification decisions are made by accountable operators and
appropriate advisers, not by this document.

## Response and recovery checklist

1. Declare incident id, severity, commander, roles, environment, start time,
   release/image/migration, safe symptoms, and next communication time.
2. Freeze affected deploys. Preserve logs, audit records, correlation ids,
   metrics, database state, failed artifacts, and operator decisions without
   copying sensitive data into issues or CI.
3. Contain by revoking credentials, stopping traffic/rollout, disabling the
   narrow boundary, or deploying a schema-compatible known-good digest. Never
   edit accepted events, applied migrations, audit history, or a damaged
   database to hide evidence.
4. For scoring/report incidents compare game revision, ordered source-event
   signature, correction graph, effective replay, privacy revision, projection
   checkpoint, and client recovery state. For authorization, exercise denied
   paths and cross-Account non-enumeration.
5. Recover through a deterministic replay/rebuild or roll-forward repair.
   Restore is a disaster action governed by `docs/BACKUP_AND_RESTORE.md`, not a
   routine projection or schema rollback.
6. Verify liveness, readiness, exact migration state, authorized synthetic
   scoring, correction/replay, current reports, audit persistence, Account
   isolation, and alert clearing. Record end time and measured recovery.
7. Within five business days for SEV-0/SEV-1, publish a safely redacted review:
   impact/timeline, detection, root and contributing causes, what worked/failed,
   budget impact, regression proof, and prioritized actions with owners/dates.
   The review is blameless but decisions and ownership remain explicit.

Follow-up defects remain open through merged-commit verification under
`docs/DEFECT_TRIAGE_AND_REGRESSION_POLICY.md`. Review thresholds after every
incident and at least quarterly.

## Representative stale-projection drill

Run locally or in CI with Docker, Node 24+, npm 11+, and exact dependencies:

```sh
npm run reliability:drill
```

The drill creates isolated PostgreSQL, applies the full migration chain, and
loads the same synthetic two-Account fixture used by restore verification: one
corrected game, four immutable source events, a correction edge, security audit
evidence, and a current projection. It deliberately marks only the derived
checkpoint stale, proves freshness detection, republishes the same current
identity, and proves source-event signature/count, correction, game revision,
audit record, and tenant fixture remain unchanged. Output records detection and
recovery seconds and representative counts.

The drill must fail closed on missing detection, failed recovery, history
change, or invariant loss. It uses no production data or credentials, makes no
claim about provider-scale RTO, and does not test backup disaster recovery;
that independent proof remains `npm run db:restore:verify`.
