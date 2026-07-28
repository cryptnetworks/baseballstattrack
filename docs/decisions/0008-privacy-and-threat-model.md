# ADR 0008: Privacy and Threat Model

## Status

Accepted

## Context

Baseball Stat Track will hold youth-adjacent roster and sports history. ADRs 0004, 0005, and 0007 establish append-only replay, Account tenancy, and current-membership authorization. Issue #8 defines the privacy and threat-model decisions required before M1 persistence and future reports/exports.

## Decision

Adopt [Privacy and threat model](../PRIVACY_AND_THREAT_MODEL.md) as the canonical baseline:

- MVP collects no date of birth, birth year, age band, player/parent contacts, free-form player notes, medical notes, or injury notes.
- Contacts, secrets, and notes never enter source events or snapshots; snapshot fields are allowlisted to replay/report necessities.
- Account isolation, current database authorization, append-only history, rebuildable projections, and separate security audits remain security boundaries.
- Anonymous reports, public player data, bearer links, and indexing are disabled. Any future player/parent access is authenticated, report-scoped, and minimum-field.
- Exports and backups are sensitive copies: future exports require capability, field allowlist, tenant authorization, and audit; backups require restricted/audited isolated restore. Downloaded exports cannot be recalled.
- Pseudonymization may alter approved mutable display fields without casually destroying authoritative baseball history; it does not eliminate reidentification risk.

## Alternatives rejected

- Collect full DOBs, broad youth contacts, or notes for possible future use.
- Treat public report links as harmless read-only access.
- Hard-delete authoritative events/snapshots for privacy requests.
- Treat backups or exports as outside the privacy boundary.

## Consequences

M1 work needs Account-scoped relationships, field/snapshot allowlists, no contact/secret event payloads, private-field checks, and tenant-isolation tests. Focused implementation issues are required before collecting sensitive fields, exports, sharing, privacy workflows, or restore operations. Legal periods, RPO/RTO, provider settings, encryption details, and sharing design remain deferred.

## Revisit triggers

Create a new ADR before collecting age/contact/notes, enabling public sharing, changing tenant isolation, introducing cross-Account records, or adopting legal retention/deletion policy.
