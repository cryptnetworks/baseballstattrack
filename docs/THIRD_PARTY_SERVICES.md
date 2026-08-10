# Third-party services

> **Draft for attorney, privacy, security, and operations review.** This is not
> a final subprocessor list or a claim that every listed service is active.
> Production operators must replace deployment-dependent entries with verified
> provider names, locations, contracts, settings, and retention terms.

## Status definitions

- **Implemented boundary:** repository code supports or requires this service
  category. A particular deployment still needs configuration and verification.
- **Optional/configurable:** the integration is available but operates only when
  an authorized operator enables and configures it.
- **Approval-gated/planned:** architecture or staging exists, but production use
  is prohibited until the documented approvals are complete.
- **Development/distribution:** supports repository development or image
  distribution rather than ordinary end-user processing in the application.

## Service inventory

| Service or category                                            | Status                                                                      | Purpose and data exchanged                                                                                                                                                              | Responsibility boundary                                                                                                                                                                                                                                 |
| -------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supabase authentication                                        | Implemented boundary                                                        | Starts OAuth, exchanges callbacks, and manages cookie or bearer sessions. Provider subject and limited profile/contact claims are linked to an internal user.                           | Supabase proves the configured identity relationship; current application membership and authorization control account access. Provider-side identity deletion and provider settings remain operator/provider responsibilities.                         |
| Configured OAuth provider (Google, GitHub, or Microsoft Azure) | Optional/configurable through Supabase                                      | Authenticates the user and returns provider identity claims to Supabase/application callback flow.                                                                                      | Only the selected provider is used. Its terms and privacy practices apply. Authentication does not grant baseball-data authority.                                                                                                                       |
| PostgreSQL                                                     | Implemented boundary; hosting vendor deployment-dependent                   | Stores account-scoped application records, baseball source history, derived checkpoints, configuration references, and minimized audits.                                                | The repository supports PostgreSQL 17 and self-hosted Compose. No managed database vendor is approved by this document. Operators own encryption, access, backup, capacity, location, and recovery configuration.                                       |
| Application/container host and TLS ingress                     | Deployment-dependent                                                        | Processes application requests, configuration, transient response data, and operational logs; terminates secure network traffic.                                                        | No hosting provider is selected by repository documentation. The operator must document provider, region, logging, subprocessors, deletion, incident terms, and availability.                                                                           |
| Discord                                                        | Optional/configurable                                                       | OAuth installation may exchange guild and channel information; configured bots may read authorized statistics and send selected updates or notifications to approved channels.          | Discord's terms apply after data is delivered. The account/operator controls guild, channel, role, bot credentials, and enabled content. Discord access never creates unrelated account authority.                                                      |
| SMTP/email delivery provider                                   | Optional/configurable; feature disabled by default in example configuration | Sends operator-configured notifications to approved adult destinations. Email address, message content, delivery metadata, and provider credentials may be processed.                   | No vendor is selected or approved here. Operators must verify recipients, content minimization, retention, security, suppression, and provider terms before enabling.                                                                                   |
| Calendar applications consuming ICS feeds                      | Optional/configurable                                                       | A user-selected calendar client retrieves a revocable feed containing the configured level of game schedule detail.                                                                     | The application generates the feed; the user chooses the recipient application. Copies retained by that application cannot necessarily be recalled by rotating or revoking the feed.                                                                    |
| Account-selected webhook endpoints                             | Optional/configurable                                                       | Sends versioned, allowlisted event envelopes and delivery metadata to an HTTPS endpoint selected by an authorized account user.                                                         | The recipient gains no inbound application authority. The account is responsible for the destination; the platform is responsible for signing, bounded retries, and not adding undeclared fields.                                                       |
| Product analytics sink                                         | Optional/configurable; no named provider approved                           | Receives only consented, schema-allowlisted, coarse reliability observations without user, account, player, team, game, IP, or fingerprint identifiers under the approved design.       | Collection must remain off unless consent and provider controls are verified. Automatic vendor tracking, enrichment, session replay, and longer retention are outside the approved boundary.                                                            |
| Licensed external baseball data provider                       | Approval-gated/planned for live use                                         | A server worker may retrieve strict, versioned baseball records using a managed credential and stage provenance, normalized payloads, correction lineage, and quota/freshness metadata. | No public MLB, Baseball Reference, or other website is an approved source. Written permission must define capabilities, attribution, cadence, quota, retention, backfill, and redistribution before activation. Ingestion does not make data canonical. |
| GitHub and GitHub Container Registry                           | Development/distribution                                                    | Hosts repository collaboration, CI metadata, and published container images. Source changes may include contributor identity and review history.                                        | GitHub terms govern its service. Production application records must not be placed in issues, pull requests, workflows, or container images.                                                                                                            |

## Data-minimization rules across providers

- Send only fields needed for the configured purpose and account scope.
- Do not send credentials, raw tokens, database URLs, export bodies, private
  notes, or arbitrary event payloads to logs or unrelated providers.
- Do not use player or parent contact information because the product does not
  support collecting it.
- Preserve required provider attribution, source version, freshness, and
  correction status in downstream uses where applicable.
- Use dedicated, revocable service identities and least-privilege grants.
- Disable a provider or integration when authorization, terms, credentials,
  retention, or safe configuration cannot be verified.

## Production approval record

Before enabling a deployment, maintain an attorney- and privacy-reviewed record
for each active provider containing:

- legal provider name, service, contract owner, and approval date;
- purpose, data categories, account scope, and users affected;
- processing and storage locations, subprocessors, and transfer terms;
- security controls, credential owner, access restrictions, and incident route;
- retention, deletion, backup, export, and termination behavior;
- required notices, attribution, quotas, and redistribution limits; and
- configuration evidence showing that optional or automatic collection is off
  unless expressly approved.

Third-party data availability, features, terms, and licensing may change. This
inventory must be reviewed when a provider, field, destination, or purpose changes.
