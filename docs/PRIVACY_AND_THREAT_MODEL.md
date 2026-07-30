# Privacy and threat model

This M0 design baseline identifies privacy and security risks before M1 stores youth-adjacent data. It is not a legal-compliance assessment and makes no COPPA, FERPA, GDPR, CCPA, or similar claim. Legal, retention, provider, and operational review remain required before production youth data is accepted.

## Scope and settled boundaries

The boundary includes the browser, application server, identity provider, PostgreSQL/Supabase boundary, invitation delivery, projections, reports/exports, logs and telemetry, CI, previews, backups, restores, and developer environments. Browsers, other-Account users, export recipients, and external attackers are untrusted. Providers are trusted only for documented responsibilities.

- `Account` is the tenant boundary; M1 forbids cross-Account baseball-record moves.
- The current database membership/grant state authorizes server operations; claims and client guards do not.
- Source events, corrections, and accepted setup snapshots are append-only and authoritative; projections and reports are derived and rebuildable.
- Public reports, bearer links, public rosters/profiles, and search indexing are disabled in MVP. Players and parents have no MVP login.
- Viewer access is authenticated, report scoped, and limited to a report type's minimum-field allowlist.
- Security audits are distinct from baseball source events. Exports, logs, telemetry, and backups remain inside the privacy boundary.

Severity is qualitative: **High** can expose sensitive youth/account data or tenant integrity; **Medium** has meaningful bounded impact; **Low** requires strong preconditions or has limited impact.

## Sensitive assets and minimum collection

| Asset                                                                                             | Purpose and sensitivity                                    | Required handling                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider subject, user, membership, grants                                                        | High identity/access data; Account scoped where applicable | Provider subject is an immutable external key; email is mutable, never a foreign key. Current DB authorization and audited changes apply; retain only a stable historical actor id after detachment. |
| Invitation state and token verifier                                                               | High temporary access path; Account scoped                 | Use a 256-bit token with a non-recoverable verifier, identity/account binding, expiry, and single use. Never log or export either value.                                                             |
| Player display name, jersey, roster, lineup, and game history                                     | Reidentifiable sports history; Account/game scoped         | Collect only roster/report necessities. Exact tenant scope and field allowlists apply. Jersey number plus date, opponent, team, and statistics can reidentify a player even after a name change.     |
| Birth date/year/age band                                                                          | High youth data                                            | MVP collects none. A future eligibility feature must justify birth year (never full DOB), private capability, no event/snapshot/log/export use, and retention/privacy design first.                  |
| Player or parent/guardian contact                                                                 | High youth/family contact                                  | MVP collects none. Never place it in events, snapshots, reports, exports, or generic logs.                                                                                                           |
| Adult profile/contact and invitation delivery contact                                             | Sensitive contact                                          | Limit to authentication or invitation delivery; keep mutable, capability-gated, and out of events, snapshots, and routine exports.                                                                   |
| Notes, including medical, injury, behavioral, family, eligibility, or hidden administrative notes | Very high free text/health-adjacent data                   | MVP supports none. Exclude from UI, API, events, snapshots, reports, exports, search, logs, and telemetry.                                                                                           |
| Events, corrections, snapshots, projections, and reports                                          | Sensitive sports history                                   | Events and snapshots are authoritative; they contain no contacts, secrets, or notes. Projections/reports are account scoped, field-minimized, and rebuildable.                                       |
| Exports, audits, diagnostic logs, telemetry, and backups                                          | Portable/security copies                                   | Require the controls below. A downloaded export cannot be recalled.                                                                                                                                  |
| Sessions, recovery credentials, database/provider/service secrets                                 | Critical secrets                                           | Never include in source data, reports, exports, logs, telemetry, audits, or backups intended for ordinary restoration access. Rotate and investigate exposure.                                       |

## Explicit field and sharing policies

MVP collects no DOB, birth year, age band, player/parent contact, or free-form player notes. It has no public report, bearer sharing link, public player profile, public youth roster, or export. Future sharing requires a separate ADR and threat review.

If a future feature needs structured eligibility data or notes, it needs a separate privacy review, private capability, allowed-content and size policy, retention/privacy workflow, audit, and explicit no-snapshot/no-export decision before collection. A note feature must not become a workaround for medical or family data.

## Trust boundaries and authorization interaction

