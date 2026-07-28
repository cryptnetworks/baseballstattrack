# Privacy and threat model

This M0 design baseline identifies privacy and security risks before M1 stores youth-adjacent data. It is not a legal-compliance assessment and makes no COPPA, FERPA, GDPR, CCPA, or similar claim. Legal, retention, provider, and operational review remain required before production youth data is accepted.

## Scope and settled boundaries

The boundary includes the browser, application server, identity provider, PostgreSQL/Supabase boundary, invitation delivery, projections, reports/exports, logs, CI, previews, backups, restores, and developer environments. Browsers, other-Account users, export recipients, and external attackers are untrusted. Providers are trusted only for documented responsibilities.

- `Account` is the tenant boundary; M1 forbids cross-Account baseball-record moves.
- The current database membership/grant state authorizes server operations; claims and client guards do not.
- Source events, corrections, and required snapshots are append-only and authoritative; projections are derived and rebuildable.
- Public reports, bearer links, public rosters/profiles, and search indexing are disabled in MVP.
- Viewer access is authenticated, report scoped, and limited to a report type's minimum-field allowlist.
- Security audits are distinct from baseball source events; backups and exports remain inside the privacy boundary.

Severity is qualitative: **High** can expose sensitive youth/account data or tenant integrity; **Medium** has meaningful bounded impact; **Low** requires strong preconditions or has limited impact.

## Sensitive assets and minimum collection

| Asset                                          | Sensitivity, purpose, and scope                            | Handling rule and residual risk                                                                                                                                                                                                                    |
| ---------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider subject, user, membership, grants     | High identity/access data; Account scoped where applicable | Provider subject is immutable external key; email is mutable, never a foreign key; current DB authorization and audit changes; retain stable historical actor id after deletion. Provider compromise remains possible.                             |
| Invitation state/token verifier                | High temporary access path; Account                        | 256-bit token, server validation, non-recoverable verifier, identity/account binding, expiry/single use; never log/export token or verifier. Recipient/provider compromise remains possible.                                                       |
| Player display name, jersey, roster/lineup     | Sensitive sports identity; Account                         | Collect minimum roster/report fields; exact tenant scope; historical snapshot only when replay/report meaning needs it. Game context can reidentify a player.                                                                                      |
| Birth date/year/age band                       | High youth data                                            | MVP collects none. Scoring/statistics do not need it. A future eligibility feature must justify birth year (never full DOB), private capability, no event/snapshot/log/export use, and retention/pseudonymization rules first.                     |
| Player/parent contact                          | High youth/family contact                                  | MVP collects none; never events, snapshots, reports, exports, or generic logs.                                                                                                                                                                     |
| Coach/scorekeeper contact and invitation email | Sensitive contact                                          | Only authenticated adult profile or invitation-delivery minimum; private-field policy; no events/snapshots/routine export; detach/pseudonymize mutable fields on approved action.                                                                  |
| Private/medical/injury notes                   | Very high free text/health-adjacent data                   | MVP supports no player notes, medical, injury, behavioral, family, or contact notes. Exclude from UI/API/events/snapshots/reports/exports/search/logs.                                                                                             |
| Events, corrections, snapshots, stats, reports | Sensitive sports history; Account/game                     | Events/snapshots are authoritative; no contacts/secrets/notes. Reports/projections are account scoped and minimum-field; projections may rebuild.                                                                                                  |
| Exports, audit, logs, backups                  | High portable/security copies                              | Future exports need capability, source authorization, allowlist, audit manifest. Audits are restricted/append-only. Logs redact secrets/URLs/full payloads. Backups are encrypted/restricted/audited. Downloaded export copies cannot be recalled. |
| Sessions, recovery, DB/provider secrets        | Critical secrets                                           | Never source/events/snapshots/reports/exports/logs. Rotate/investigate on exposure.                                                                                                                                                                |

## Explicit field policies

### Birth year

MVP collects no DOB, birth year, or age band. If a future approved feature needs eligibility data, collect birth year only, require private-field access, exclude it from display by default, reports, exports, source events, snapshots, and logs, and define correction/pseudonymization/retention before collection.

### Notes

MVP prohibits free-form player notes. A future structured note needs a separate privacy review, capability, allowed-content/size policy, audit, retention/redaction rule, and explicit no-snapshot/no-export decision. It must not become a workaround for medical or family data.

### Contacts

