# Consent-aware product analytics and privacy review

Issue #94 measures live-scoring friction and reliability without building a
player, game, Account, or private-user behavior profile. Product analytics is a
separate best-effort stream from operational telemetry, security audit, source
events, and webhook delivery. It can never authorize work or become baseball
history.

## Privacy review decision

The initial schema version 1 catalog below is **approved for implementation**
against the issue #8 privacy and threat-model baseline. The approval is limited
to the exact runtime allowlist, explicit consent controls, and retention rules
in this document. It is not legal advice or approval for advertising, session
replay, third-party enrichment, cross-site tracking, or provider settings that
have not been verified before release.

Any new event, field, identifier, policy version, analytics provider, or longer
retention period requires a new privacy/security diff review before collection.
Fail the release gate if provider configuration cannot enforce this contract.

## Consent and control

- Default is `NOT_SET`, which collects nothing.
- A current authenticated user may opt in or out through
  `PUT /api/analytics/consent` after exact Account membership authorization.
  The preference is user-level even when the authorization originated from one
  Account; changing Accounts cannot bypass it.
- Opt-in names the current policy version and expires after 365 days. A changed
  policy or expired preference fails closed until renewed.
- Opt-out takes effect before the next observation and has no expiry. Deleting
  the preference through `DELETE /api/analytics/consent` also disables
  collection because absence is not consent.
- A user privacy-lifecycle execution deletes the preference transactionally.
  Account or player privacy actions do not rewrite the anonymous aggregate
  stream or authoritative baseball history.
- Consent lookup, parsing, or sink failure drops the analytics observation and
  never blocks or changes scoring acceptance.

The endpoint returns `Cache-Control: no-store`, requires same-origin protection
for mutations, and never returns or accepts an analytics identifier.

## Version 1 event catalog

All events have `schemaVersion: 1`, `workflow: LIVE_SCORING`, one coarse event
family, one coarse duration bucket, and one result. They contain no arbitrary
metadata.

| Event                            | Purpose                                  | Result                   | Failure category                     |
| -------------------------------- | ---------------------------------------- | ------------------------ | ------------------------------------ |
| `scoring.submission_succeeded`   | completed authorized scoring submissions | `SUCCEEDED`              | `null`                               |
| `scoring.baseball_rule_rejected` | expected baseball or lifecycle refusal   | `BASEBALL_RULE_REJECTED` | `BASEBALL_RULES`                     |
| `scoring.workflow_failed`        | product/reliability workflow failure     | `WORKFLOW_FAILED`        | `INPUT`, `CONCURRENCY`, or `SERVICE` |

Allowed event families are `PLATE_APPEARANCE`, `RUNNER_MOVEMENT`,
`LINEUP_OR_PITCHING`, and `GAME_LIFECYCLE`. Allowed duration buckets are
`UNDER_250_MS`, `UNDER_1_S`, `UNDER_5_S`, and `SLOW`. Exact durations and raw
error codes are intentionally omitted.

This distinction keeps expected baseball-rule refusals out of the scorer
workflow-failure numerator. Authorization failures are operational security
signals and are not product analytics observations.

## Data-minimization review

The strict runtime schema contains no Account, user, membership, team, season,
game, player, lineup, event, request, correlation, device, IP, URL, or provider
identifier. It also excludes:

- player/team names, jersey numbers, lineups, scores, dates, locations, and
  report/statistic content;
- source-event bodies, correction bodies, setup snapshots, form values, notes,
  and error messages;
- email/contact/age/identity-provider claims;
- cookies, tokens, secrets, authorization headers, database URLs, and query
  strings; and
- free text, arbitrary objects, and vendor-generated user/session fingerprints.

The server checks consent by internal user ID, but that ID is never copied into
the observation. A sink receives only the validated catalog fields plus the
collection timestamp. Client-side session replay, DOM capture, keystroke
capture, fingerprinting, and automatic page/view SDK collection are prohibited.

## Retention, deletion, and access

- Current consent preference: kept only while the application user is active;
  hard-deleted by preference deletion or user privacy execution.
- Raw allowed observations: maximum 30 days, access restricted to the product
  reliability and privacy/security operators, then hard-deleted.
- Aggregate counts/rates: maximum 13 months only when the provider has removed
  raw timestamps and cannot expose or reconstruct a user, Account, game, team,
  or player path.
- Opt-out prevents future collection. Existing observations have no user or
  Account identifier, so they cannot be selectively linked or deleted; they
  expire under the short raw retention. Do not claim otherwise.
- Analytics is excluded from portable data exports because it has no subject
  link. Consent status is an application preference, not baseball data.

Production access is least privilege and audited at the provider boundary.
Exports, ad audiences, resale, data brokering, and combining the stream with
identity, roster, report, or webhook data are prohibited.

## Release and incident checklist

Before release, the privacy/security owner verifies that the configured sink
accepts only the catalog, automatic vendor collection is disabled, IP/user-agent
storage is disabled or discarded before persistence, raw retention is at most
30 days, aggregate retention is at most 13 months, and deletion/access controls
have operational evidence.

If a forbidden field or identifier is observed, disable the sink, restrict
access, preserve minimum incident evidence, purge affected provider data,
rotate any exposed credential, and complete the private security/privacy
incident process before re-enabling collection.
