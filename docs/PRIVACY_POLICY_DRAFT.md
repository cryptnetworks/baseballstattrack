# Privacy Policy — draft

> **Attorney-review draft only.** This is not a final privacy policy, legal
> advice, or a claim of compliance with any privacy law. It describes the
> repository's intended technical boundary; the actual deployment, provider
> settings, retention jobs, notices, and request procedures must be verified
> before publication.

Effective date: [EFFECTIVE DATE]

Privacy contact: [PRIVACY CONTACT EMAIL]

Entity responsible for the hosted service: [LEGAL ENTITY NAME]

## 1. Scope and roles

This draft applies to personal information processed through the hosted
Baseball Stat Track service, website, application, APIs, and configured
integrations. It does not govern an independently operated deployment unless
that operator adopts an appropriate policy.

An account organization may decide which team and player information to enter
and who may access it. Counsel must determine and document the legal roles of
[LEGAL ENTITY NAME], account organizations, and service providers for each
deployment and jurisdiction.

## 2. Information the service may process

Depending on enabled features and user choices, the service may process:

- **Account and identity information:** identity-provider subject, application
  user identifier, display name, email or other adult contact used for
  authentication or invitation delivery, account membership, roles, grants,
  locale, and preferences.
- **Baseball operations information:** account, team, season, player display
  name, jersey number, batting side, throwing hand, position, roster, lineup,
  game schedule, opponent, location, scoring events, corrections, and derived
  statistics or reports.
- **User-provided and imported information:** versioned export or import files,
  normalized provider records, source identifiers, versions, retrieval times,
  attribution, correction lineage, and quarantine status.
- **Integration information:** configured Discord guild, channel, and role
  identifiers; notification destinations; calendar-feed settings; webhook
  endpoints and delivery status; dedicated integration identities; and
  provider configuration references. Secrets and raw tokens should be held in
  managed configuration rather than ordinary records or logs.
- **Security and operations information:** stable internal actor identifiers,
  authorization and lifecycle outcomes, timestamps, correlation identifiers,
  rate-limit events, service health, and minimized audit records. Logs are
  designed to exclude player names, event bodies, credentials, and raw exports.
- **Optional product analytics:** only after valid opt-in, a strict catalog of
  coarse live-scoring workflow, duration, result, and failure-category events.
  The catalog excludes user, account, player, team, game, device, network, and
  provider identifiers, free text, source-event content, IP-address storage,
  session replay, fingerprinting, and automatic page tracking.

## 3. Information outside the product boundary

The current product is not designed to collect player birth dates, birth year,
age bands, player or parent/guardian contact information, medical or injury
information, behavioral or family notes, eligibility notes, or private
free-form player notes. Users must not place that material in names, scoring
events, imports, integration messages, or other fields.

Adult authentication or invitation contact is distinct from player or parent
contact. Technical validation reduces risk but cannot guarantee that a user
will never submit unsupported information. A future feature involving youth
eligibility, direct child access, contacts, public sharing, or notes requires a
new privacy, security, product, and legal review before collection.

## 4. Purposes of processing

Information may be used to:

- authenticate users and enforce current account-scoped authorization;
- operate team, roster, game, scoring, correction, reporting, and export workflows;
- preserve source history, provenance, revision evidence, and security audits;
- calculate and rebuild derived statistics and reports;
- validate imports and stage approved external-provider records;
- deliver user-configured integrations and notifications;
- protect the service, prevent abuse, diagnose failures, and support recovery;
- execute authorized privacy, export, and account-lifecycle requests; and
- measure coarse product reliability when a user has opted in.

Counsel must identify lawful bases and required notices for each purpose and
deployment. This draft does not assert a lawful basis.

## 5. Authentication and account access

The implemented authentication boundary uses Supabase sessions and a
configured OAuth provider. Depending on configuration, the upstream OAuth
provider may be Google, GitHub, or Microsoft Azure. Those providers may process
login and device information under their own terms. The application links an
immutable provider subject to an internal user record; email is mutable contact
information, not the stable authorization key.

Only current active account membership and server-side authorization grant
access. Account owners and administrators control membership within the
service's role and capability rules. Removing application access does not by
itself delete the upstream provider identity.

## 6. Cookies, browser storage, and PWA behavior

Authentication uses secure, HTTP-only, same-site cookies in the supported
deployment design. The progressive web application caches approved public
static assets only. It does not intentionally cache authenticated HTML, private
API responses, player records, scoring events, reports, or credentials.