No player/parent contact is stored in MVP. Authenticated adult profile/contact and invitation delivery contact are purpose-limited, mutable, non-authoritative, capability-gated, and excluded from events/snapshots/routine export. Invitation metadata is audit evidence, not an exportable contact list.

### Exports and public sharing

Exports are not implemented in M0/MVP. Future export requires `report.export`, active membership, exact Account/source scope, authorization for every included record, a report-type minimum-field allowlist, safe server-assigned filename, audit manifest, and short-lived hosted-download authorization. It excludes contacts, age data, notes, tokens, full raw events, and raw audit data unless a separate restricted-audit decision permits it. Corrections/pseudonymization require new output from current authorized data; the app may revoke future hosted access but cannot retract a downloaded/redistributed file.

There are no anonymous reports, bearer share links, public youth rosters, player profiles, or public indexing. Future sharing requires a separate ADR/threat review covering expiry/revocation, minimum fields, logging, rate limits, enumeration resistance, indexing controls, pseudonymization, and incident response.

## Actors, trust boundaries, and data flows

Owners, administrators, scoped coaches/scorekeepers/viewers, removed members, compromised members, other-Account users, attackers, invite recipients, service/projection/migration actors, future support operators, providers, export recipients, backup holders, and developers are distinct actors. The authorization contract governs the first group; service actors never impersonate membership; support recovery has no hidden superuser.

| Flow                                 | Required control and failure behavior                                                                                                                                                    |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser → server                     | HTTPS in deployment; server validation; current membership/capability/account scope; safe error/correlation id; conceal unauthorized existence.                                          |
| Server → identity provider           | Provider subject authenticates; never log provider token; claims are hints; credential recovery never restores membership automatically.                                                 |
| Server → database                    | Account predicate plus tenant-scoped relationships; no URL logs; protected-operation lookup outage fails closed.                                                                         |
| Server → invitation provider         | Minimum delivery data; raw token never stored/logged; delivery failure cannot activate membership.                                                                                       |
| Event → projection → report → export | Explicit service identity/Account context and source revision; report/export reauthorizes sources; stale projection never claims verified status.                                        |
| App → logs/backup/restore            | Sanitized ids only; encrypted restricted backups; restore isolated/audited, rebuilds projections, verifies tenant/auth/audit state, and invalidates restored invitation/session secrets. |
| CI/preview/developer → data          | Read-only CI/no app secrets; synthetic fixtures only; isolated preview/test databases; no production dumps or fallback to production-like DB.                                            |

## Tenant, authorization, and operational threats

Future work must prevent missing Account predicates, cross-Account foreign keys, guessed IDs, mixed-Account batch/export/cache keys, projection/audit queries without Account, over-scoped workers, stale claims, grant races, viewer/private-field confusion, invitation replay, recovery takeover, privileged audit failure, and service identity misuse. Require account-scoped lookup before capability resolution, composite tenant constraints where applicable, per-record export authorization or proved shared scope, and current authorization recheck before high-risk commit.

Required tests: cross-Account reads/writes/correction targets/projections/exports/jobs; enumeration concealment; stale-session denial; team/season/game inheritance; cache key includes Account; viewer private-field denial; invitation/recovery abuse; audit-write failure; projection/report authorization.

## Retention, deletion, and pseudonymization

Exact retention periods, legal holds, backup expiry, and RPO/RTO are deferred. The following are handling categories, not legal claims.

| Category                                     | Direction                                                                                                                               |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Profiles/contacts                            | Detach or pseudonymize mutable fields; retain stable actor/history where needed.                                                        |
| Memberships/invitations                      | Retain audit history; inactive states never authorize; never retain recoverable token.                                                  |
| Player identity/snapshots/events/corrections | Pseudonymize display fields where approved without destroying authoritative baseball meaning or replay. Snapshot fields need allowlist. |
| Projections/reports                          | Delete/rebuild from effective authorized source data; not authoritative.                                                                |
| Exports                                      | Record occurrence; revoke future hosted access if supported; downloaded copies cannot be recalled.                                      |
| Audit/logs                                   | Restricted/minimized; retention/redaction period deferred; required audit failure fails closed.                                         |
| Backups                                      | Restricted encrypted copies; deleted/pseudonymized data may persist until expiry; restore reapplies/verifies later privacy action.      |
| Fixtures/previews/local                      | Synthetic only; disposable never-started drafts may delete; no production youth data.                                                   |

Pseudonymization reduces risk but is not anonymity: roster/game/stat context can reidentify a player.

## Logging, backup, and development controls