| Flow                                     | Required control and failure behavior                                                                                                                                |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser → server                         | HTTPS in deployment; server validation; current membership/capability/Account scope; safe error and correlation id; conceal unauthorized existence.                  |
| Server → identity provider               | Provider subject authenticates; never log provider token; claims are hints; credential recovery never restores membership automatically.                             |
| Server → database                        | Account predicate plus tenant-scoped relationships; no database URL logging; protected-operation lookup outage fails closed.                                         |
| Server → invitation provider             | Minimum delivery data; raw token never stored/logged; delivery failure cannot activate membership.                                                                   |
| Event → projection → report → export     | Explicit service identity, Account context, source revision, and privacy-overlay revision. Report/export reauthorizes sources; stale data never claims verification. |
| App → audit/log/telemetry/backup/restore | Sanitized identifiers only; restricted access; restore is isolated and audited.                                                                                      |
| CI/preview/developer → data              | Read-only CI/no app secrets; synthetic fixtures only; isolated preview/test databases; no production dumps or fallback to a production-like DB.                      |

The canonical authorization algorithm and its stale-session, membership-removal, scoped-grant, Viewer/private-field, invitation, recovery, service-identity, idempotent-retry, and audit-write-failure rules are in [Authentication and authorization boundaries](AUTHENTICATION_AND_AUTHORIZATION.md). Future tests must cover cross-Account reads, writes, correction targets, projections, reports, exports, jobs, cache keys, audit queries, ruleset lookups, and backup restores; opaque IDs are not authorization.

## Historical snapshots and privacy actions

An accepted setup snapshot, source event, correction, and historical actor id is never edited or deleted to perform a privacy action. A privacy action is an Account-scoped, append-only, privileged, audited **privacy overlay** with a stable id, effective ordering, target identity/snapshot scope, approved display-field replacements, reason code, and actor/correlation metadata. It must not contain secrets, contacts, notes, or a duplicate raw snapshot/event payload.

- The overlay is the only mechanism that changes a displayed player name or other approved display field after acceptance. It never changes player identifiers, jersey-number/baseball facts, ruleset, event order, scoring meaning, or source revision.
- Replay calculates baseball state from immutable effective events and snapshots, so it remains deterministic. Presentation, projections, reports, and future exports resolve approved display fields through the current effective overlay; after pseudonymization they show the current pseudonym rather than a historical name by default.
- A restricted audit/replay capability may establish that an overlay occurred, actor attribution, and baseball continuity, but must not expose replaced personal data merely to show history. Audit actor attribution uses stable opaque ids, not mutable display names.
- Rebuilds record the source and privacy-overlay revisions and regenerate projections/reports when either changes. Existing hosted exports are revoked when possible and new output is generated from current authorized data; downloaded copies cannot be changed or recalled.
- The overlay reduces risk, not identity: jersey number, lineup, date, opponent, location, game history, and statistics remain potentially reidentifying. A requested action that cannot meet its stated privacy purpose through this model requires legal/privacy review before implementation.

## Export contract

The initial M3 JSON export and mutation-free import dry run are documented in
[Data export and import validation](DATA_EXPORT_AND_IMPORT.md). Export requires
active membership, explicit `report.export`, exact Account scope, current
source replay, current privacy overlays, a strict field allowlist, and a
restricted audit manifest. Import validation separately requires
Account-scoped `account.manage`; no import commit or cross-Account transfer is
implemented.

- Server-generated filenames, row and total-size limits, and an all-or-nothing generation result are required. A failure produces no downloadable partial artifact and records a safe failure outcome.
- The generator must prevent mixed-Account batches, reauthorize before each protected artifact and again at hosted download, and revoke future hosted access when membership or source authorization is removed. Hosted access is short lived.
- JSON is the implemented archival format. The shared future CSV/spreadsheet
  neutralization rule prefixes cells whose first effective character is `=`,
  `+`, `-`, or `@`, including after control characters; tests cover each case.
- Exclude contacts, age data, notes, tokens, raw source-event payloads, and raw audit data unless a future restricted-audit policy approves them. Corrections or privacy overlays require regeneration from current authorized data.

## Retention, deletion, and restore categories

Exact periods, legal holds, RPO/RTO, and provider settings are deferred. The following handling categories are mandatory; a legal hold defers deletion or pseudonymization only through a recorded, access-restricted decision and does not restore authorization.

