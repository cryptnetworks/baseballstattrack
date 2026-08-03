# Data ownership and usage

> **Draft for attorney review.** This document is a product-governance model,
> not a final allocation of legal rights. Ownership can depend on contracts,
> employment, league rules, provider licenses, and applicable law.

## Core model

Baseball Stat Track separates source evidence from derived outputs:

1. user-entered or approved imported records create versioned source evidence;
2. provenance identifies the source, retrieval or event time, version, and
   correction lineage where available;
3. accepted corrections add replacement evidence without silently rewriting
   prior history; and
4. versioned rules derive current scores, statistics, reports, and analytics.

This separation supports auditability and recalculation. It does not guarantee
that source material is accurate or that every record will be retained forever.

## Rights and permitted use by data class

| Data class                        | Rights model                                                                                                                                                                           | Service use and limits                                                                                                                                                                             |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User-entered baseball data        | The user or account organization retains the rights it holds. Players, leagues, officials, or other parties may also have rights or interests.                                         | A limited service license is needed to host, validate, secure, reproduce, derive, display, export, and transmit the data for authorized service operation. Users must have authority to submit it. |
| Imported provider data            | Remains subject to the provider's and other rightsholders' rights, license, attribution, retention, correction, and redistribution terms.                                              | Import requires an approved source and recorded permission. Public access is not permission to scrape. Use stops or changes when governing rights require it.                                      |
| Source events and corrections     | Rights follow the underlying user or provider source; the service's software, schema, and expressive presentation remain separately owned or licensed.                                 | Accepted evidence is append-preserving so revisions can be explained. A correction changes effective history without concealing prior evidence.                                                    |
| Derived baseball statistics       | Rights in underlying facts may differ from rights in software, formulas, compilations, database structure, and presentation. No ownership of baseball facts is asserted by this draft. | The service may calculate, cache, rebuild, display, and export derived outputs for authorized purposes. Outputs inherit source-license and privacy constraints where applicable.                   |
| Product analytics                 | Coarse, consent-aware reliability observations are separate from baseball history and contain no user, account, team, player, or game identifier under the approved catalog.           | Used to understand scoring friction and reliability, not advertising, profiling, eligibility, or prediction. Raw and aggregate retention is bounded by the privacy design.                         |
| Security and operational evidence | The service provider maintains minimized records needed to secure, operate, audit, and recover the service.                                                                            | Access is restricted. Records should not contain raw source events, player names, credentials, or export bodies unless a separately reviewed need exists.                                          |
| Software and documentation        | Governed by copyright ownership and the repository's MIT License.                                                                                                                      | The software license does not grant ownership of User Content or third-party data.                                                                                                                 |

## User responsibilities

Users and account organizations are responsible for:

- having the rights, authority, notices, and permissions needed to submit and
  use team and player information;
- limiting information to what the supported workflow needs;
- checking official records, rulesets, corrections, freshness, and verification
  status before relying on reports;
- protecting exports and configured destinations;
- honoring provider attribution, quotas, retention, and redistribution limits;
  and
- not entering medical information, unnecessary youth data, private notes,
  player or parent contacts, or other unsupported sensitive content.

## Provider data and provenance

An approved provider record should carry a stable provider identifier and
version, retrieval and effective times, normalized schema version, digest,
publication state, correction predecessor where applicable, and required
attribution. Malformed or ambiguous records are rejected or quarantined.

Retrieval does not make a provider record canonical. Publication requires
account scope, identity and ruleset review, replay where possible, statistic
reconciliation, and conflict handling. Provider data cannot overwrite manually
accepted scoring history. Third-party data availability and licensing may
change; withdrawal can require polling, publication, retention, or display to
stop.

## Corrections, revisions, and attribution

Current views should identify freshness, source revision, derivation version,
correction state, confidence, and attribution where the applicable contract
supports those fields. Superseded evidence remains distinguishable from the
current effective result.

Attribution required by a provider license must travel with the relevant
display, API, export, or downstream use. An account may not remove required
attribution or use a platform export to evade provider restrictions.

## Privacy lifecycle and retention

Current identity fields may be replaced or pseudonymized and derived
projections may be deleted and rebuilt. Accepted source history and minimized
audits may remain append-only to preserve scoring integrity, correction lineage,
and security evidence. Pseudonymized sports history may remain reidentifiable.

The platform does not promise permanent retention of all data. Retention is
subject to product lifecycle, account action, backup schedules, legal holds,
provider terms, security needs, and the final privacy policy. A downloaded
export is outside the platform's recall boundary.

## No expanded data license by implication

Account access, an API credential, an export, a public webpage, or an
integration does not grant ownership or unrestricted reuse. Rights are limited
to the applicable user authority, service terms, software license, provider
license, and law. Cross-account transfer, public redistribution, model training,
commercial data resale, and bulk extraction require separate express review and
are not approved by this document.

## Attorney-review items

- Final scope, duration, territory, sublicensing, and termination of the User
  Content license.
- Rights and obligations for organizations, coaches, players, and guardians.
- Legal characterization of baseball facts, compilations, and derived statistics.
- Treatment of deidentified or aggregate data and any improvement rights.
- Provider pass-through terms, attribution, deletion, and audit rights.
- Retention, legal holds, post-termination access, and downloaded exports.