Browser storage may retain an install-prompt preference and one narrowly scoped
unaccepted scoring recovery draft. Signing out clears local session cookies but
does not necessarily clear those local values or the public asset cache. Users
of a shared device should sign out and use browser site-data controls. Clearing
browser data does not delete server records.

## 7. Analytics

Product analytics defaults to no collection until an authenticated user opts
in. Consent is versioned and expires after 365 days; opt-out stops future
collection. Allowed raw observations have a maximum 30-day design retention.
Identifier-free aggregate counts or rates may be retained for up to 13 months
only when they cannot expose or reconstruct a person, account, team, player, or
game path.

Because allowed observations contain no user or account identifier, previously
collected observations cannot be selectively linked to a person for deletion;
they expire under the retention boundary. A configured analytics sink must be
verified against these controls before release. No third-party analytics
provider is approved merely by this document.

## 8. Integrations and disclosures

Information may be transmitted to configured service providers and destinations
only as needed for authentication, hosting, database operation, messaging,
calendar feeds, webhooks, analytics, or licensed data ingestion. Account users
may direct information to Discord, a calendar application, an email address, or
a webhook endpoint. Recipients then process that information under their own
terms and the account user's configuration.

The service does not treat an integration as authority to expose unrelated
account or private-player data. See
[Third-party services](THIRD_PARTY_SERVICES.md) for status and boundaries.
[ATTORNEY REVIEW: complete the actual provider/subprocessor list, locations,
transfer mechanisms, and contractual safeguards for the production deployment.]

## 9. Source history, corrections, and derived data

Accepted setup snapshots, scoring events, corrections, provenance evidence,
and security audits are append-preserving records. Current reports resolve
approved display fields through privacy overlays, and rebuildable projections
can be deleted and regenerated. A correction supersedes effective evidence but
does not conceal the prior event.

Pseudonymization does not necessarily make baseball history anonymous. Jersey,
team, game date, opponent, location, and statistics may still identify a
player. The service does not promise permanent retention of every record, and
it does not promise erasure of accepted history where the approved technical
workflow retains minimized evidence. A request that cannot be completed within
this boundary requires accountable privacy and legal review.

## 10. Exports and imports

Authorized exports are generated as current, account-scoped JSON after a
short-lived, one-time grant and current authorization check. The service does
not store a waiting export body under this workflow. Downloaded files cannot be
recalled and may contain reidentifiable sports history; the recipient is
responsible for protecting them.

Import is currently a validation and dry-run boundary. Uploaded content is
bounded, validated, and excluded from logs; no production import promotion is
promised by this draft.

## 11. Retention, deletion, and recovery

The repository documents technical retention baselines, not a universally
effective legal schedule. Current baselines include five-minute prepared export
grants, up to 30 days for allowed raw product analytics, up to 13 months for
qualifying analytics aggregates, and operational schedules for privacy/audit
evidence and backups. Deployment operators must verify that provider and backup
settings actually enforce approved schedules.

Authorized workflows may disable an account, detach a user, pseudonymize
current player identity, archive roster relationships, revoke prepared exports,
and delete rebuildable projections. Stable actor references and accepted source
history may be retained for scoring integrity, security, and recovery. Restored
backups must be reconciled with later privacy actions before serving traffic.

[ATTORNEY REVIEW: define final retention periods, legal holds, deletion rights,
exceptions, request verification, response times, appeals, and regional rights.]

## 12. Security and youth-sports responsibility

The architecture uses account scoping, least privilege, current authorization,
secret redaction, minimized audit records, and controlled exports. No system is
perfectly secure, and this draft makes no security or compliance guarantee.
Suspected vulnerabilities must be reported through the repository's
[Security Policy](https://github.com/cryptnetworks/baseballstattrack/blob/main/SECURITY.md).

Organizations remain responsible for applicable laws, league rules, and
parental or guardian requirements when handling youth-sports information. The
service must not be described as certified under COPPA, FERPA, GDPR, CCPA, or
another regime without a separate legal and operational assessment.

## 13. Changes and contact

A final policy must describe notice of material changes, version history,
effective dates, privacy request channels, identity verification, and any
rights available by jurisdiction.

Privacy questions and requests: [PRIVACY CONTACT EMAIL]

Mailing address: [PRIVACY CONTACT ADDRESS]
