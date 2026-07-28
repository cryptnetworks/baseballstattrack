# Repository security and branch baseline

## Applied settings

As of 2026-07-24:

- Repository remains private.
- Dependabot vulnerability alerts are enabled.
- Automated Dependabot security fixes are enabled.
- Dependabot updates are configured for npm and GitHub Actions.
- CODEOWNERS, issue templates, pull-request checklist, and SECURITY.md are present.
- Actions default workflow token permissions are restricted to read-only where supported.

## Plan-limited settings

The following settings could not be enabled because GitHub reports that this private repository requires GitHub Pro or a public repository:

- Protected branch rules/rulesets for main
- Secret scanning and push protection

Private vulnerability reporting is also not exposed by the current repository API response. Revisit it after changing plan or visibility.

## Main branch target state

Apply these protections as soon as the repository plan allows:

- Require pull requests before merging.
- Require at least one approving review.
- Dismiss stale approvals when new commits are pushed.
- Require conversation resolution.
- Require the required CI checks once the stack exists.
- Require branches to be up to date before merging.
- Restrict force pushes and branch deletion.
- Allow administrator bypass only for documented emergencies.

Required check names after the application skeleton:

- `verify`

The workflow contract and exact check-name rationale are documented in [docs/CI_QUALITY_GATES.md](../docs/CI_QUALITY_GATES.md).

## Repository security target state

- Keep the repository private until the product and data-handling model are reviewed.
- Enable Dependabot alerts, security updates, and grouped updates.
- Enable secret scanning and push protection when available.
- Enable private vulnerability reporting when available.
- Review Actions permissions and pin third-party actions to trusted versions or commit SHAs.
- Add environment approvals for production deployments.
- Review collaborators and outside access quarterly.

## Release baseline

A release requires passing CI, reviewed migrations, a rollback plan, an updated changelog or release note, and confirmation that backups and restore procedures work.
