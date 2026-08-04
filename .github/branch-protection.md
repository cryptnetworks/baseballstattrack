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

## Protected `main`

The active **Protect main** repository ruleset targets the default branch and:

- requires every ordinary change to arrive through a pull request;
- requires all review conversations to be resolved;
- requires the head branch to be current with `main`;
- requires the exact checks `verify` and `SAST required gate`;
- blocks force pushes and branch deletion; and
- permits an administrator-role bypass for documented emergencies.

The required approval count is zero while the repository has one maintainer.
This preserves the pull-request record and required checks without making the
sole maintainer approve their own change. Raise it to one when an independent
maintainer is routinely available. Do not enable last-pusher approval before
then.

`SAST required gate` always reports for pull requests and merge groups. It runs
the full Actions, JavaScript/TypeScript, and Python CodeQL matrix when the diff
contains analyzable source or workflow files; otherwise it records a successful
planned skip. Requiring the individual conditional CodeQL jobs would leave
documentation-only pull requests permanently pending.

## Release tags

The active **Protect release tags** ruleset targets `refs/tags/v*`. It blocks
tag deletion and non-fast-forward updates while allowing the release process to
create a new, unique version tag. The administrator-role emergency bypass also
applies. Never move or reuse a published release tag.

## Emergency bypass

Administrator bypass is acceptable only to contain an active security or
availability incident, repair a ruleset or required workflow that prevents all
ordinary recovery, or restore `main` after GitHub itself cannot process the
normal pull-request path. It is not an approval shortcut and must never be used
to conceal or waive a failing safety check.

Before bypassing, create a safe issue or private incident record when the
situation permits, identify the exact commit and rollback, and limit the change
to recovery. Afterward, open a follow-up pull request, obtain an independent
review when available, run the required checks against exact `main`, and record
the operator, reason, affected refs, commits, validation, and outcome within one
business day.

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

The rulesets preserve the release workflow: merge-queue groups receive both
required checks, Dependabot can continue to open and update pull requests, and
new `v*` tags can be created after a release is accepted.
