# Repository security and branch baseline

## Applied settings

As of 2026-08-03:

- The repository is public.
- Dependabot vulnerability alerts and automated security fixes are enabled.
- Dependabot updates are grouped and bounded for npm, Python, GitHub Actions,
  and Docker.
- Secret scanning, push protection, private vulnerability reporting, and
  CodeQL are enabled.
- Actions default workflow-token permissions are read-only, and workflows
  cannot approve pull requests.
- Actions are restricted to GitHub-owned actions; every reference is pinned to
  an exact commit.
- CODEOWNERS, issue templates, the pull-request checklist, and SECURITY.md are
  present.

## Open repository setting

`main` does not yet have a branch protection rule or repository ruleset. Track
that as a medium-severity repository-control issue: require pull requests,
conversation resolution, and the `verify` and SAST checks without creating an
administrator lockout.

## Main branch target state

Apply these protections after validating the exact security check names:

- Require pull requests before merging.
- Require at least one approving review when another maintainer is available.
- Dismiss stale approvals when new commits are pushed.
- Require conversation resolution.
- Require branches to be up to date.
- Require `verify` and the security checks.
- Restrict force pushes and branch deletion.
- Allow administrator bypass only for documented emergencies.

The workflow contract and check-name rationale are documented in
[docs/CI_QUALITY_GATES.md](../docs/CI_QUALITY_GATES.md).

## Repository security target state

- Keep secret scanning, push protection, and private vulnerability reporting
  enabled.
- Keep Dependabot alerts, security updates, and grouped updates enabled.
- Keep Actions restricted to approved GitHub-owned actions and exact commit
  SHAs; review Dependabot SHA changes as executable code.
- Review collaborators and outside access quarterly.
- Replace production dispatch confirmation with a native required-reviewer
  rule when the repository plan exposes it.

## Release baseline

A release requires passing CI, reviewed migrations, a rollback plan, an
updated changelog or release note, and confirmation that backups and restore
procedures work. The executable release contract and operator procedure are in
[docs/RELEASE_AND_WORKFLOW_SECURITY.md](../docs/RELEASE_AND_WORKFLOW_SECURITY.md).
