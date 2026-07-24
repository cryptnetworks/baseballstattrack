# Repository security and branch baseline

The connected GitHub integration cannot apply repository settings or branch rules directly. These are the intended settings for an administrator to apply before the first production release.

## Main branch

- Protect main.
- Require pull requests before merging.
- Require at least one approving review.
- Dismiss stale approvals when new commits are pushed.
- Require conversation resolution.
- Require the required CI checks once the stack exists.
- Require branches to be up to date before merging.
- Restrict force pushes and branch deletion.
- Allow administrators to bypass only for documented emergencies.

## Repository security

- Keep the repository private until the product and data-handling model are reviewed.
- Enable Dependabot alerts, security updates, and grouped updates.
- Enable secret scanning and push protection when available.
- Enable private vulnerability reporting.
- Review Actions permissions and pin third-party actions to trusted versions or commit SHAs.
- Limit workflow token permissions to read-only by default.
- Add environment approvals for production deployments.
- Review collaborators and outside access quarterly.

## Release baseline

A release requires passing CI, reviewed migrations, a rollback plan, an updated changelog or release note, and confirmation that backups and restore procedures work.
