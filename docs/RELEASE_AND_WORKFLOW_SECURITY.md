# Release and workflow security

This runbook is the release contract for Baseball Stat Track. It makes a
release repeatable without selecting a hosting provider or weakening the
event, tenancy, migration, privacy, backup, or observability contracts.

## Supply-chain and workflow controls

The repository keeps the default `GITHUB_TOKEN` read-only. A job receives an
additional permission only where it is used: the release proof job receives
`packages: write` for an optional GHCR push. Workflows do not use pull-request
write access, long-lived personal tokens, or untrusted pull-request code with a
privileged token.

Every `uses:` reference is GitHub-owned and pinned to a full commit SHA. The
nearby version comment is informational; the SHA is the executed identity.
Dependabot proposes weekly, grouped GitHub Actions, npm, and Docker updates.
Review an action SHA update like source code: confirm the commit belongs to the
documented upstream tag, read upstream release notes, inspect permission/input
changes, and require `verify` before merge. Repository Actions settings should
allow GitHub-owned actions only and require full-length SHA pins.

The `main` ruleset requires pull requests, resolved conversations, current
branches, `verify`, and `SAST required gate`; it blocks deletion and force
pushes. The release-tag ruleset blocks deletion and non-fast-forward updates to
`v*` while allowing new immutable version tags. Both retain the documented
administrator emergency bypass so a sole maintainer can recover a broken
required workflow without weakening routine merges.

`npm run verify` runs the high-severity production dependency audit on every
pull request and main push. Dependabot vulnerability alerts and automated
security updates remain enabled. Docker base images use exact digests; review
their update PRs and record a scanner result with release evidence when an
authenticated container scanner is available. A clean scan is evidence for
one artifact at one time, not a substitute for patching or threat review.

## Environment and secret boundaries

GitHub environments named `staging` and `production` are the deployment trust
boundaries. A release job declares exactly one environment; environment values
must never be shared between them. This repository currently needs no external
deployment credential because publication uses the run-scoped GitHub token.
Future provider credentials belong in the matching GitHub environment secret,
must use the provider's shortest-lived identity mechanism (OIDC when
available), and may not be placed in repository variables, workflow text,
build arguments, images, logs, or `NEXT_PUBLIC_*` values.

The current private repository plan permits environments but rejects native
required-reviewer and deployment-branch rules. Production is therefore
fail-closed in the workflow: it must be manually dispatched from `main`, and
the operator must enter `deploy-<version>` matching the immutable version.
Staging rejects that production confirmation. When GitHub exposes protection
rules for this repository, configure at least one required production reviewer
and main-only deployment policy, enable prevent-self-review when a second
maintainer is available, then retain the workflow confirmation as defense in
depth. This plan limitation must not be represented as a native approval.

## Version and artifact identity

Release versions use `vMAJOR.MINOR.PATCH` with an optional SemVer prerelease,
for example `v1.4.0-rc.1`. Do not reuse a version. Dispatch the **Release
candidate** workflow from the exact `main` commit being released. The workflow
builds the runtime image with that source SHA in its OCI revision label and,
when publication is selected, pushes both the version tag and `sha-<commit>`
tag to GHCR. Record the registry digest from the run before deployment; deploy
by digest where the target supports it.

Generate release notes from merged pull requests with `.github/release.yml`.
The release record includes the version, source SHA, image digest, migration
set, verification run, backup/restore proof, environment, operator, approval,
known limitations, and rollback decision. Tags and GitHub Releases are created
only after the candidate proof passes; this workflow intentionally does not
silently create either.

## Staging, production, and migrations

1. Confirm the source is current `main` and exact-main `verify` and
   `SAST required gate` are green when both apply to the source change.
2. Review dependency alerts, migration SQL, data checks, privacy impact,
   observability, and the release notes. Applied migrations are immutable.
3. Dispatch a staging candidate with a unique prerelease version and
   publication disabled unless a registry artifact is required.
4. Preserve the workflow evidence. Exercise the production-like artifact,
   explicit migration runner, readiness endpoint, backup/restore proof, and
   application rollback. Investigate any failed or cancelled check; never
   promote partial evidence.
5. If staging is accepted, dispatch production from the same source SHA with
   the final immutable version and exact production confirmation. Publish once.
6. Take or verify the provider backup, record its restore evidence, run the
   migration artifact from the same revision, then deploy the application
   artifact by digest. Readiness must pass before traffic is shifted.
7. Create the unique `v*` tag only after the accepted source and artifact are
   known. Never move or reuse it; the release-tag ruleset blocks those unsafe
   updates.
8. Monitor safe operational events and alerts from
   `docs/OBSERVABILITY_AUDIT_AND_ALERTING.md`. Record the release outcome.

Database changes use expand-and-contract and `prisma migrate deploy`. The
application never runs migrations at startup. Before promotion, verify the
clean chain, populated representability path, backup restoration, migration
status, backfill/lock impact, and compatibility of the prior application with
the expanded schema. Destructive contract work requires a later release only
after old application versions and backfills are retired.

## Rollback and rehearsal

Run this before a release and after changing the container, migration, or
release path:

```sh
npm run release:rehearse
```

The script builds the current application and matching migration artifact,
builds the prior commit as the rollback artifact, creates an isolated synthetic
PostgreSQL volume, applies current migrations explicitly, proves candidate
readiness, replaces it with the prior application, proves readiness again, and
confirms migration history was not reverted. Set `ROLLBACK_REVISION` to the
actual known-good source revision when rehearsing a specific release.

Application rollback means redeploying the recorded known-good image digest.
It does not reverse accepted events or edit applied migrations. If the prior
application is incompatible with the expanded schema, stop promotion and ship
a roll-forward compatibility repair. Restore is a disaster-recovery action,
not a routine schema rollback; follow `docs/BACKUP_AND_RESTORE.md`, preserve the
failed database for investigation, and reconcile post-backup writes explicitly.

For an emergency change, keep the same immutable versioning, review,
verification, environment, evidence, and post-deployment monitoring. Document
why normal lead time was shortened, name the approving operator, and create a
follow-up issue for any deferred non-safety work. Never bypass tenant,
authorization, migration, privacy, or audit invariants to make a release pass.
