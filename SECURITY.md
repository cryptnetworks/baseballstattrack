# Security Policy

## Reporting a vulnerability

Do not open an issue or pull request for a suspected vulnerability. This includes suspected authentication bypass, secret or token exposure, cross-Account access, exploitable injection, youth-data exposure, backup exposure, active abuse, or unpublished vulnerability details.

This repository is private. As of July 29, 2026, GitHub private vulnerability reporting and repository security advisories cannot be relied on for this repository, and the repository API does not expose an enabled private-reporting form. The previous `/security/advisories/new` issue-template link was therefore not a usable reporter path.

Use the **Email me!** link on the repository owner's maintainer-controlled site at [mdesocio.com](https://mdesocio.com/#hero). In the first message:

- use a neutral subject such as `Baseball Stat Track security report`;
- include your GitHub username and a safe way to continue privately;
- include the affected version or commit, affected component, impact, and minimal reproduction only when they can be shared safely;
- use synthetic or redacted data;
- omit real credentials, tokens, cookies, database URLs, production dumps, private event payloads, and real youth or other personal data.

Do not test against production, access another Account, retain data, or broaden testing without explicit authorization. If the site or email link is unavailable, do not disclose details publicly or invent another contact. Wait until the repository owner restores or publishes a private channel.

The maintainer will acknowledge and coordinate when reasonably able. No fixed response or remediation time is promised. The report may be moved to another mutually agreed private channel before detailed evidence is exchanged.

## Supported versions

Until the first production release, only the default branch is considered supported.

## Security baseline

The project will require:

- secret-free commits and environment-specific configuration;
- least-privilege authentication and authorization;
- server-side validation for all persisted input;
- tenant/team isolation before multi-team release;
- dependency and workflow security scanning;
- backups and tested restore procedures before production data is accepted;
- auditability for scoring corrections and privileged actions.

Repository settings that require GitHub administrator UI/API access are tracked in .github/branch-protection.md.

The complete defect, regression, triage, and verification workflow is documented in [docs/DEFECT_TRIAGE_AND_REGRESSION_POLICY.md](docs/DEFECT_TRIAGE_AND_REGRESSION_POLICY.md).