| Category                                           | Handling category                                                                                                                                                                                     |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User profile and adult contact                     | Detach or pseudonymize mutable fields; retain stable actor/history ids only where necessary.                                                                                                          |
| Membership and invitation                          | Archive audit history; disabled/removed/expired/used states never authorize; hard-delete raw invitation material and never retain a recoverable token.                                                |
| Player identity and roster                         | Pseudonymize approved display fields; archive roster relationship/history.                                                                                                                            |
| Accepted snapshots, source events, and corrections | Retain as authoritative append-only baseball history; apply privacy overlay rather than editing the record.                                                                                           |
| Draft game with no accepted source event           | Hard-delete eligible, including setup preview data, when no legal hold applies.                                                                                                                       |
| Cancelled game                                     | Archive lifecycle/audit record; hard-delete only if it remains an eligible never-started draft with no accepted source event.                                                                         |
| Abandoned or started game                          | Retain authoritative partial history and archive its lifecycle state; do not silently delete accepted events.                                                                                         |
| Projections and reports                            | Delete and rebuild from effective source plus privacy overlay; never authoritative.                                                                                                                   |
| Generated export and export manifest               | Revoke/delete hosted artifact when eligible; retain a minimized occurrence/authorization manifest as a restricted audit record. No recall promise for downloaded copies.                              |
| Security audit                                     | Append-only, restricted, minimized; await legal/operational period decision before purge/redaction.                                                                                                   |
| Diagnostic logs and telemetry                      | Minimized and access-restricted; await operational period decision, then delete or redact according to the approved schedule.                                                                         |
| Backups                                            | Encrypted expected operational control, restricted and audited; expire under the approved backup schedule. Pseudonymized/deleted material may persist until expiry or a recorded legal-hold deferral. |
| Test fixtures, previews, and local data            | Synthetic only and hard-delete eligible/disposable; production data is prohibited.                                                                                                                    |

Backups are sensitive authoritative copies, not a repository-verified provider guarantee. Restore access is restricted and audited, occurs in an isolated environment, and never creates developer fixtures or production dumps. Before restored data can serve users, the procedure invalidates restored sessions, invitations, and recovery secrets; reapplies and verifies privacy actions recorded after the backup point; rebuilds projections; verifies Account constraints, ownership/membership state, and audit continuity; and records intentional reintroduction of archived data for review.

## Logging, telemetry, and development controls

Diagnostic logs and error-monitoring/telemetry platforms follow the same redaction policy. Never send or log session/refresh/invitation/recovery secrets, passwords, MFA secrets, database URLs, service secrets, query-string values, full source-event payloads, export contents, private notes, unnecessary contact/age data, or player display names. Account and player references use scoped stable identifiers only when needed; correlation ids are non-secret and must not encode personal data. Client error messages are sanitized before collection.

Security audits are distinct from diagnostic logs: audits contain the minimum privileged-action evidence and fail closed when required; diagnostic logs/telemetry support operations and are redacted, access-restricted, and separately retained. Future implementation must test redaction in server errors, client-error reporting, telemetry, worker errors, URL/query handling, and audit serialization.

## Prioritized threat register

Existing mitigations below are design constraints, not claims that code or operations already enforce them. Every future implementation must name its owner, test the stated preconditions, emit the listed safe detection signal, and implement recovery.

