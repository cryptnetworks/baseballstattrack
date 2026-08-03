# Repository operations checklist

This is the maintainer checklist for routine and emergency repository work. It
routes to the detailed policy for each risk instead of replacing those
contracts. Follow it from a clean checkout and preserve links to the issue,
pull request, exact commit, checks, release, and operational evidence.

## Live repository controls

Check the current control, not an old screenshot, before relying on it:

- [Actions policy and token permissions](https://github.com/cryptnetworks/baseballstattrack/settings/actions)
- [Actions runs](https://github.com/cryptnetworks/baseballstattrack/actions)
- [`verify` workflow](https://github.com/cryptnetworks/baseballstattrack/actions/workflows/ci.yml)
- [documentation wiki workflow](https://github.com/cryptnetworks/baseballstattrack/actions/workflows/publish-docs-wiki.yml)
- [release-candidate workflow](https://github.com/cryptnetworks/baseballstattrack/actions/workflows/release.yml)
- [deployment environments](https://github.com/cryptnetworks/baseballstattrack/settings/environments)
- [staging deployment activity](https://github.com/cryptnetworks/baseballstattrack/deployments/activity_log?environments_filter=staging)
- [production deployment activity](https://github.com/cryptnetworks/baseballstattrack/deployments/activity_log?environments_filter=production)
- [dependency security](https://github.com/cryptnetworks/baseballstattrack/settings/security_analysis)
- [Dependabot alerts](https://github.com/cryptnetworks/baseballstattrack/security/dependabot)
- [rules and branch protection](https://github.com/cryptnetworks/baseballstattrack/settings/rules)
- [delivery project](https://github.com/users/cryptnetworks/projects/4)
- [milestones](https://github.com/cryptnetworks/baseballstattrack/milestones)

Actions are limited to GitHub-owned actions, workflow references require full
commit SHAs, and the default token is read-only. Staging and production
environments exist. The current private plan does not expose native branch
protection, required environment reviewers, deployment-branch policies, secret
scanning, or push protection. The production workflow's exact
`deploy-<version>` confirmation is the current explicit approval control; it is
not represented as an independent reviewer. The applied and plan-limited state
is maintained in `.github/branch-protection.md`.

### Documentation wiki publication

Treat `docs/` as the only authoritative documentation source. The generated
wiki, manifest, visibility classifications, reserved namespace, credential
rotation, dry-run, publication, and recovery rules are maintained in
[Documentation Wiki Publishing](DOCUMENTATION_WIKI_PUBLISHING.md). Never edit a
generated wiki page as a source change. Before a controlled publication, run
`npm run docs:wiki:dry-run` against a temporary wiki checkout and preserve the
source SHA and prospective diff in the operation record.

## Clean-checkout preflight

Use Node 24 or newer and npm 11 or newer. Do not reuse another issue's working
tree or branch.

```sh
git clone https://github.com/cryptnetworks/baseballstattrack.git
cd baseballstattrack
git fetch --all --prune
git switch main
git pull --ff-only origin main
git status --short --branch
npm ci
npm run verify
```

The status must be clean and `main` must match `origin/main`. Confirm exact-main
CI is green before branching. Preserve unrelated untracked files in an
existing checkout. Never copy `.env`, credentials, production data, backups,
or generated artifacts into a branch. Do not run `npm run db:migrate` until
`DATABASE_URL` and `DIRECT_URL` point to the intended non-production developer
database.

## Intake and triage

1. Search issues and pull requests for an existing owner. Route suspected
   vulnerabilities, secrets, cross-Account access, or private-data exposure
   through `SECURITY.md`, never a public issue or attachment.
2. For an ordinary defect, follow
   `docs/DEFECT_TRIAGE_AND_REGRESSION_POLICY.md`: capture safe reproduction,
   affected commit/environment, severity, priority, owner, verifier, and the
   current reproduction state. Keep severity separate from scheduling.
3. For planned work, confirm objective, acceptance criteria, dependencies,
   milestone, project target/status, area, type, priority, and size. Resolve
   contradictory scope before implementation.
4. Check that predecessor issues are closed and exact-main evidence is green.
   Create one short-lived `feat/`, `fix/`, `chore/`, or `docs/` branch directly
   from that SHA and include the issue number.

## Change and pull request

1. Make the smallest coherent change that satisfies the issue. Do not combine
   opportunistic dependency upgrades, migrations, formatting churn, or another
   issue's acceptance criteria.
2. Preserve deterministic replay, append-only accepted events, Account
   isolation, server authorization, privacy minimization, safe logging, and
   migration immutability. Add focused success, denial, and failure-path tests
   where behavior changes.
3. Run `npm run format`, `npm run lint`, `npm run typecheck`, `npm run test`,
   `npm run policy:validate`, `npm run db:validate`, `npm run build`,
   `npm run verify`, and `git diff --check`. Container or runtime changes also
   run `npm run container:verify`; release changes run
   `npm run release:rehearse`.
4. Inspect the complete diff and status. Commit only intended files, push the
   issue branch, and open a draft pull request using the repository template.
   Explain purpose, validation, security/privacy/accessibility impact,
   migrations, configuration, rollback or roll-forward, and known follow-up.
5. Use `Closes #N` only when merge completes ordinary feature/task/docs work.
   Defect fixes use `Refs #N`; verify the merged commit against the original
   reproduction before closing the defect.
6. Review the exact PR head, including generated SQL, workflow permissions,
   dependency/action identities, denied paths, and adjacent invariants. Resolve
   every actionable review thread. Make the PR ready only when the exact head's
   `verify` check is green and required approval is present where supported.
7. Merge with the repository's merge-commit strategy. Fetch and fast-forward
   local `main`; record the merge SHA and require exact-main CI to pass. A green
   superseded branch run is not post-merge evidence.

## Migration changes

In addition to the pull-request checklist:

1. Use one reviewed logical purpose per forward migration. Never edit or delete
   an applied migration. Use `prisma migrate deploy` in release paths, not
   `prisma migrate dev`, schema push, application startup, or manual production
   DDL.
2. Document expand-and-contract phases, existing-data preflight, lock and
   backfill behavior, restartability, tenant constraints, projection/replay
   impact, application compatibility, and roll-forward repair.
3. Prove the clean chain and populated representative path with
   `npm run db:migrate:deploy`, `npm run db:migrate:status`,
   `npm run db:migrate:verify`, and `npm run db:representability` against an
   isolated disposable PostgreSQL database. Run backup/restore and container
   verification when the release or runtime path is affected.
4. Before production, record a current restorable backup, migration artifact
   digest, exact application digest, data validation query, operator, approval,
   observation window, and stop/roll-forward decision. Application rollback is
   allowed only while the prior image is compatible with the expanded schema.

The authority is `docs/PERSISTENCE_AND_TENANCY.md`,
`docs/RELATIONAL_DOMAIN_SCHEMA.md`, `docs/BACKUP_AND_RESTORE.md`, and
`docs/RELEASE_AND_WORKFLOW_SECURITY.md`.

## Release

1. Confirm exact-main `verify`, dependency review, release notes, migration
   review, backup/restore evidence, observability, and a known-good rollback
   digest. Choose a unique immutable semantic version.
2. Dispatch the release-candidate workflow from `main` to `staging` with
   publication disabled unless a registry artifact is needed. Preserve its
   canonical verification, backup/restore, explicit migration, readiness,
   candidate/prior-image rollback, and OCI revision evidence.
3. Resolve staging failures rather than rerunning until green. Confirm the
   staged source SHA and artifact digest are the intended release.
4. Dispatch `production` from the same approved source with
   `production_confirmation` equal to `deploy-<version>`. Publish once, deploy
   by digest, apply the matching migration artifact explicitly, and shift
   traffic only after readiness succeeds.
5. Monitor the safe events and alerts in
   `docs/OBSERVABILITY_AUDIT_AND_ALERTING.md`. Record version, source, digest,
   environment, operator, approval, migrations, backup, checks, timestamps,
   outcome, and any rollback. Create the Git tag and GitHub Release only after
   the accepted artifact and notes are known.

Use `docs/RELEASE_AND_WORKFLOW_SECURITY.md` for the full secret, artifact,
release, migration, and rollback contract.
Use `docs/PRODUCTION_RELIABILITY.md` for SLO, budget, alert, incident, and
reliability-drill decisions.

## Incident and emergency change

An incident is active harm or credible risk to confidentiality, integrity,
availability, accepted events, tenant isolation, authentication, privacy,
backups, releases, or statistics. Keep sensitive detail out of issues and
public CI logs.

1. Name an incident lead, safe private coordination channel, start time,
   affected version/environment, observed impact, and evidence custodian.
   Preserve logs and failed artifacts without copying production/private data
   into GitHub.
2. Contain the smallest boundary: revoke/rotate exposed credentials, stop a
   rollout, disable the affected integration or route, restrict access, or
   redeploy the recorded known-good image. Do not delete accepted events,
   rewrite migrations, destroy the affected database, or erase audit evidence.
3. Assess Account scope, authorization/privacy exposure, data integrity,
   replay/projection effects, backup currency, and notification/escalation
   obligations. Use the private security route when applicable.
4. For verified quota exhaustion, follow
   `docs/RATE_LIMITS_AND_ABUSE_PREVENTION.md`: use only the same-origin audited
   override endpoint, keep the change within its bounded policy and 24-hour
   expiry, monitor decisions, and revoke it as soon as the incident ends. Never
   edit limiter tables or accept a caller-supplied bypass header.
5. A P0 emergency change may shorten normal lead time but still needs a linked
   issue or private incident reference, focused diff, explicit operator
   approval, exact-head verification, rollback/roll-forward plan, and
   exact-main or exact-deployment verification. Never mask or waive a failed
   safety gate. If a required native control is unavailable, record the
   limitation and the human approval evidence.
6. Verify recovery through readiness and safe user/invariant checks, monitor
   for recurrence, and record containment end time. Follow with root cause,
   timeline, impact, detection gap, regression proof, owner, and dated systemic
   actions using only safely publishable information.

## Deprecation and removal

1. Inventory the contract and consumers: API/route, event or import schema,
   configuration, workflow, image, database field, or documented behavior.
   Accepted-event meaning and historical rulesets are versioned; they are not
   reinterpreted or deleted as a deprecation shortcut.
2. Open a dedicated issue with owner, replacement, compatibility/migration
   path, announcement release, earliest removal release/date, evidence of use,
   rollback, and affected documentation. Use an ADR for architecture, tenancy,
   event-vocabulary, or compatibility decisions.
3. Add the replacement first. Mark the old path deprecated in code/schema and
   release notes without leaking user or Account activity. Keep both paths
   through the documented compatibility window and provide deterministic data
   migration or replay behavior where applicable.
4. Remove only in a later focused change after consumers are migrated, the
   observation criterion is satisfied, backups and rollback are ready, and the
   removal is called out as breaking where appropriate. Delete obsolete tests,
   docs, flags, secrets, and monitoring only after the old path is gone.

## Closeout record

Every completed operation can answer: issue and owner; starting and final
SHAs; branch and PR; exact-head and exact-main checks; approvals; files and
migrations changed; security/privacy/accessibility review; release version and
artifact digest when applicable; backup, rollout, rollback, and incident
evidence; deferred work; and final issue/project state. If any required answer
is missing or a required check is red, stop and keep the item open.