Never log session/refresh/invitation/recovery/database/service secrets, database URLs, full event payloads, private notes, or unnecessary contact/age data. Use structured actor/resource/Account/correlation ids and sanitized error classes. Monitor high-risk denials, access/grant/ownership changes, exports, recovery/invitations, cross-Account denials, projection drift, and backup/restore.

Backups are sensitive authoritative data. Restore is privileged and audited into an isolated environment; validate source events, rebuild projections, confirm Account isolation/current authorization/audit continuity, and prevent old invitation/session/recovery secrets becoming valid. Production backups never become fixtures. CI follows `CI_QUALITY_GATES.md`: no PR secrets, migrations, seeds, or production database access.

## Prioritized threat register

| Threat                       | Impact / likelihood | Existing mitigation                 | Future control, detection, recovery                                            | Residual risk / mapping                           |
| ---------------------------- | ------------------- | ----------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------- |
| Cross-Account leak/IDOR      | High / Medium       | Account boundary and auth contract  | Composite constraints, scoped queries/tests, denial monitoring, revoke/repair  | Medium; #9/#10                                    |
| Private youth-data export    | High / Medium       | No export implementation            | Allowlist, per-record auth, manifest/audit, hosted-download expiry             | Medium after download; future report/export issue |
| Account/recovery takeover    | High / Medium       | Provider subject/current membership | Provider hardening, rate limits, abuse tests, audit/disable/revoke             | Medium; future auth implementation                |
| Invitation forwarding/replay | High / Medium       | Identity-bound single-use verifier  | Atomic terminal tests, delivery audit/revoke                                   | Low-Medium; future auth implementation            |
| Stale authorization          | High / Medium       | DB recheck contract                 | Transactional recheck tests/monitoring                                         | Low-Medium; future auth implementation            |
| Public report exposure       | High / Low in MVP   | Sharing disabled                    | Separate ADR before enabling                                                   | Low in MVP                                        |
| Backup/log exposure          | High / Medium       | Secret/log restrictions             | Encryption/access review, restore/redaction drills, rotation/incident response | Medium; M4                                        |
| Insider/service overreach    | High / Medium       | Scoped roles/service identity/audit | Access review, per-account jobs, worker tests/audit                            | Medium; #10/M4                                    |
| Pseudonymization failure     | Medium / Medium     | No public reports/minimum fields    | Snapshot allowlist/regression tests                                            | Medium; privacy follow-up                         |
| Real data in non-production  | High / Medium       | CI/env contract                     | Preview isolation/fixture review/incident cleanup                              | Low-Medium; #9/#12/M4                             |
| Free-text note misuse        | High / Medium       | No notes in MVP                     | Keep feature absent until reviewed                                             | Low in MVP                                        |

## Security acceptance criteria and mappings

| Area               | Required evidence                                                                                                             | Implementation mapping                              |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Schema/persistence | Account-scoped FKs, field/snapshot allowlists, no contacts in event payloads, projection isolation, export/audit metadata     | #9, #10; privacy schema follow-up before collection |
| Authorization      | Current membership, private/export capabilities, Account-scoped services, Viewer minimum fields, privileged audit             | Issue #7 contract; future auth implementation       |
| API/application    | Server validation, concealment, safe errors, free-text/input limits, export/download authorization                            | #10 and future reports/export work                  |
| Tests              | Tenant denial, stale session, Viewer fields, invitation/recovery abuse, log redaction, pseudonymization, restore privacy      | #9, #10, #12; M4                                    |
| Operations         | Secret rotation, backup restrictions/restore tests, incident monitoring, access review, retention, provider settings, RPO/RTO | M4 and focused follow-ups                           |

The roadmap lacks dedicated implementation issues for exports/hosted downloads, privacy-action workflow, backup/restore controls, and provider hardening. Create focused issues before those capabilities ship; this document does not authorize implementation.

## Issue #8 acceptance mapping and deferrals

| Criterion                                              | Coverage                                                                              |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Assets, actors, trust boundaries, threats, mitigations | Asset inventory, actor/flow boundaries, threat controls, residual risk, and register. |
| Birth year, notes, contacts, exports                   | Explicit MVP no-collection/no-notes policy and future export controls.                |
| Security criteria linked to implementation             | Mappings to #9/#10/#12, future auth/export work, and M4 operations.                   |

This document does not implement auth, exports, sharing, privacy workflows, encryption infrastructure, backups, retention jobs, legal policy, or production security systems.
