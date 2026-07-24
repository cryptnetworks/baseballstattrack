# Security Policy

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Contact the repository owner's private vulnerability-reporting channel or private contact method.

Include the affected area, reproduction steps, impact, and any suggested mitigation. Remove secrets and personal data from reports.

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