| Threat                                       | Asset, actor, and precondition                                                             | Impact / likelihood | Required control, detection, and recovery                                                                                                                  | Residual risk / owner                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Cross-Account leak/IDOR                      | Account records; other-Account user or worker; missing predicate/foreign key/cache context | High / Medium       | Composite constraints, scoped queries, per-account workers and cache keys; monitor denials/anomalies; stop access, repair scope, audit.                    | Medium; #9, #10, future service-worker work |
| Private youth-data export                    | Report/export; authorized-but-over-scoped actor or revoked member                          | High / Medium       | Per-record authorization, field allowlist, fresh source, manifest, download recheck; monitor manifests; revoke hosted artifact, investigate.               | Medium after download; future export work   |
| Spreadsheet/CSV formula injection            | Export cell; malicious roster/display value                                                | High / Medium       | Format-specific neutralization and regression tests; record safe generation failure; stop/revoke artifact and investigate.                                 | Low-Medium; future export work              |
| Account takeover, invitation/recovery abuse  | Membership/recovery/invitation; attacker with forwarded, replayed, or recovered credential | High / Medium       | Canonical auth controls, atomic terminal transitions, rate limits, audits; alert on abuse; freeze/revoke and investigate.                                  | Medium; future auth work                    |
| Stale authorization or retry after removal   | Protected resource; stale claim, removed member, or idempotent worker retry                | High / Medium       | Current DB recheck at commit/artifact boundaries; denial metrics; deny/revoke and reconcile.                                                               | Low-Medium; future auth and worker work     |
| Log or telemetry leakage                     | Secrets, contact, display name, payload; developer/error platform                          | High / Medium       | Allowlisted structured fields, redaction tests, restricted access; secret/redaction alerts; restrict, rotate, and investigate.                             | Medium; observability follow-up             |
| Backup exposure or restore reintroduction    | Backup and archived/pseudonymized data; operator or compromised backup                     | High / Medium       | Expected encryption, restricted audited isolated restore, post-backup overlay replay; restore drill/audit; invalidate secrets, rebuild, and record review. | Medium; M4 backup/restore work              |
| Insider or service-actor overreach           | Tenant data; support/service identity with broad scope                                     | High / Medium       | Least privilege, explicit Account context, audit, access review; anomalous-access monitoring; disable identity and investigate.                            | Medium; #10/M4                              |
| Pseudonymization failure or reidentification | Snapshot/display/game context; viewer/export recipient                                     | Medium / Medium     | Append-only overlay, display resolution, rebuild tests, minimum fields; overlay/rebuild drift detection; revoke/rebuild and review.                        | Medium; privacy-action follow-up            |
| Production data in non-production            | Any production copy; developer/CI/preview                                                  | High / Medium       | Synthetic-only fixtures, isolation, no dumps; fixture/egress review; remove copy, rotate, investigate.                                                     | Low-Medium; #9/#12/M4                       |
| Free-text note misuse                        | Health/family data; feature/user input                                                     | High / Medium       | Feature absent until separate approval; schema/API allowlist tests; detect rejected field; remove/quarantine and investigate.                              | Low in MVP; future privacy review           |

## Security acceptance criteria and implementation mapping

| Area                             | Required evidence                                                                                                                                      | Owner or gap                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Schema and tenancy               | Account-scoped FKs, field/snapshot allowlists, no contact/secret event payloads, privacy-overlay storage separate from snapshots, projection isolation | #9; privacy-action schema follow-up before implementation                          |
| Event/replay and projection      | Immutable baseball replay, overlay-aware display projection/rebuild, correction and tenant tests                                                       | #10; #11 owns stat derivation, not #12                                             |
| Fixtures and regression tests    | Synthetic-only fixtures plus tenant, redaction, overlay, restore, and export-injection regression coverage                                             | #12 for fixtures; focused security-test follow-up for controls not owned by #9–#12 |
| Authorization and service actors | Current membership, private/export capability, Viewer fields, stale/retry denial, privileged audit, isolated workers                                   | Canonical Issue #7 contract; future auth/service-worker implementation             |
| Exports                          | Allowlists, source freshness, formula-injection defenses, limits, manifest, hosted-download recheck/revocation                                         | Dedicated export follow-up before M3 export capability                             |
| Observability and operations     | Redaction, telemetry access, backup/restore drills, retention schedule, provider settings, RPO/RTO                                                     | M4 plus focused observability and backup/restore follow-ups                        |

The roadmap currently has no dedicated implementation issue for privacy-action/pseudonymization, secure exports, observability redaction, backup/restore, or service-worker controls. These are explicit gaps, not approval to ship; create narrowly scoped issues before the corresponding capability ships.

## Issue #8 acceptance mapping and deferrals

| Criterion                                                  | Coverage                                                                                         |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Assets, actors, trust boundaries, threats, and mitigations | Asset inventory, flow boundaries, tenant/auth reference, threat register, and owner/gap mapping. |
| Birth year, notes, contacts, and exported reports          | Explicit MVP no-collection/no-notes/no-export policy and deterministic future export contract.   |
| Security criteria linked to implementation                 | #9 schema, #10 replay, #11 derivation, #12 fixtures, future auth/export/privacy/operations gaps. |

This document does not implement auth, exports, sharing, privacy workflows, encryption infrastructure, backup automation, retention jobs, M1 events, replay, stat derivation, legal policy, or production security systems.
